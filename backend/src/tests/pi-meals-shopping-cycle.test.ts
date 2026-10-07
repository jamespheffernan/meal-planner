import type { PrismaClient } from "@prisma/client";
import { createSelection } from "../pi-meals/selections.js";
import { describe, it, expect } from "vitest";
import {
  reduceShoppingCycle,
  shoppingCycleView,
  changeShoppingCycle,
} from "../pi-meals/shopping-cycle.js";
import type { RecipeSelection } from "../pi-meals/contracts.js";
const s: RecipeSelection = {
  id: "s",
  revision: 1,
  title: "Shop",
  items: [],
  stock: [],
  updatedAt: "now",
  lines: [
    {
      id: "carrot",
      name: "Carrot",
      quantity: 500,
      unit: "g",
      haveQuantity: 0,
      buyQuantity: 500,
      sources: [],
      warnings: [],
    },
  ],
};
describe("batch route arrival", () => {
  it("updates only remaining items on the chosen route, preserving receipts and other routes", () => {
    const selection = {
      ...s,
      lines: [
        s.lines[0],
        { ...s.lines[0], id: "onion", name: "Onion" },
        { ...s.lines[0], id: "rice", name: "Rice" },
      ],
    };
    let data = reduceShoppingCycle(
      null,
      {
        type: "route",
        lineId: "onion",
        route: "market",
        availableOn: "2026-10-10",
      },
      selection,
      "james",
      "now",
    );
    const rice = shoppingCycleView(data, selection, 0).lines.find(
      (l) => l.id === "rice",
    )!;
    data = reduceShoppingCycle(
      data,
      {
        type: "purchase",
        lineId: "rice",
        quantity: 500,
        unit: "g",
        observedFingerprint: rice.fingerprint,
        purchasedAt: "2026-10-07T10:00:00Z",
      },
      selection,
      "manon",
      "now",
    );
    const next = reduceShoppingCycle(
      data,
      {
        type: "route_defaults",
        route: "supermarket",
        availableOn: "2026-10-08",
        observedSelectionRevision: 1,
      },
      selection,
      "james",
      "now",
    );
    expect(next.purchases).toEqual(data.purchases);
    expect(next.routes.find((r) => r.lineId === "carrot")?.availableOn).toBe(
      "2026-10-08",
    );
    expect(next.routes.find((r) => r.lineId === "onion")?.availableOn).toBe(
      "2026-10-10",
    );
    expect(next.routes.find((r) => r.lineId === "rice")).toBeUndefined();
    expect(shoppingCycleView(next, selection, 1).lines[0].sourceChanged).toBe(
      false,
    );
  });
  it("rejects source selection changes as a conflict", () => {
    expect(() =>
      reduceShoppingCycle(
        null,
        {
          type: "route_defaults",
          route: "supermarket",
          availableOn: "2026-10-08",
          observedSelectionRevision: 0,
        },
        s,
        "james",
        "now",
      ),
    ).toThrow("selection changed");
  });
});
describe("shopping routes and observations", () => {
  it("rejects actor changes before accessing the database", async () => {
    await expect(
      changeShoppingCycle({} as never, "s", "manon", {
        expectedActorId: "james",
        operationId: "offline-1",
        expectedRevision: 0,
        command: { type: "route", lineId: "carrot", route: "market" },
      }),
    ).rejects.toThrow("another member");
  });
  it("keeps planned supply incomplete and flags late arrival", () => {
    const d = reduceShoppingCycle(
      null,
      {
        type: "route",
        lineId: "carrot",
        route: "market",
        neededOn: "2026-10-09",
        availableOn: "2026-10-10",
      },
      s,
      "James",
      "now",
    );
    const v = shoppingCycleView(d, s, 1);
    expect(v.lines[0].late).toBe(true);
    expect(v.lines[0].remainingQuantity).toBe(500);
    expect(v.lines[0].planned).toBe(true);
  });
  it("keeps author receipts and purchases after swaps", () => {
    const fingerprint = shoppingCycleView(null, s, 0).lines[0].fingerprint;
    const d = reduceShoppingCycle(
      null,
      {
        type: "purchase",
        lineId: "carrot",
        quantity: 500,
        unit: "g",
        observedFingerprint: fingerprint,
        purchasedAt: "2026-10-10T10:00:00Z",
      },
      s,
      "Manon",
      "now",
    );
    expect(shoppingCycleView(d, s, 1).lines[0].remainingQuantity).toBe(0);
    const v = shoppingCycleView(d, { ...s, revision: 2, lines: [] }, 1);
    expect(v.purchases[0].actorId).toBe("Manon");
    expect(v.orphanPurchases).toHaveLength(1);
  });
  it("rejects a queued checkmark whose amount changed", () => {
    const fingerprint = shoppingCycleView(null, s, 0).lines[0].fingerprint;
    const changed = {
      ...s,
      revision: 2,
      lines: [{ ...s.lines[0], buyQuantity: 1000 }],
    };
    expect(() =>
      reduceShoppingCycle(
        null,
        {
          type: "purchase",
          lineId: "carrot",
          quantity: 500,
          unit: "g",
          observedFingerprint: fingerprint,
          purchasedAt: "2026-10-10T10:00:00Z",
        },
        changed,
        "James",
        "now",
      ),
    ).toThrow("changed");
  });
  it("does not change pantry or compiler lines", () => {
    const before = structuredClone(s);
    reduceShoppingCycle(
      null,
      { type: "route", lineId: "carrot", route: "topup" },
      s,
      "James",
      "now",
    );
    expect(s).toEqual(before);
  });
});

function memoryStore(): PrismaClient {
  const rows = new Map<string, any>();
  const operations = new Map<string, any>();
  const document = {
    findUnique: async ({ where }: any) =>
      structuredClone(rows.get(where.id) ?? null),
    findMany: async ({ where }: any) =>
      [...rows.values()]
        .filter((r) => r.kind === where.kind)
        .map((r) => structuredClone(r)),
    create: async ({ data }: any) => {
      rows.set(data.id, structuredClone(data));
      return data;
    },
    updateMany: async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      rows.set(where.id, { ...row, ...structuredClone(data) });
      return { count: 1 };
    },
  };
  const operation = {
    findUnique: async ({ where }: any) =>
      structuredClone(operations.get(where.id) ?? null),
    create: async ({ data }: any) => {
      operations.set(data.id, structuredClone(data));
      return data;
    },
  };
  const prisma = {
    piMealDocument: document,
    piMealOperation: operation,
    $transaction: async (fn: any) => fn(prisma),
  };
  return prisma as unknown as PrismaClient;
}

describe("batch route receipts", () => {
  it("returns the same revision when the same arrival command is retried", async () => {
    const prisma = memoryStore();
    const selection = await createSelection(prisma, "james", {
      operationId: "seed-route",
      items: [
        {
          id: "meal",
          name: "Soup",
          baseServings: 1,
          servings: 1,
          ingredients: [{ name: "Carrot", quantity: 500, unit: "g" }],
        },
      ],
    });
    const envelope = {
      operationId: "arrival-retry",
      expectedActorId: "james",
      expectedRevision: 0,
      command: {
        type: "route_defaults",
        route: "supermarket",
        availableOn: "2026-10-08",
        observedSelectionRevision: selection.revision,
      },
    };
    const first = await changeShoppingCycle(
      prisma,
      selection.id,
      "james",
      envelope,
    );
    const second = await changeShoppingCycle(
      prisma,
      selection.id,
      "james",
      envelope,
    );
    expect(second).toEqual(first);
    expect(second.revision).toBe(1);
  });
});

describe("purchase facts survive requirement revisions", () => {
  it("counts the explicit quantity by stable ingredient identity and unit", () => {
    const fp = shoppingCycleView(null, s, 0).lines[0].fingerprint;
    const data = reduceShoppingCycle(
      null,
      {
        type: "purchase",
        lineId: "carrot",
        quantity: 500,
        unit: "g",
        observedFingerprint: fp,
        purchasedAt: "2026-10-07T10:00:00Z",
      },
      s,
      "james",
      "now",
    );
    const revised = {
      ...s,
      revision: 2,
      lines: [
        {
          ...s.lines[0],
          quantity: 1000,
          buyQuantity: 1000,
          sources: [{ itemId: "new", name: "New soup", quantity: 1000 }],
        },
      ],
    };
    const view = shoppingCycleView(data, revised, 1);
    expect(view.lines[0].boughtQuantity).toBe(500);
    expect(view.lines[0].remainingQuantity).toBe(500);
    expect(view.orphanPurchases).toHaveLength(0);
    expect(view.purchases[0].fingerprint).toBe(fp);
  });
  it("does not claim full coverage when the required amount is unknown", () => {
    const unknown = {
      ...s,
      lines: [{ ...s.lines[0], quantity: null, buyQuantity: null }],
    };
    const fp = shoppingCycleView(null, unknown, 0).lines[0].fingerprint;
    const data = reduceShoppingCycle(
      null,
      {
        type: "purchase",
        lineId: "carrot",
        quantity: 500,
        unit: "g",
        observedFingerprint: fp,
        purchasedAt: "2026-10-07T10:00:00Z",
      },
      unknown,
      "james",
      "now",
    );
    const view = shoppingCycleView(data, unknown, 1);
    expect(view.lines[0].boughtQuantity).toBe(500);
    expect(view.lines[0].remainingQuantity).toBeNull();
  });
});
