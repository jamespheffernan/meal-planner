import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { EvidenceLine } from "./contracts.js";
export interface InstagramEvidence {
  evidence: EvidenceLine[];
  gaps: string[];
}
export function instagramUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
    !/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  )
    throw new Error("Use a single Instagram post or reel HTTPS link.");
  url.search = "";
  url.hash = "";
  return url.toString();
}
/** A fixed adapter executable; no shell, browser-cookie access or user-selected command. */
export async function inspectInstagram(
  value: string,
): Promise<InstagramEvidence> {
  const url = instagramUrl(value);
  return new Promise((resolve) => {
    const child = spawn(
      "python3",
      [
        fileURLToPath(
          new URL("../scripts/pi-meals-instagram.py", import.meta.url),
        ),
        url,
      ],
      { shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    let settled = false;
    const finish = (result: InstagramEvidence) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const stop = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      stop();
      finish({
        evidence: [],
        gaps: [
          "Instagram extraction timed out. Paste the caption, transcript or on-screen ingredients to continue.",
        ],
      });
    }, 90_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 1_048_576) {
        stop();
        finish({
          evidence: [],
          gaps: [
            "Instagram evidence exceeded the size limit. Paste the recipe text to continue.",
          ],
        });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(0, 2000);
    });
    child.on("error", () =>
      finish({
        evidence: [],
        gaps: [
          "Python Instagram extractor unavailable. Install python3 or paste the recipe evidence.",
        ],
      }),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          evidence: [],
          gaps: [
            `Instagram extraction unavailable. Paste the recipe evidence. ${errors.slice(0, 300)}`,
          ],
        });
        return;
      }
      try {
        const parsed = JSON.parse(output) as InstagramEvidence;
        if (
          !Array.isArray(parsed.evidence) ||
          !Array.isArray(parsed.gaps) ||
          parsed.evidence.some(
            (line) =>
              !["caption", "speech", "ocr"].includes(line.source) ||
              typeof line.text !== "string",
          ) ||
          parsed.gaps.some((g) => typeof g !== "string")
        )
          throw new Error("Invalid extractor response");
        finish(parsed);
      } catch {
        finish({
          evidence: [],
          gaps: [
            "Instagram extractor returned invalid evidence. Paste the recipe text to continue.",
          ],
        });
      }
    });
  });
}
