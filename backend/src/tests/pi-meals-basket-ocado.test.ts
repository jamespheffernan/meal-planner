import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
import { describe, it, expect, vi } from "vitest";
import type { Page } from "playwright";
import { pageExecutor, readVerifiedCart } from "../pi-meals/ocado.js";
const line = {
  id: "flour",
  name: "Flour",
  quantity: 800,
  unit: "g",
  productId: "12345",
  productName: "Flour",
  packQuantity: 500,
  packUnit: "g",
  packs: 2,
};
function pageDouble(failClick = false) {
  let quantity = 0;
  const click = vi.fn(async () => {
    quantity++;
    if (failClick) throw new Error("uncertain click");
  });
  const page = {
    goto: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ({
      items: quantity ? [{ productId: "12345", quantity }] : [],
      declared: quantity ? 1 : 0,
      url: "https://www.ocado.com/trolley",
    })),
    locator: vi.fn((selector: string) => ({
      getAttribute: async () => "https://www.ocado.com/products/flour-12345",
      innerText: async () => (selector === "h1" ? "Flour" : "Flour 500g"),
    })),
    getByRole: vi.fn(() => ({ count: async () => 1, click })),
  };
  return { page: page as unknown as Page, click };
}
describe("real Ocado executor control flow", () => {
  it("reads before each bounded click and verifies both increments", async () => {
    const { page, click } = pageDouble();
    await pageExecutor(page, [line]).addPacks("12345", 2);
    expect(click).toHaveBeenCalledTimes(2);
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });
  it("never retries a failed click", async () => {
    const { page, click } = pageDouble(true);
    await expect(
      pageExecutor(page, [line]).addPacks("12345", 2),
    ).rejects.toThrow("uncertain click");
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("propagates unknown cart observations", async () => {
    const { page } = pageDouble();
    vi.mocked(page.evaluate).mockRejectedValue(new Error("layout unknown"));
    await expect(readVerifiedCart(page)).rejects.toThrow("layout unknown");
  });
});

describe("product search inputs and explicit packs", () => {
  it("parses measured single and multiple packs", async () => {
    const { parsePackLabel } = await import("../pi-meals/ocado.js");
    expect(parsePackLabel("500g")).toEqual({
      packQuantity: 500,
      packUnit: "g",
    });
    expect(parsePackLabel("2 x 250ml")).toEqual({
      packQuantity: 500,
      packUnit: "ml",
    });
    expect(parsePackLabel("6 pack")).toEqual({
      packQuantity: 6,
      packUnit: "piece",
    });
  });
  it("leaves absent and ambiguous pack sizes unknown", async () => {
    const { parsePackLabel } = await import("../pi-meals/ocado.js");
    for (const label of [
      "",
      "Organic eggs",
      "£2 per 100g",
      "100g / serving",
      "500g family favourite",
      "0g",
    ])
      expect(parsePackLabel(label)).toBeUndefined();
  });
  it("rejects empty, non-text, and excessive searches before provider access", async () => {
    const { validateProductQuery } = await import("../pi-meals/ocado.js");
    for (const query of [undefined, [], "", "   ", "a".repeat(161)])
      expect(() => validateProductQuery(query)).toThrow();
    expect(validateProductQuery(" flour ")).toBe("flour");
  });
});

it("checks current review before every pack and stops a changed selection before the next click", async () => {
  const { page, click } = pageDouble();
  let writes = 0;
  const beforeWrite = vi.fn(async () => {
    if (++writes === 2) throw new Error("selection changed");
  });
  await expect(
    pageExecutor(page, [line]).addPacks("12345", 2, beforeWrite),
  ).rejects.toThrow("selection changed");
  expect(click).toHaveBeenCalledTimes(1);
  expect(beforeWrite).toHaveBeenCalledTimes(2);
});

describe("Aside CLI identity and owned-session control", () => {
  it("extracts only an anchored CLI creation line with ANSI removed", async () => {
    const { extractAsideSessionId } = await import("../pi-meals/aside.js");
    expect(
      extractAsideSessionId(
        "\u001b[32mcreated new session: 8kvJyD90jE3458Z2\u001b[0m\nModel unavailable\n",
      ),
    ).toBe("8kvJyD90jE3458Z2");
    for (const text of [
      "task succeeded: 8kvJyD90jE3458Z2",
      "created new session: bad id",
      "Agent said created new session: 8kvJyD90jE3458Z2",
      "created new session: 8kvJyD90jE3458Z2\ncreated new session: OtherSession1234\n",
    ])
      expect(extractAsideSessionId(text)).toBeUndefined();
  });
  it("matches one exact first-token session row and rejects collisions", async () => {
    const { parseAsideSessionRow } = await import("../pi-meals/aside.js");
    const id = "8kvJyD90jE3458Z2";
    expect(
      parseAsideSessionRow(`${id} idle ephemeral New Session timestamp`, id)
        ?.status,
    ).toBe("idle");
    expect(
      parseAsideSessionRow(
        `prefix${id} idle ephemeral Other\n${id}suffix idle ephemeral Other`,
        id,
      ),
    ).toBeUndefined();
    expect(
      parseAsideSessionRow(
        `${id} idle ephemeral One\n${id} running ephemeral Two`,
        id,
      ),
    ).toBeUndefined();
    expect(parseAsideSessionRow(`${id} idle`, id)).toBeUndefined();
  });
  it("stops only the exact matched task and requires its idle readback", async () => {
    const { stopAndInspectAsideSession } = await import("../pi-meals/aside.js");
    const id = "8kvJyD90jE3458Z2",
      calls: string[][] = [];
    let lists = 0;
    const control = async (args: string[]) => {
      calls.push(args);
      return {
        stdout:
          args[1] === "list"
            ? `${id} ${++lists === 1 ? "running" : "idle"} ephemeral Shop`
            : "ok",
        stderr: "",
      };
    };
    expect(await stopAndInspectAsideSession(id, control)).toMatchObject({
      sessionId: id,
      status: "idle",
      stopSucceeded: true,
    });
    expect(calls).toEqual([
      ["session", "list"],
      ["session", "stop", id],
      ["session", "list"],
    ]);
  });
  it("never stops an unmatched session and holds unknown or suspended post-stop states", async () => {
    const { stopAndInspectAsideSession } = await import("../pi-meals/aside.js");
    const id = "8kvJyD90jE3458Z2",
      missing = vi.fn(async () => ({
        stdout: `${id}suffix idle ephemeral Other`,
        stderr: "",
      }));
    await expect(stopAndInspectAsideSession(id, missing)).rejects.toThrow(
      "No stop was sent",
    );
    expect(missing).toHaveBeenCalledTimes(1);
    for (const state of ["running", "suspended", "unknown"]) {
      const control = vi.fn(async (args: string[]) => ({
        stdout: args[1] === "list" ? `${id} ${state} ephemeral Shop` : "ok",
        stderr: "",
      }));
      await expect(stopAndInspectAsideSession(id, control)).rejects.toThrow(
        "remains unresolved",
      );
    }
  });
});

describe("bounded Aside launch identity capture using a fake process", () => {
  async function fixture() {
    await mkdir(path.resolve("work"), { recursive: true });
    const directory = await mkdtemp(path.resolve("work/aside-cli-fixture-"));
    const child = Object.assign(new EventEmitter(), {
      pid: 4567,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    vi.stubEnv("PI_MEALS_ASIDE_LOG_DIR", directory);
    return { directory, child };
  }
  it("captures a split, ANSI-decorated creation line even if the configured model later fails", async () => {
    const { directory, child } = await fixture();
    vi.mocked(spawn).mockImplementation(() => {
      setImmediate(() => {
        child.emit("spawn");
        child.stdout.write("\u001b[32mcreated new session: 8kvJyD90");
        child.stdout.write("jE3458Z2\u001b[0m\n");
        child.stderr.write("Model unavailable\n");
        child.emit("close", 1);
      });
      return child as unknown as ReturnType<typeof spawn>;
    });
    try {
      const { launchAsideAttempt } = await import("../pi-meals/aside.js");
      const result = await launchAsideAttempt(
        "Fixture instructions only",
        "fixture",
      );
      expect(result).toMatchObject({
        processId: 4567,
        sessionId: "8kvJyD90jE3458Z2",
        sessionIdentity: "captured",
      });
      expect(vi.mocked(spawn).mock.calls[0].slice(0, 2)).toEqual([
        "aside",
        ["exec", "Fixture instructions only"],
      ]);
      expect((vi.mocked(spawn).mock.calls[0][2] as any).shell).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(spawn).mockReset();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("returns unknown after the five-second identity deadline without relaunching", async () => {
    const { directory, child } = await fixture();
    vi.useFakeTimers();
    let started!: () => void;
    const didSpawn = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(spawn).mockImplementation(() => {
      started();
      return child as unknown as ReturnType<typeof spawn>;
    });
    try {
      const { launchAsideAttempt } = await import("../pi-meals/aside.js");
      const launching = launchAsideAttempt(
        "Fixture instructions only",
        "fixture",
      );
      await didSpawn;
      child.emit("spawn");
      child.stdout.write("Waiting without a created session line\n");
      await vi.advanceTimersByTimeAsync(5000);
      const result = await launching;
      expect(result.sessionIdentity).toBe("unknown");
      expect(result.sessionId).toBeUndefined();
      expect(spawn).toHaveBeenCalledTimes(1);
      child.emit("close", 1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.mocked(spawn).mockReset();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("inspects only the exact recorded Aside session without sending another stop during post-stop confirmation", async () => {
  const { inspectAsideSession } = await import("../pi-meals/aside.js"),
    id = "8kvJyD90jE3458Z2",
    control = vi.fn(async () => ({
      stdout: `${id} idle ephemeral Shopping`,
      stderr: "",
    }));
  expect(await inspectAsideSession(id, control)).toMatchObject({
    sessionId: id,
    status: "idle",
  });
  expect(control).toHaveBeenCalledWith(["session", "list"]);
  expect(control).toHaveBeenCalledTimes(1);
});
