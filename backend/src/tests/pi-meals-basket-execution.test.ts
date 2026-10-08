import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { RecipeSelection } from "../pi-meals/contracts.js";
import {
  changeShoppingCycle,
  shoppingFingerprint,
} from "../pi-meals/shopping-cycle.js";
const { state, launch, stopAside, inspectAside } = vi.hoisted(() => ({
  state: { selection: null as RecipeSelection | null },
  launch: vi.fn(),
  stopAside: vi.fn(),
  inspectAside: vi.fn(),
}));
vi.mock("../pi-meals/aside.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pi-meals/aside.js")>()),
  launchAsideAttempt: launch,
  stopAndInspectAsideSession: stopAside,
  inspectAsideSession: inspectAside,
}));
vi.mock("../pi-meals/selections.js", () => ({
  getSelection: async () => state.selection,
}));
import {
  createBasket,
  prepareBasket,
  fillBasket,
  getBasket,
  reconcileBasket,
  openAsideBasket,
  finishAsideBasket,
  stopAsideBasket,
  executionOwnerState,
  executionOwner,
} from "../pi-meals/baskets.js";
function database() {
  const docs = new Map<string, any>(),
    ops = new Map<string, any>();
  let transactions = Promise.resolve();
  const db: any = {
    piMealDocument: {
      findUnique: async ({ where }: any) => docs.get(where.id) ?? null,
      findMany: async ({ where }: any) =>
        [...docs.values()].filter((row) => row.kind === where.kind),
      create: async ({ data }: any) => {
        docs.set(data.id, data);
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        const row = docs.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        docs.set(where.id, { ...row, ...data });
        return { count: 1 };
      },
    },
    piMealOperation: {
      findUnique: async ({ where }: any) => ops.get(where.id) ?? null,
      create: async ({ data }: any) => {
        ops.set(data.id, structuredClone(data));
        return data;
      },
      update: async ({ where, data }: any) => {
        ops.set(where.id, { ...ops.get(where.id), ...structuredClone(data) });
      },
    },
    $transaction: async (fn: any) => {
      const previous = transactions;
      let release!: () => void;
      transactions = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const docSnapshot = structuredClone(docs),
        opSnapshot = structuredClone(ops);
      try {
        return await fn(db);
      } catch (error) {
        docs.clear();
        ops.clear();
        for (const [id, row] of docSnapshot) docs.set(id, row);
        for (const [id, row] of opSnapshot) ops.set(id, row);
        throw error;
      } finally {
        release();
      }
    },
  };
  return db as PrismaClient;
}
const observed = (items: Array<{ productId: string; quantity: number }>) => ({
  verified: true as const,
  items,
  evidence: { source: "test" },
});
async function ready(
  prisma: PrismaClient,
  executor: "ocado" | "aside" = "ocado",
  suffix = "",
) {
  const basket = await createBasket(prisma, "actor", {
    operationId: `create${suffix}`,
    selectionId: "s",
    executor,
  });
  return prepareBasket(prisma, basket.id, "actor", {
    operationId: `prepare${suffix}`,
    expectedRevision: basket.revision,
    lines: [
      {
        id: "a",
        name: "Flour",
        quantity: 800,
        unit: "g",
        productId: "12345",
        productName: "Flour",
        packQuantity: 500,
        packUnit: "g",
      },
    ],
  });
}
beforeEach(() => {
  state.selection = {
    id: "s",
    revision: 1,
    title: "Dinner",
    items: [],
    stock: [],
    updatedAt: "now",
    lines: [
      {
        id: "a",
        name: "Flour",
        quantity: 800,
        unit: "g",
        buyQuantity: 800,
        haveQuantity: 0,
        sources: [],
        warnings: [],
      },
    ],
  };
});
describe("basket effects", () => {
  it("records full readback and replays the same receipt without a second mutation", async () => {
    const db = database(),
      basket = await ready(db),
      input = {
        operationId: "fill",
        expectedRevision: basket.revision,
        selectionRevision: 1,
      };
    let packs = 1;
    const addPacks = vi.fn(async (_id: string, n: number) => {
      packs += n;
    });
    const deps = {
      mutationsEnabled: true,
      executor: {
        readCart: async () =>
          observed([
            { productId: "manual", quantity: 4 },
            { productId: "12345", quantity: packs },
          ]),
        addPacks,
      },
    };
    const result = await fillBasket(db, basket.id, "actor", input, deps);
    expect(result.status).toBe("complete");
    expect((result.receipt as any).after.items).toContainEqual({
      productId: "manual",
      quantity: 4,
    });
    expect(await fillBasket(db, basket.id, "actor", input, deps)).toEqual(
      result,
    );
    expect(addPacks).toHaveBeenCalledTimes(1);
    expect(addPacks).toHaveBeenCalledWith("12345", 2, expect.any(Function));
  });
  it("stale approval never calls the executor", async () => {
    const db = database(),
      basket = await ready(db);
    state.selection!.revision = 2;
    const addPacks = vi.fn();
    await expect(
      fillBasket(
        db,
        basket.id,
        "actor",
        {
          operationId: "fill",
          expectedRevision: basket.revision,
          selectionRevision: 1,
        },
        {
          mutationsEnabled: true,
          executor: { readCart: async () => observed([]), addPacks },
        },
      ),
    ).rejects.toThrow("selection changed");
    expect(addPacks).not.toHaveBeenCalled();
  });
  it("unknown reads never become empty baselines or writes", async () => {
    const db = database(),
      basket = await ready(db),
      addPacks = vi.fn();
    const result = await fillBasket(
      db,
      basket.id,
      "actor",
      {
        operationId: "fill",
        expectedRevision: basket.revision,
        selectionRevision: 1,
      },
      {
        mutationsEnabled: true,
        executor: {
          readCart: async () => {
            throw new Error("unknown cart");
          },
          addPacks,
        },
      },
    );
    expect(result.status).toBe("needs_review");
    expect((result.receipt as any).baseline).toBeUndefined();
    expect(addPacks).not.toHaveBeenCalled();
  });
  it("persists uncertain intent and never replays an interrupted write", async () => {
    const db = database(),
      basket = await ready(db),
      input = {
        operationId: "fill",
        expectedRevision: basket.revision,
        selectionRevision: 1,
      },
      addPacks = vi.fn(async () => {
        throw new Error("connection lost after click");
      });
    const deps = {
      mutationsEnabled: true,
      executor: {
        readCart: async () => observed([{ productId: "manual", quantity: 3 }]),
        addPacks,
      },
    };
    const result = await fillBasket(db, basket.id, "actor", input, deps);
    expect(result.status).toBe("needs_review");
    expect((result.receipt as any).uncertain).toBe(true);
    expect((result.receipt as any).intent.targetQuantity).toBe(2);
    expect(await fillBasket(db, basket.id, "actor", input, deps)).toEqual(
      result,
    );
    expect(addPacks).toHaveBeenCalledTimes(1);
    expect((await getBasket(db, basket.id))?.executor).toBe("ocado");
    const reconciled = await reconcileBasket(
      db,
      basket.id,
      "actor",
      { operationId: "reconcile", expectedRevision: result.revision },
      deps,
    );
    expect(reconciled.status).toBe("needs_review");
    expect(addPacks).toHaveBeenCalledTimes(1);
  });
  it("keeps one Aside task identity on duplicate fill without launching a browser", async () => {
    const db = database(),
      basket = await ready(db, "aside"),
      input = {
        operationId: "fill",
        expectedRevision: basket.revision,
        selectionRevision: 1,
      };
    const result = await fillBasket(db, basket.id, "actor", input);
    expect(result.status).toBe("needs_review");
    expect((await fillBasket(db, basket.id, "actor", input)).taskId).toBe(
      result.taskId,
    );
  });
});

describe("attended Aside launch receipts", () => {
  it.each([false, true])(
    "launches Aside to resolve unknown amounts with known lines present: %s",
    async (known) => {
      vi.stubEnv("PI_MEALS_ASIDE_LAUNCH_ENABLED", "true");
      launch.mockResolvedValue({
        processId: 123,
        logPath: "/test/attempt.log",
      });
      const salt = {
        ...state.selection!.lines[0],
        id: "salt",
        name: "Salt",
        quantity: null,
        buyQuantity: null,
        unit: "",
      };
      state.selection!.lines = known
        ? [...state.selection!.lines, salt]
        : [salt];
      try {
        const db = database();
        const basket = await createBasket(db, "actor", {
          operationId: "create",
          selectionId: "s",
          executor: "aside",
        });
        expect(basket.unresolved.join(" ")).toContain("Aside");
        const opened = await openAsideBasket(db, basket.id, "actor", {
          operationId: "open",
          expectedRevision: basket.revision,
        });
        expect(launch).toHaveBeenCalledTimes(1);
        const handoff = (opened.receipt as any).handoff;
        expect(handoff).toContain('"quantity": null');
        expect(handoff).toContain('"needsReview": true');
        expect(handoff).toContain("do not invent an amount");
        if (known) expect(handoff).toContain('"quantity": 800');
        const directDb = database();
        const direct = await createBasket(directDb, "actor", {
          operationId: "direct",
          selectionId: "s",
          executor: "ocado",
        });
        await expect(
          prepareBasket(directDb, direct.id, "actor", {
            operationId: "prepare",
            expectedRevision: direct.revision,
            lines: [],
          }),
        ).rejects.toThrow("Resolve ingredient quantities");
      } finally {
        vi.unstubAllEnvs();
        launch.mockReset();
      }
    },
  );

  it("records process identity and exact handoff and never launches a replay", async () => {
    vi.stubEnv("PI_MEALS_ASIDE_LAUNCH_ENABLED", "true");
    launch.mockResolvedValue({ processId: 123, logPath: "/test/attempt.log" });
    try {
      const db = database(),
        basket = await createBasket(db, "actor", {
          operationId: "create",
          selectionId: "s",
          executor: "aside",
        }),
        input = { operationId: "open", expectedRevision: basket.revision };
      const result = await openAsideBasket(db, basket.id, "actor", input);
      expect(result.status).toBe("needs_review");
      expect(result.receipt).toMatchObject({
        processId: 123,
        uncertain: true,
        checkout: false,
      });
      expect((result.receipt as any).handoff).toContain("800");
      expect(await openAsideBasket(db, basket.id, "actor", input)).toEqual(
        result,
      );
      expect(launch).toHaveBeenCalledTimes(1);
      await expect(
        openAsideBasket(db, basket.id, "actor", {
          operationId: "again",
          expectedRevision: result.revision,
        }),
      ).rejects.toThrow("execution already exists");
      expect(launch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      launch.mockReset();
    }
  });
  it("retains an uncertain attempt when process launch fails", async () => {
    vi.stubEnv("PI_MEALS_ASIDE_LAUNCH_ENABLED", "true");
    launch.mockRejectedValue(new Error("binary missing"));
    try {
      const db = database(),
        basket = await ready(db, "aside");
      const result = await openAsideBasket(db, basket.id, "actor", {
        operationId: "open",
        expectedRevision: basket.revision,
      });
      expect(result.receipt).toMatchObject({
        effect: "aside_launch_unresolved",
        error: "binary missing",
        uncertain: true,
      });
      expect(result.status).toBe("needs_review");
    } finally {
      vi.unstubAllEnvs();
      launch.mockReset();
    }
  });
});

describe("durable retailer account ownership", () => {
  it("blocks concurrent fills of different baskets across household actors and preserves manual cart items", async () => {
    const db = database(),
      first = await ready(db, "ocado", "first"),
      second = await ready(db, "ocado", "second");
    let release!: () => void,
      started!: () => void,
      packs = 1;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    const readCart = vi.fn(async () =>
      observed([
        { productId: "manual", quantity: 4 },
        { productId: "12345", quantity: packs },
      ]),
    );
    const addPacks = vi.fn(async (_id: string, count: number) => {
      started();
      await waiting;
      packs += count;
    });
    const deps = { mutationsEnabled: true, executor: { readCart, addPacks } };
    const filling = fillBasket(
      db,
      first.id,
      "James",
      {
        operationId: "first-fill",
        expectedRevision: first.revision,
        selectionRevision: 1,
      },
      deps,
    );
    await entered;
    await expect(
      fillBasket(
        db,
        second.id,
        "Manon",
        {
          operationId: "second-fill",
          expectedRevision: second.revision,
          selectionRevision: 1,
        },
        deps,
      ),
    ).rejects.toThrow("active or uncertain");
    expect(addPacks).toHaveBeenCalledTimes(1);
    release();
    const result = await filling;
    expect(result.status).toBe("complete");
    expect((result.receipt as any).after.items).toContainEqual({
      productId: "manual",
      quantity: 4,
    });
  });
  it("read-only reconciliation leaves an unfilled basket available for preparation", async () => {
    const db = database(),
      basket = await createBasket(db, "actor", {
        operationId: "new",
        selectionId: "s",
        executor: "ocado",
      });
    const readCart = vi.fn(async () => observed([]));
    await expect(
      reconcileBasket(
        db,
        basket.id,
        "actor",
        { operationId: "check", expectedRevision: basket.revision },
        { executor: { readCart, addPacks: vi.fn() } },
      ),
    ).rejects.toThrow("has not been filled");
    expect(readCart).not.toHaveBeenCalled();
    expect((await getBasket(db, basket.id))?.receipt).toBeUndefined();
    expect(
      (
        await prepareBasket(db, basket.id, "actor", {
          operationId: "prepare-new",
          expectedRevision: basket.revision,
          lines: [
            {
              id: "a",
              name: "Flour",
              quantity: 800,
              unit: "g",
              productId: "12345",
              productName: "Flour",
              packQuantity: 500,
              packUnit: "g",
            },
          ],
        })
      ).status,
    ).toBe("ready");
  });
  it("recovers a crashed running owner by readback without replaying an uncertain write", async () => {
    const db = database(),
      basket = await ready(db),
      successor = await ready(db, "ocado", "next");
    const update = db.piMealDocument.updateMany.bind(db.piMealDocument);
    vi.spyOn(
      db.piMealDocument as unknown as {
        updateMany: (args: any) => Promise<any>;
      },
      "updateMany",
    ).mockImplementation(async (args: any) => {
      if (args.data.data?.receipt?.effect === "write_uncertain")
        throw new Error("owner exited before failure receipt");
      return update(args);
    });
    let packs = 0;
    const addPacks = vi.fn(async (_id: string, count: number) => {
      packs += count;
      throw new Error("owner crashed after click");
    });
    const readCart = vi.fn(async () =>
      observed([
        { productId: "manual", quantity: 4 },
        ...(packs ? [{ productId: "12345", quantity: packs }] : []),
      ]),
    );
    await expect(
      fillBasket(
        db,
        basket.id,
        "actor",
        {
          operationId: "crash",
          expectedRevision: basket.revision,
          selectionRevision: 1,
        },
        { mutationsEnabled: true, executor: { readCart, addPacks } },
      ),
    ).rejects.toThrow("owner exited");
    const running = (await getBasket(db, basket.id))!;
    expect(running.status).toBe("running");
    expect((running.receipt as any).owner.processId).toBeGreaterThan(0);
    expect((running.receipt as any).baseline.items).toContainEqual({
      productId: "manual",
      quantity: 4,
    });
    await expect(
      reconcileBasket(
        db,
        basket.id,
        "actor",
        { operationId: "still-live", expectedRevision: running.revision },
        { executor: { readCart, addPacks }, ownerState: () => "live" },
      ),
    ).rejects.toThrow("cannot be proven dead");
    const result = await reconcileBasket(
      db,
      basket.id,
      "actor",
      { operationId: "recover", expectedRevision: running.revision },
      { executor: { readCart, addPacks }, ownerState: () => "dead" },
    );
    expect(result.status).toBe("complete");
    expect(addPacks).toHaveBeenCalledTimes(1);
    expect((result.receipt as any).intent.targetQuantity).toBe(2);
    const next = await fillBasket(
      db,
      successor.id,
      "actor",
      {
        operationId: "next-fill",
        expectedRevision: successor.revision,
        selectionRevision: 1,
      },
      {
        mutationsEnabled: true,
        executor: {
          readCart,
          addPacks: async (_id, n) => {
            packs += n;
          },
        },
      },
    );
    expect(next.status).toBe("complete");
  });
  it("keeps the account blocked after an uncertain write and for unverified Aside remote termination", async () => {
    const db = database(),
      basket = await ready(db),
      successor = await ready(db, "ocado", "next");
    const deps = {
      mutationsEnabled: true,
      executor: {
        readCart: async () => observed([{ productId: "manual", quantity: 4 }]),
        addPacks: vi.fn(async () => {
          throw new Error("uncertain click");
        }),
      },
    };
    await fillBasket(
      db,
      basket.id,
      "actor",
      {
        operationId: "uncertain",
        expectedRevision: basket.revision,
        selectionRevision: 1,
      },
      deps,
    );
    await expect(
      fillBasket(
        db,
        successor.id,
        "other",
        {
          operationId: "next-fill",
          expectedRevision: successor.revision,
          selectionRevision: 1,
        },
        deps,
      ),
    ).rejects.toThrow("active or uncertain");
    vi.stubEnv("PI_MEALS_ASIDE_LAUNCH_ENABLED", "true");
    launch.mockResolvedValue({ processId: 123, logPath: "/test/attempt.log" });
    try {
      const otherDb = database(),
        aside = await ready(otherDb, "aside"),
        next = await ready(otherDb, "ocado", "next");
      const result = await openAsideBasket(otherDb, aside.id, "actor", {
        operationId: "open",
        expectedRevision: aside.revision,
      });
      const reconciled = await reconcileBasket(
        otherDb,
        aside.id,
        "actor",
        { operationId: "check", expectedRevision: result.revision },
        { ownerState: () => "dead", executor: deps.executor },
      );
      expect(reconciled.status).toBe("needs_review");
      expect((reconciled.receipt as any).remoteTerminationUnknown).toBe(true);
      await expect(
        fillBasket(
          otherDb,
          next.id,
          "other",
          {
            operationId: "blocked",
            expectedRevision: next.revision,
            selectionRevision: 1,
          },
          deps,
        ),
      ).rejects.toThrow("active or uncertain");
    } finally {
      vi.unstubAllEnvs();
      launch.mockReset();
    }
  });
  it("treats an owner on another host as unknown", () => {
    expect(
      executionOwnerState({
        host: "different-host",
        processId: 123,
        hostIdentity: "not-local",
      }),
    ).toBe("unknown");
  });
  it("uses the original manifest for crash reconciliation even if stored lines were changed", async () => {
    const db = database(),
      basket = await ready(db);
    const update = db.piMealDocument.updateMany.bind(db.piMealDocument);
    vi.spyOn(
      db.piMealDocument as unknown as {
        updateMany: (args: any) => Promise<any>;
      },
      "updateMany",
    ).mockImplementation(async (args: any) => {
      if (args.data.data?.receipt?.effect === "write_uncertain")
        throw new Error("crash");
      return update(args);
    });
    const addPacks = vi.fn(async () => {
      throw new Error("crash");
    });
    await expect(
      fillBasket(
        db,
        basket.id,
        "actor",
        {
          operationId: "fill",
          expectedRevision: basket.revision,
          selectionRevision: 1,
        },
        {
          mutationsEnabled: true,
          executor: {
            readCart: async () =>
              observed([{ productId: "manual", quantity: 4 }]),
            addPacks,
          },
        },
      ),
    ).rejects.toThrow();
    const row = (await db.piMealDocument.findUnique({
      where: { id: basket.id },
    }))!;
    await update({
      where: { id: basket.id, revision: row.revision },
      data: {
        data: {
          ...(row.data as any),
          lines: [{ ...(row.data as any).lines[0], packs: 1 }],
        },
      },
    });
    const result = await reconcileBasket(
      db,
      basket.id,
      "actor",
      { operationId: "recover", expectedRevision: row.revision },
      {
        ownerState: () => "dead",
        executor: {
          readCart: async () =>
            observed([
              { productId: "manual", quantity: 4 },
              { productId: "12345", quantity: 1 },
            ]),
          addPacks,
        },
      },
    );
    expect(result.status).toBe("needs_review");
    expect(result.unresolved).toContain(
      "Product 12345: expected 2, observed 1.",
    );
    expect(addPacks).toHaveBeenCalledTimes(1);
  });
});

describe("supermarket basket source binding", () => {
  it("excludes market and top-up lines and subtracts bought quantities from the supermarket manifest", async () => {
    const db = database();
    state.selection!.lines.push(
      {
        ...state.selection!.lines[0],
        id: "b",
        name: "Tomatoes",
        quantity: 400,
        buyQuantity: 400,
      },
      {
        ...state.selection!.lines[0],
        id: "c",
        name: "Herbs",
        quantity: 50,
        buyQuantity: 50,
      },
    );
    await changeShoppingCycle(db, "s", "actor", {
      expectedActorId: "actor",
      operationId: "market",
      expectedRevision: 0,
      command: { type: "route", lineId: "b", route: "market" },
    });
    await changeShoppingCycle(db, "s", "actor", {
      expectedActorId: "actor",
      operationId: "topup",
      expectedRevision: 1,
      command: { type: "route", lineId: "c", route: "topup" },
    });
    await changeShoppingCycle(db, "s", "actor", {
      expectedActorId: "actor",
      operationId: "bought",
      expectedRevision: 2,
      command: {
        type: "purchase",
        lineId: "a",
        quantity: 300,
        unit: "g",
        observedFingerprint: shoppingFingerprint(state.selection!.lines[0]),
        purchasedAt: "2026-10-07T12:00:00.000Z",
      },
    });
    const basket = await createBasket(db, "actor", {
      operationId: "create",
      selectionId: "s",
      executor: "ocado",
    });
    expect(basket.lines).toEqual([
      { id: "a", name: "Flour", quantity: 500, unit: "g" },
    ]);
    expect(basket.shoppingCycleRevision).toBe(3);
    const readyBasket = await prepareBasket(db, basket.id, "actor", {
      operationId: "prepare",
      expectedRevision: basket.revision,
      lines: [
        {
          ...basket.lines[0],
          productId: "12345",
          productName: "Flour",
          packQuantity: 500,
          packUnit: "g",
        },
      ],
    });
    expect(readyBasket.lines[0].packs).toBe(1);
    await changeShoppingCycle(db, "s", "actor", {
      expectedActorId: "actor",
      operationId: "route-after-review",
      expectedRevision: 3,
      command: { type: "route", lineId: "a", route: "market" },
    });
    const addPacks = vi.fn(),
      readCart = vi.fn();
    await expect(
      fillBasket(
        db,
        basket.id,
        "actor",
        {
          operationId: "fill",
          expectedRevision: readyBasket.revision,
          selectionRevision: 1,
        },
        { mutationsEnabled: true, executor: { readCart, addPacks } },
      ),
    ).rejects.toThrow("routes or purchases changed");
    expect(readCart).not.toHaveBeenCalled();
    expect(addPacks).not.toHaveBeenCalled();
  });
  it("keeps unknown supermarket quantities unresolved instead of defaulting to one pack", async () => {
    const db = database();
    state.selection!.lines[0].quantity = null;
    state.selection!.lines[0].buyQuantity = null;
    const basket = await createBasket(db, "actor", {
      operationId: "create",
      selectionId: "s",
      executor: "ocado",
    });
    expect(basket.lines[0].quantity).toBe(0);
    await expect(
      prepareBasket(db, basket.id, "actor", {
        operationId: "prepare",
        expectedRevision: basket.revision,
        lines: [
          {
            ...basket.lines[0],
            quantity: 1,
            productId: "12345",
            productName: "Flour",
            packQuantity: 500,
            packUnit: "g",
          },
        ],
      }),
    ).rejects.toThrow("Resolve ingredient quantities");
  });
});

it("releases a crashed owner that never recorded a write intent, without pretending the basket was filled", async () => {
  const db = database(),
    basket = await ready(db),
    successor = await ready(db, "ocado", "next");
  const update = db.piMealDocument.updateMany.bind(db.piMealDocument);
  vi.spyOn(
    db.piMealDocument as unknown as { updateMany: (args: any) => Promise<any> },
    "updateMany",
  ).mockImplementation(async (args: any) => {
    if (args.data.data?.receipt?.effect === "read_failed")
      throw new Error("owner exited before receipt");
    return update(args);
  });
  const addPacks = vi.fn();
  await expect(
    fillBasket(
      db,
      basket.id,
      "actor",
      {
        operationId: "crash",
        expectedRevision: basket.revision,
        selectionRevision: 1,
      },
      {
        mutationsEnabled: true,
        executor: {
          readCart: async () => {
            throw new Error("read failed");
          },
          addPacks,
        },
      },
    ),
  ).rejects.toThrow("owner exited");
  const running = (await getBasket(db, basket.id))!;
  const result = await reconcileBasket(
    db,
    basket.id,
    "actor",
    { operationId: "recover", expectedRevision: running.revision },
    {
      ownerState: () => "dead",
      executor: { readCart: async () => observed([]), addPacks },
    },
  );
  expect(result.status).toBe("needs_review");
  expect(result.receipt).toMatchObject({
    noWritesAttempted: true,
    uncertain: false,
  });
  expect(addPacks).not.toHaveBeenCalled();
  let quantity = 0;
  const next = await fillBasket(
    db,
    successor.id,
    "actor",
    {
      operationId: "next",
      expectedRevision: successor.revision,
      selectionRevision: 1,
    },
    {
      mutationsEnabled: true,
      executor: {
        readCart: async () =>
          observed(quantity ? [{ productId: "12345", quantity }] : []),
        addPacks: async (_id, n) => {
          quantity += n;
        },
      },
    },
  );
  expect(next.status).toBe("complete");
});

it("checks the actual local owner identity and an absent process without treating a different host as dead", () => {
  const owner = executionOwner();
  expect(owner.hostIdentity).toBeTruthy();
  expect(owner.processStart).toBeTruthy();
  expect(executionOwnerState(owner)).toBe("live");
  expect(executionOwnerState({ ...owner, processId: 2147483647 })).toBe("dead");
});

it("atomically gives only one of two simultaneous basket fills the shared account", async () => {
  const db = database(),
    first = await ready(db, "ocado", "first"),
    second = await ready(db, "ocado", "second");
  let packs = 1;
  const addPacks = vi.fn(async (_id: string, count: number) => {
    packs += count;
  });
  const deps = {
    mutationsEnabled: true,
    executor: {
      readCart: async () =>
        observed([
          { productId: "manual", quantity: 4 },
          { productId: "12345", quantity: packs },
        ]),
      addPacks,
    },
  };
  const results = await Promise.allSettled([
    fillBasket(
      db,
      first.id,
      "James",
      {
        operationId: "first-fill",
        expectedRevision: first.revision,
        selectionRevision: 1,
      },
      deps,
    ),
    fillBasket(
      db,
      second.id,
      "Manon",
      {
        operationId: "second-fill",
        expectedRevision: second.revision,
        selectionRevision: 1,
      },
      deps,
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(addPacks).toHaveBeenCalledTimes(1);
  expect(packs).toBe(3);
  const completed = results.find(
    (result) => result.status === "fulfilled",
  ) as PromiseFulfilledResult<any>;
  expect(completed.value.receipt.after.items).toContainEqual({
    productId: "manual",
    quantity: 4,
  });
});
it("a simultaneous duplicate operation never executes a second write", async () => {
  const db = database(),
    basket = await ready(db);
  let quantity = 0;
  const input = {
      operationId: "fill",
      expectedRevision: basket.revision,
      selectionRevision: 1,
    },
    addPacks = vi.fn(async (_id: string, count: number) => {
      quantity += count;
    });
  const deps = {
    mutationsEnabled: true,
    executor: {
      readCart: async () =>
        observed(quantity ? [{ productId: "12345", quantity }] : []),
      addPacks,
    },
  };
  await Promise.all([
    fillBasket(db, basket.id, "actor", input, deps),
    fillBasket(db, basket.id, "actor", input, deps),
  ]);
  expect(addPacks).toHaveBeenCalledTimes(1);
  expect(quantity).toBe(2);
});
it("an uncertain legacy basket without a guard blocks new account effects", async () => {
  const db = database(),
    basket = await ready(db);
  await db.piMealDocument.create({
    data: {
      id: "legacy",
      kind: "basket",
      revision: 1,
      data: {
        selectionId: "other",
        selectionRevision: 1,
        status: "running",
        executor: "ocado",
        lines: [],
        unresolved: [],
        receipt: { effect: "write_intent", uncertain: true },
      },
      updatedAt: new Date(),
    },
  });
  const readCart = vi.fn(),
    addPacks = vi.fn();
  await expect(
    fillBasket(
      db,
      basket.id,
      "actor",
      {
        operationId: "fill",
        expectedRevision: basket.revision,
        selectionRevision: 1,
      },
      { mutationsEnabled: true, executor: { readCart, addPacks } },
    ),
  ).rejects.toThrow("legacy");
  expect(readCart).not.toHaveBeenCalled();
  expect(addPacks).not.toHaveBeenCalled();
});

describe("post-stop user review of owned Aside shopping", () => {
  const sessionId = "8kvJyD90jE3458Z2";
  beforeEach(() => {
    vi.stubEnv("PI_MEALS_ASIDE_LAUNCH_ENABLED", "true");
    launch.mockResolvedValue({
      processId: 123,
      logPath: "/test/attempt.log",
      sessionId,
      sessionIdentity: "captured",
    });
    stopAside.mockImplementation(async () => ({
      sessionId,
      status: "idle",
      stopSucceeded: true,
      observedAt: new Date().toISOString(),
      evidence: {
        source: "aside-session-list",
        row: `${sessionId} idle ephemeral Shopping`,
      },
    }));
    inspectAside.mockImplementation(async () => ({
      sessionId,
      status: "idle",
      row: `${sessionId} idle ephemeral Shopping`,
      observedAt: new Date().toISOString(),
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    launch.mockReset();
    stopAside.mockReset();
    inspectAside.mockReset();
  });
  async function started(db: PrismaClient) {
    const basket = await ready(db, "aside");
    return openAsideBasket(db, basket.id, "James", {
      operationId: "open",
      expectedRevision: basket.revision,
    });
  }
  function confirmation(
    basket: Awaited<ReturnType<typeof getBasket>>,
    operationId = "finish",
  ) {
    const receipt = basket!.receipt as any;
    return {
      operationId,
      expectedRevision: basket!.revision,
      confirmedTrolley: true as const,
      stoppedSessionId: receipt.sessionId,
      reviewToken: receipt.reviewToken,
    };
  }
  it("requires a separate post-stop review even when the task changes the trolley just before stopping", async () => {
    const db = database(),
      launched = await started(db),
      next = await ready(db, "ocado", "next");
    let trolleyPacks = 1;
    const events: string[] = [];
    stopAside.mockImplementation(async () => {
      trolleyPacks = 3;
      events.push("task-write-before-stop", "session-stopped");
      return {
        sessionId,
        status: "idle",
        stopSucceeded: true,
        observedAt: new Date().toISOString(),
        evidence: {
          source: "aside-session-list",
          row: `${sessionId} idle ephemeral Shopping`,
        },
      };
    });
    await expect(
      finishAsideBasket(db, launched.id, "Manon", {
        operationId: "early-confirm",
        expectedRevision: launched.revision,
        confirmedTrolley: true,
        stoppedSessionId: sessionId,
        reviewToken: "not-issued",
      }),
    ).rejects.toThrow("Stop the recorded Aside task first");
    expect(stopAside).not.toHaveBeenCalled();
    expect(inspectAside).not.toHaveBeenCalled();
    const stopInput = {
      operationId: "stop",
      expectedRevision: launched.revision,
    };
    const stopped = await stopAsideBasket(db, launched.id, "James", stopInput);
    expect(stopped.status).toBe("needs_review");
    expect(stopped.receipt).toMatchObject({
      effect: "aside_stopped_for_review",
      uncertain: true,
      remoteTerminationUnknown: false,
      reviewRevision: stopped.revision,
    });
    expect((stopped.receipt as any).confirmedAt).toBeUndefined();
    expect((stopped.receipt as any).verification).toBeUndefined();
    expect(await stopAsideBasket(db, launched.id, "James", stopInput)).toEqual(
      stopped,
    );
    expect(stopAside).toHaveBeenCalledTimes(1);
    await expect(
      fillBasket(
        db,
        next.id,
        "James",
        {
          operationId: "before-review",
          expectedRevision: next.revision,
          selectionRevision: 1,
        },
        {
          mutationsEnabled: true,
          executor: { readCart: vi.fn(), addPacks: vi.fn() },
        },
      ),
    ).rejects.toThrow("active or uncertain");
    expect(trolleyPacks).toBe(3);
    events.push("user-reviews-three-packs");
    inspectAside.mockImplementation(async () => {
      events.push("post-review-idle-check");
      return {
        sessionId,
        status: "idle",
        row: `${sessionId} idle ephemeral Shopping`,
        observedAt: new Date().toISOString(),
      };
    });
    const input = confirmation(stopped);
    const finished = await finishAsideBasket(db, launched.id, "Manon", input);
    expect(finished.status).toBe("complete");
    expect(finished.receipt).toMatchObject({
      verification: "user",
      confirmedBy: "Manon",
      confirmedTrolley: true,
      remoteTerminationUnknown: false,
      uncertain: false,
      checkout: false,
    });
    expect((finished.receipt as any).after).toBeUndefined();
    expect(events).toEqual([
      "task-write-before-stop",
      "session-stopped",
      "user-reviews-three-packs",
      "post-review-idle-check",
    ]);
    expect(
      Date.parse((finished.receipt as any).confirmedAt),
    ).toBeGreaterThanOrEqual(
      Date.parse((stopped.receipt as any).sessionStopped.observedAt),
    );
    expect(await finishAsideBasket(db, launched.id, "Manon", input)).toEqual(
      finished,
    );
    expect(inspectAside).toHaveBeenCalledTimes(1);
    const result = await fillBasket(
      db,
      next.id,
      "James",
      {
        operationId: "next-fill",
        expectedRevision: next.revision,
        selectionRevision: 1,
      },
      {
        mutationsEnabled: true,
        executor: {
          readCart: async () =>
            observed([
              { productId: "manual", quantity: 4 },
              { productId: "12345", quantity: trolleyPacks },
            ]),
          addPacks: async (_id, n) => {
            trolleyPacks += n;
          },
        },
      },
    );
    expect(result.status).toBe("complete");
    expect((result.receipt as any).after.items).toContainEqual({
      productId: "manual",
      quantity: 4,
    });
  });
  it("rejects pre-stop, false, mismatched session and superseded review confirmations", async () => {
    const db = database(),
      launched = await started(db);
    const early = {
      operationId: "early",
      expectedRevision: launched.revision,
      confirmedTrolley: true as const,
      stoppedSessionId: sessionId,
      reviewToken: "not-issued",
    };
    await expect(
      finishAsideBasket(db, launched.id, "actor", early),
    ).rejects.toThrow("earlier confirmation");
    const first = await stopAsideBasket(db, launched.id, "actor", {
      operationId: "stop-first",
      expectedRevision: launched.revision,
    });
    const second = await stopAsideBasket(db, launched.id, "actor", {
      operationId: "stop-second",
      expectedRevision: first.revision,
    });
    expect((second.receipt as any).reviewToken).not.toBe(
      (first.receipt as any).reviewToken,
    );
    await expect(
      finishAsideBasket(db, launched.id, "actor", {
        ...confirmation(first, "old-token"),
        expectedRevision: second.revision,
      }),
    ).rejects.toThrow("exact review");
    await expect(
      finishAsideBasket(db, launched.id, "actor", {
        ...confirmation(second, "wrong-session"),
        stoppedSessionId: "OtherSession1234",
      }),
    ).rejects.toThrow("exact review");
    await expect(
      finishAsideBasket(db, launched.id, "actor", {
        ...confirmation(second, "false-confirm"),
        confirmedTrolley: false as never,
      }),
    ).rejects.toThrow();
    expect(inspectAside).not.toHaveBeenCalled();
    expect((await getBasket(db, launched.id))?.status).toBe("needs_review");
  });
  it("cannot stop or issue a review token from an unknown session identity", async () => {
    launch.mockResolvedValue({
      processId: 123,
      logPath: "/test/attempt.log",
      sessionIdentity: "unknown",
    });
    const db = database(),
      launched = await started(db);
    expect(launched.taskId).toBeUndefined();
    await expect(
      stopAsideBasket(db, launched.id, "actor", {
        operationId: "stop",
        expectedRevision: launched.revision,
      }),
    ).rejects.toThrow("No captured Aside session");
    expect(stopAside).not.toHaveBeenCalled();
    expect(inspectAside).not.toHaveBeenCalled();
  });
  it("keeps the account held when stop proof fails and never treats pre-stop review as verification", async () => {
    stopAside.mockRejectedValue(new Error("matching session is still running"));
    const db = database(),
      launched = await started(db),
      next = await ready(db, "ocado", "next");
    const input = { operationId: "stop", expectedRevision: launched.revision };
    const unresolved = await stopAsideBasket(db, launched.id, "actor", input);
    expect(unresolved.status).toBe("needs_review");
    expect(unresolved.receipt).toMatchObject({
      effect: "aside_stop_unresolved",
      uncertain: true,
      remoteTerminationUnknown: true,
    });
    expect((unresolved.receipt as any).reviewToken).toBeUndefined();
    expect((unresolved.receipt as any).confirmedAt).toBeUndefined();
    expect(await stopAsideBasket(db, launched.id, "actor", input)).toEqual(
      unresolved,
    );
    expect(stopAside).toHaveBeenCalledTimes(1);
    await expect(
      fillBasket(
        db,
        next.id,
        "actor",
        {
          operationId: "next-fill",
          expectedRevision: next.revision,
          selectionRevision: 1,
        },
        {
          mutationsEnabled: true,
          executor: { readCart: vi.fn(), addPacks: vi.fn() },
        },
      ),
    ).rejects.toThrow("active or uncertain");
  });
  it("invalidates the stopped review if the task resumes, requiring another stop and new review", async () => {
    const db = database(),
      launched = await started(db),
      stopped = await stopAsideBasket(db, launched.id, "actor", {
        operationId: "stop",
        expectedRevision: launched.revision,
      });
    inspectAside.mockResolvedValue({
      sessionId,
      status: "running",
      row: `${sessionId} running ephemeral Shopping`,
      observedAt: new Date().toISOString(),
    });
    const invalid = await finishAsideBasket(
      db,
      launched.id,
      "actor",
      confirmation(stopped),
    );
    expect(invalid.status).toBe("needs_review");
    expect(invalid.receipt).toMatchObject({
      effect: "aside_review_invalidated",
      uncertain: true,
      remoteTerminationUnknown: true,
    });
    expect((invalid.receipt as any).reviewToken).toBeUndefined();
    expect(stopAside).toHaveBeenCalledTimes(1);
    expect((invalid.receipt as any).confirmedAt).toBeUndefined();
  });
});
