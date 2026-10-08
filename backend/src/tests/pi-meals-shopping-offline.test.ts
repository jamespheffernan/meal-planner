import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
const ids = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../frontend/src/lib/pi-meals-api", () => ({
  mealsRequest: vi.fn(),
  mealsApi: { session: vi.fn() },
  operationId: () =>
    ++ids.count === 1 ? "fixed-operation" : `fixed-operation-${ids.count}`,
  MealsApiError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
// Runtime imports exercise the real browser module without pulling DOM sources
// outside backend rootDir into the production NodeNext compilation.
interface CachedShopping {
  actorId: string;
  apiBase: string;
  cachedAt: string;
  pending: Array<{
    operationId: string;
    expectedRevision: number;
    status: "pending" | "conflict";
  }>;
  unresolvedPurchases?: unknown[];
  cycle: {
    id: string;
    revision: number;
    selectionId: string;
    selectionRevision: number;
    sourceChanged: boolean;
    lines: (typeof line)[];
    purchases: unknown[];
    orphanPurchases: unknown[];
  };
}
const shoppingModulePath = "../../../frontend/src/lib/pi-meals-shopping-api";
const clientModulePath = "../../../frontend/src/lib/pi-meals-api";
const {
  queuePurchase,
  flushShopping,
  cachedShopping,
  loadShopping,
  saveCachedShopping,
  reconcileShoppingPurchase,
  retainConflictedPurchase,
} = (await import(shoppingModulePath)) as {
  queuePurchase: (
    value: CachedShopping,
    ingredient: typeof line,
    quantity: number,
  ) => Promise<CachedShopping>;
  flushShopping: () => Promise<CachedShopping | null>;
  cachedShopping: () => Promise<CachedShopping | null>;
  loadShopping: (
    selectionId: string,
    signal?: AbortSignal,
  ) => Promise<CachedShopping>;
  saveCachedShopping: (value: CachedShopping | null) => Promise<void>;
  reconcileShoppingPurchase: (id: string) => Promise<CachedShopping>;
  retainConflictedPurchase: (id: string) => Promise<CachedShopping>;
};
const { mealsRequest, mealsApi, MealsApiError } = (await import(
  clientModulePath
)) as {
  mealsRequest: Mock;
  mealsApi: { session: Mock };
  MealsApiError: new (message: string, status: number) => Error;
};
let stored: unknown;
function mockIndexedDb() {
  return {
    open: () => {
      const r: any = {};
      queueMicrotask(() => {
        r.result = {
          close: () => {},
          transaction: () => {
            const t: any = { abort: () => {} };
            t.objectStore = () => ({
              get: () => {
                const q: any = {};
                queueMicrotask(() => {
                  q.result = structuredClone(stored);
                  q.onsuccess();
                  queueMicrotask(() => t.oncomplete?.());
                });
                return q;
              },
              put: (v: unknown) => {
                stored = structuredClone(v);
                queueMicrotask(() => t.oncomplete?.());
              },
              delete: () => {
                stored = undefined;
                queueMicrotask(() => t.oncomplete?.());
              },
            });
            return t;
          },
        };
        r.onsuccess();
      });
      return r;
    },
  };
}
const line = {
  id: "carrot",
  name: "Carrot",
  quantity: 500,
  unit: "g",
  haveQuantity: 0,
  buyQuantity: 500,
  sources: [],
  warnings: [],
  fingerprint: "meaning",
  route: "market" as const,
  late: false,
  sourceChanged: false,
  planned: true,
  boughtQuantity: 0,
  remainingQuantity: 500,
};
const base: CachedShopping = {
  actorId: "james",
  apiBase: "/api",
  cachedAt: "now",
  pending: [],
  cycle: {
    id: "shopping_s",
    revision: 1,
    selectionId: "s",
    selectionRevision: 1,
    sourceChanged: false,
    lines: [line],
    purchases: [],
    orphanPurchases: [],
  },
};
beforeEach(async () => {
  stored = undefined;
  ids.count = 0;
  vi.clearAllMocks();
  vi.stubGlobal("indexedDB", mockIndexedDb());
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
  });
  await saveCachedShopping(base);
  vi.mocked(mealsApi.session).mockResolvedValue({
    actorId: "james",
    name: "James",
  });
});
describe("offline purchase receipts", () => {
  it("retains same command and operation ID after interrupted request then retries", async () => {
    await queuePurchase(base, line, 500);
    vi.mocked(mealsRequest).mockRejectedValueOnce(
      new TypeError("network lost"),
    );
    await expect(flushShopping()).rejects.toThrow("network lost");
    expect((await cachedShopping())?.pending[0].operationId).toBe(
      "fixed-operation",
    );
    vi.mocked(mealsRequest).mockResolvedValueOnce({
      ...base.cycle,
      revision: 2,
    });
    await flushShopping();
    const calls = vi.mocked(mealsRequest).mock.calls;
    expect(calls[0][2]).toEqual(calls[1][2]);
    expect((await cachedShopping())?.pending).toEqual([]);
  });
  it("keeps incompatible changes visible as conflicts", async () => {
    await queuePurchase(base, line, 500);
    vi.mocked(mealsRequest).mockRejectedValueOnce(
      new MealsApiError("line changed", 409),
    );
    const result = await flushShopping();
    expect(result?.pending[0].status).toBe("conflict");
    expect(result?.cycle.revision).toBe(1);
  });
  it("never sends saved purchases as another member", async () => {
    await queuePurchase(base, line, 500);
    vi.mocked(mealsApi.session).mockResolvedValue({
      actorId: "manon",
      name: "Manon",
    });
    await expect(flushShopping()).rejects.toThrow("another member");
    expect(mealsRequest).not.toHaveBeenCalled();
    expect((await cachedShopping())?.pending).toHaveLength(1);
  });
  it("does not replace another tab purchase from stale rendered state", async () => {
    await queuePurchase(base, line, 200);
    const next = await queuePurchase(base, line, 300);
    expect(next.pending).toHaveLength(2);
  });
  it("persists several observations without replacing earlier commands", async () => {
    const first = await queuePurchase(base, line, 200);
    const next = await queuePurchase(first, line, 300);
    expect(next.pending).toHaveLength(2);
    expect(next.pending.map((p) => p.expectedRevision)).toEqual([1, 2]);
  });
});

describe("shopping load cancellation", () => {
  it("does not repopulate cleared device data after a pending response", async () => {
    let complete: (value: unknown) => void = () => {};
    vi.mocked(mealsRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const loading = loadShopping("s");
    await vi.waitFor(() => expect(mealsRequest).toHaveBeenCalled());
    await saveCachedShopping(null);
    complete(base.cycle);
    await expect(loading).rejects.toThrow("cleared");
    expect(await cachedShopping()).toBeNull();
  });
  it("does not cache an old selection after its load is cancelled", async () => {
    const controller = new AbortController();
    let complete: (value: unknown) => void = () => {};
    vi.mocked(mealsRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const loading = loadShopping("s", controller.signal);
    await vi.waitFor(() => expect(mealsRequest).toHaveBeenCalled());
    controller.abort();
    complete(base.cycle);
    await expect(loading).rejects.toThrow("selection changed");
    expect(await cachedShopping()).toEqual(base);
  });
  it("explicitly retries unchanged conflict at the latest revision and preserves later observations", async () => {
    const queued = await queuePurchase(base, line, 500);
    await saveCachedShopping({
      ...queued,
      pending: queued.pending.map((p) => ({
        ...p,
        status: "conflict" as const,
      })),
    });
    vi.mocked(mealsRequest)
      .mockResolvedValueOnce({ ...base.cycle, revision: 7 })
      .mockResolvedValueOnce({ ...base.cycle, revision: 8 });
    await reconcileShoppingPurchase("fixed-operation");
    expect(vi.mocked(mealsRequest).mock.calls[1][2]).toMatchObject({
      expectedRevision: 7,
    });
    expect((await cachedShopping())?.pending).toEqual([]);
  });
  it("retains changed ingredient observations instead of retargeting them", async () => {
    const queued = await queuePurchase(base, line, 500);
    await saveCachedShopping({
      ...queued,
      pending: queued.pending.map((p) => ({
        ...p,
        status: "conflict" as const,
      })),
    });
    vi.mocked(mealsRequest).mockResolvedValueOnce({
      ...base.cycle,
      revision: 7,
      lines: [{ ...line, fingerprint: "changed" }],
    });
    await expect(reconcileShoppingPurchase("fixed-operation")).rejects.toThrow(
      "meaning or amount changed",
    );
    expect((await cachedShopping())?.pending).toHaveLength(1);
    expect(mealsRequest).toHaveBeenCalledTimes(1);
  });
});

describe("explicit reconciliation recovery", () => {
  it("persists a new retry identity before network loss and reuses it on reconnect", async () => {
    const queued = await queuePurchase(base, line, 500);
    await saveCachedShopping({
      ...queued,
      pending: queued.pending.map((p) => ({
        ...p,
        status: "conflict" as const,
      })),
    });
    vi.mocked(mealsRequest)
      .mockResolvedValueOnce({ ...base.cycle, revision: 7 })
      .mockRejectedValueOnce(new TypeError("network lost"));
    await expect(reconcileShoppingPurchase("fixed-operation")).rejects.toThrow(
      "network lost",
    );
    expect((await cachedShopping())?.pending[0].operationId).toBe(
      "fixed-operation-2",
    );
    vi.mocked(mealsRequest).mockResolvedValueOnce({
      ...base.cycle,
      revision: 8,
    });
    await flushShopping();
    const calls = vi.mocked(mealsRequest).mock.calls;
    expect(calls[1][2]).toEqual(calls[2][2]);
  });
});

it("keeps an incompatible observation without blocking later purchase commands", async () => {
  const first = await queuePurchase(base, line, 200);
  const both = await queuePurchase(first, line, 300);
  await saveCachedShopping({
    ...both,
    pending: both.pending.map((p, i) =>
      i === 0 ? { ...p, status: "conflict" as const } : p,
    ),
  });
  const next = await retainConflictedPurchase("fixed-operation");
  expect(next.pending).toHaveLength(1);
  expect(next.unresolvedPurchases).toHaveLength(1);
  expect(next.pending[0].operationId).toBe("fixed-operation-2");
});
