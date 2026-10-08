import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { BasketProposal } from "./contracts.js";
/** The installed Aside CLI has no machine-verifiable cart observation contract.
 * Keep this handoff available without interpreting agent prose as a receipt. */
export function basketHandoff(basket: BasketProposal): string {
  return [
    `Pi Meals basket ${basket.id}; revision ${basket.revision}; selection ${basket.selectionId} revision ${basket.selectionRevision}.`,
    "Fill the Ocado trolley for the exact ingredient quantities below. Where product IDs and pack sizes are reviewed, use those products and counts. Otherwise choose suitable available Ocado products and pack sizes yourself. Prefer ordinary reasonably priced products that match the ingredient and dietary requirements; calculate the minimum whole packs covering the required quantity. Do not ask the user to choose every product or approve routine brand and pack-size decisions. Ask only about material unresolved quantities, dietary restrictions, or an unavailable ingredient requiring a recipe change. Proceed with known requirements. For a line with quantity:null or needsReview:true, do not invent an amount or add it yet; ask whether the household already has enough (especially unquantified salt or seasoning), or ask for the needed amount. Resolve only these material questions before writing that line. Do not substitute an explicitly reviewed product or a materially different ingredient, remove or reduce existing items, select a delivery slot, enter checkout, pay, or place an order.",
    "Read the complete trolley first. If it cannot be read reliably, stop. Record every existing product ID and quantity, including manual items. For each manifest product, add the stated number of packs to its baseline quantity. Record the baseline and intended target BEFORE each write. If a write is interrupted or uncertain, stop without retrying it or starting another executor.",
    "Read the complete trolley after changes. Return structured evidence with task/session ID, full baseline and final product IDs and quantities, each intended target, differences, and unresolved items. A written success claim is not verification.",
    JSON.stringify(
      {
        basketId: basket.id,
        selectionRevision: basket.selectionRevision,
        shoppingCycleRevision: (
          basket as BasketProposal & { shoppingCycleRevision?: number }
        ).shoppingCycleRevision,
        lines: basket.lines.map((line) =>
          line.quantity === 0
            ? { ...line, quantity: null, needsReview: true }
            : line,
        ),
      },
      null,
      2,
    ),
  ].join("\n\n");
}
export const asideAvailability =
  "Continue in Aside to open an attended shopping task. Stop the shopping task here, review the stopped trolley, then confirm it. Cart completion requires your confirmation; checkout stays manual.";

export function stripAsideAnsi(output: string): string {
  return output
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}
const sessionIdPattern = /^[A-Za-z0-9_-]{8,80}$/;
export function extractAsideSessionId(output: string): string | undefined {
  const ids = new Set(
    stripAsideAnsi(output)
      .split(/[\r\n]+/)
      .flatMap((line) => {
        const match = line.match(
          /^\s*created new session:\s*([A-Za-z0-9_-]{8,80})\s*$/,
        );
        return match ? [match[1]] : [];
      }),
  );
  return ids.size === 1 ? [...ids][0] : undefined;
}
export interface AsideSessionRow {
  sessionId: string;
  status: string;
  row: string;
}
export function parseAsideSessionRow(
  output: string,
  sessionId: string,
): AsideSessionRow | undefined {
  if (!sessionIdPattern.test(sessionId)) return undefined;
  const matches = stripAsideAnsi(output)
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.split(/\s+/)[0] === sessionId);
  if (matches.length !== 1) return undefined;
  const tokens = matches[0].split(/\s+/);
  if (tokens.length < 3 || !/^[a-z_-]+$/.test(tokens[1])) return undefined;
  return { sessionId, status: tokens[1], row: matches[0] };
}
const execAside = promisify(execFile);
type AsideControl = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;
const controlAside: AsideControl = async (args) =>
  execAside(process.env.PI_MEALS_ASIDE_BINARY ?? "aside", args, {
    shell: false,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65536,
    killSignal: "SIGTERM",
  });
export async function inspectAsideSession(
  sessionId: string,
  control: AsideControl = controlAside,
) {
  if (!sessionIdPattern.test(sessionId))
    throw new Error("The stored Aside session identity is invalid.");
  const matched = parseAsideSessionRow(
    (await control(["session", "list"])).stdout,
    sessionId,
  );
  if (!matched)
    throw new Error(
      "The recorded Aside session is missing or ambiguous. Keep the account reserved.",
    );
  return { ...matched, observedAt: new Date().toISOString() };
}
export async function stopAndInspectAsideSession(
  sessionId: string,
  control: AsideControl = controlAside,
) {
  if (!sessionIdPattern.test(sessionId))
    throw new Error(
      "The stored Aside session identity is invalid. Keep the account reserved and inspect the existing task.",
    );
  const before = parseAsideSessionRow(
    (await control(["session", "list"])).stdout,
    sessionId,
  );
  if (!before)
    throw new Error(
      "The recorded Aside session is missing or ambiguous. No stop was sent; inspect that exact task before starting another shop.",
    );
  await control(["session", "stop", sessionId]);
  const after = parseAsideSessionRow(
    (await control(["session", "list"])).stdout,
    sessionId,
  );
  // 'suspended' has no documented inactive guarantee in the installed guide.
  if (!after || after.status !== "idle")
    throw new Error(
      "Aside stop did not produce one matching idle session. Remote termination remains unresolved; the account is still reserved.",
    );
  return {
    sessionId,
    status: "idle" as const,
    stopSucceeded: true,
    observedAt: new Date().toISOString(),
    evidence: { source: "aside-session-list", row: after.row },
  };
}
type AsideProcessObservation = {
  processState: "started" | "finished" | "failed";
  exitCode?: number;
  error?: string;
};
const processObservations = new Map<string, AsideProcessObservation>();
export function inspectAsideProcess(
  logPath: string,
): AsideProcessObservation | undefined {
  return processObservations.get(logPath);
}
/** Capture the actual CLI creation line; a PID alone never proves a remote task identity. */
export async function launchAsideAttempt(
  text: string,
  attemptId: string,
): Promise<{
  processId: number;
  logPath: string;
  sessionId?: string;
  sessionIdentity: "captured" | "unknown";
  processState: "started" | "finished" | "failed";
  exitCode?: number;
  error?: string;
}> {
  const directory =
    process.env.PI_MEALS_ASIDE_LOG_DIR ?? path.resolve("work/pi-meals-aside");
  await mkdir(directory, { recursive: true });
  const logPath = path.join(
    directory,
    `${attemptId.replace(/[^a-zA-Z0-9_-]/g, "_")}.log`,
  );
  const log = await open(logPath, "wx", 0o600);
  const child = spawn(
    process.env.PI_MEALS_ASIDE_BINARY ?? "aside",
    ["exec", text],
    { shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
  processObservations.set(logPath, { processState: "started" });
  let bytes = 0,
    identityOutput = "",
    identitySettled = false;
  let exitCode: number | undefined,
    processError: string | undefined,
    stderrOutput = "";
  let resolveIdentity!: (sessionId: string | undefined) => void;
  const identity = new Promise<string | undefined>((resolve) => {
    resolveIdentity = resolve;
  });
  const finishIdentity = (
    sessionId = extractAsideSessionId(identityOutput),
  ) => {
    if (identitySettled) return;
    identitySettled = true;
    clearTimeout(identityTimer);
    resolveIdentity(sessionId);
  };
  const identityTimer = setTimeout(() => finishIdentity(), 5000);
  const capture = (chunk: Buffer) => {
    const remaining = 65536 - bytes;
    if (remaining <= 0) return;
    const part = chunk.subarray(0, remaining);
    bytes += part.length;
    void log.write(part).catch(() => undefined);
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    capture(chunk);
    if (identitySettled) return;
    identityOutput = (identityOutput + chunk.toString("utf8")).slice(0, 16384);
    // Wait for a complete creation line so split chunks cannot truncate the ID.
    const last = Math.max(
      identityOutput.lastIndexOf("\n"),
      identityOutput.lastIndexOf("\r"),
    );
    if (last >= 0) {
      const id = extractAsideSessionId(identityOutput.slice(0, last + 1));
      if (id) finishIdentity(id);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    capture(chunk);
    stderrOutput = (stderrOutput + chunk.toString("utf8")).slice(0, 4096);
    if (!identitySettled) {
      identityOutput = (identityOutput + chunk.toString("utf8")).slice(
        0,
        16384,
      );
      const last = Math.max(
        identityOutput.lastIndexOf("\n"),
        identityOutput.lastIndexOf("\r"),
      );
      if (last >= 0) {
        const id = extractAsideSessionId(identityOutput.slice(0, last + 1));
        if (id) finishIdentity(id);
      }
    }
  });
  const timer = setTimeout(
    () => {
      child.kill("SIGTERM");
    },
    10 * 60 * 1000,
  );
  timer.unref();
  child.once("close", (code: number | null, signal: string | null) => {
    if (code !== null) exitCode = code;
    if (code !== 0)
      processError = `Aside CLI exited ${code ?? signal ?? "unexpectedly"}${stderrOutput.trim() ? `: ${stripAsideAnsi(stderrOutput).trim()}` : ""}`;
    processObservations.set(logPath, {
      processState: processError ? "failed" : "finished",
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(processError ? { error: processError } : {}),
    });
    clearTimeout(timer);
    finishIdentity();
    void log.close();
  });
  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      processObservations.set(logPath, {
        processState: "failed",
        error: error.message,
      });
      clearTimeout(timer);
      finishIdentity();
      void log.close();
      reject(error);
    });
    child.once("spawn", async () => {
      if (!child.pid) {
        finishIdentity();
        reject(new Error("Aside process identity unavailable"));
        return;
      }
      const sessionId = await identity;
      resolve({
        processId: child.pid,
        logPath,
        ...(sessionId ? { sessionId } : {}),
        sessionIdentity: sessionId ? "captured" : "unknown",
        processState: processError
          ? "failed"
          : exitCode === 0
            ? "finished"
            : "started",
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(processError ? { error: processError } : {}),
      });
    });
  });
}
