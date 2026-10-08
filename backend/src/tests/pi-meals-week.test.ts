import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createSelection,
  changeSelection,
  getSelection,
  listSelections,
} from "../pi-meals/selections.js";
import {
  changeShoppingCycle,
  shoppingCycleView,
  shoppingFingerprint,
} from "../pi-meals/shopping-cycle.js";
import {
  createWeek,
  changeWeek,
  getWeek,
  makeWeek,
  reduceWeek,
  weekView,
} from "../pi-meals/week.js";
// The lead generates the real client. Fake-store tests need only this catch discriminator.
vi.mock("@prisma/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@prisma/client")>();
  return {
    ...original,
    Prisma: {
      ...original.Prisma,
      PrismaClientKnownRequestError:
        original.Prisma.PrismaClientKnownRequestError ??
        class extends Error {
          code = "fixture";
        },
    },
  };
});

// This fixture proves reducers/receipts only. Real PostgreSQL concurrency is checked by the lead.
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

async function setup() {
  const prisma = memoryStore();
  const selection = await createSelection(prisma, "james", {
    operationId: "shop",
    items: [
      {
        id: "stew",
        name: "Stew",
        baseServings: 4,
        servings: 8,
        ingredients: [{ name: "Beans", quantity: 400, unit: "g" }],
      },
    ],
  });
  await changeShoppingCycle(prisma, selection.id, "james", {
    expectedActorId: "james",
    operationId: "arrival",
    expectedRevision: 0,
    command: {
      type: "route",
      lineId: selection.lines[0].id,
      route: "supermarket",
      availableOn: "2026-10-05",
    },
  });
  const week = await createWeek(prisma, "james", {
    operationId: "week",
    selectionId: selection.id,
    startDate: "2026-10-05",
  });
  return { prisma, selection, week };
}
describe("weekly batch planning", () => {
  it("dated purchases remain available by ingredient identity and unit after source quantities change", async () => {
    const { selection } = await setup();
    const data = makeWeek(selection, "2026-10-05");
    data.allocations = [{ ...data.allocations[0], batchId: "stew" }];
    const cycle = shoppingCycleView(
      {
        selectionId: selection.id,
        selectionRevision: selection.revision - 1,
        routes: [],
        purchases: [
          {
            lineId: selection.lines[0].id,
            unit: selection.lines[0].unit,
            quantity: selection.lines[0].buyQuantity!,
            fingerprint: "old-source-fingerprint",
            actorId: "james",
            purchasedAt: "2026-10-04T12:00:00Z",
            recordedAt: "now",
          },
        ],
      },
      selection,
      1,
    );
    const shown = weekView(
      { id: "week", kind: "week", revision: 1, updatedAt: "now", data },
      selection,
      cycle,
    );
    expect(shown.lunches[0].coverage).toBe("planned");
    expect(shown.lunches[0].ingredientWarnings).toEqual([]);
  });

  it("refreshing a reduced yield uncovers only overflow allocations and preserves other meals", async () => {
    const { selection } = await setup();
    const linked = {
      ...selection,
      items: [
        ...selection.items,
        { ...selection.items[0], id: "salad", name: "Salad" },
      ],
    };
    const data = makeWeek(linked, "2026-10-05");
    data.allocations = [
      { ...data.allocations[0], batchId: "stew", portions: 4 },
      { ...data.allocations[1], batchId: "stew", portions: 4 },
      { ...data.allocations[4], batchId: "salad" },
    ];
    const refreshed = reduceWeek(
      data,
      { type: "refresh_selection" },
      {
        ...linked,
        revision: 2,
        items: linked.items.map((item) =>
          item.id === "stew" ? { ...item, servings: 4 } : item,
        ),
      },
    );
    expect(refreshed.allocations[0].batchId).toBe("stew");
    expect(refreshed.allocations[1].batchId).toBeNull();
    expect(refreshed.allocations[1].uncoveredReason).toContain("yield reduced");
    expect(refreshed.allocations[2]).toEqual(data.allocations[2]);
  });

  it("allocates merged-line stock once across cooking dates, then uses dated arrival for the remainder", async () => {
    const { selection } = await setup();
    const item = {
      ...selection.items[0],
      baseServings: 1,
      servings: 1,
      ingredients: [{ name: "Beans", quantity: 300, unit: "g" }],
    };
    const linked = {
      ...selection,
      items: [
        { ...item, id: "first" },
        { ...item, id: "second" },
      ],
      lines: [
        {
          ...selection.lines[0],
          quantity: 600,
          haveQuantity: 300,
          buyQuantity: 300,
          sources: [
            { itemId: "first", name: "First", quantity: 300 },
            { itemId: "second", name: "Second", quantity: 300 },
          ],
        },
      ],
    };
    const data = makeWeek(linked, "2026-10-05");
    data.sessions = ["2026-10-05", "2026-10-07"];
    data.allocations = [
      { ...data.allocations[0], batchId: "first" },
      { ...data.allocations[5], batchId: "second" },
    ];
    const cycle = shoppingCycleView(
      {
        selectionId: linked.id,
        selectionRevision: linked.revision,
        purchases: [],
        routes: [
          {
            lineId: linked.lines[0].id,
            route: "market",
            availableOn: "2026-10-06",
            fingerprint: shoppingFingerprint(linked.lines[0]),
            actorId: "james",
            recordedAt: "now",
          },
        ],
      },
      linked,
      1,
    );
    const doc = {
      id: "week",
      kind: "week",
      revision: 1,
      updatedAt: "now",
      data,
    };
    expect(
      weekView(doc, linked, cycle).lunches.map((row) => row.coverage),
    ).toEqual(["planned", "planned"]);
    data.batches[1].session = 0;
    const early = weekView(doc, linked, cycle);
    expect(early.lunches.map((row) => row.coverage)).toEqual([
      "planned",
      "uncovered",
    ]);
    expect(early.lunches[1].ingredientWarnings[0]).toContain(
      "300 g still needed",
    );
  });
  it("routine quantity changes require source refresh before a repeat uses the corrected snapshot", async () => {
    const { prisma, selection } = await setup();
    const yogurt = {
      ...selection.items[0],
      id: "routine:yogurt",
      name: "Yogurt",
      baseServings: 1,
      servings: 1,
      ingredients: [{ name: "Yogurt", quantity: 500, unit: "g" }],
    };
    const linked = await changeSelection(prisma, selection.id, "james", {
      operationId: "routine",
      expectedRevision: 1,
      command: { type: "replace_items", items: [...selection.items, yogurt] },
    });
    const source = await createWeek(prisma, "james", {
      operationId: "routine-week",
      selectionId: linked.id,
      startDate: "2026-10-05",
    });
    await changeSelection(prisma, selection.id, "james", {
      operationId: "more-yogurt",
      expectedRevision: 2,
      command: {
        type: "replace_items",
        items: [
          ...selection.items,
          {
            ...yogurt,
            ingredients: [{ name: "Yogurt", quantity: 1000, unit: "g" }],
          },
        ],
      },
    });
    expect((await getWeek(prisma, source.id))!.needsRefresh).toBe(true);
    await expect(
      createWeek(prisma, "james", {
        operationId: "repeat-routine",
        sourceWeekId: source.id,
        startDate: "2026-10-12",
      }),
    ).rejects.toThrow("Refresh the source week");
    await changeWeek(prisma, source.id, "james", {
      operationId: "refresh-routine",
      expectedRevision: 1,
      command: { type: "refresh_selection" },
    });
    const repeat = await createWeek(prisma, "james", {
      operationId: "repeat-routine",
      sourceWeekId: source.id,
      startDate: "2026-10-12",
    });
    expect(
      (await getSelection(prisma, repeat.selectionId))!.items.find(
        (item) => item.id === yogurt.id,
      )!.ingredients[0].quantity,
    ).toBe(1000);
  });

  it("unknown or late arrivals affect only batches that use those shopping lines", async () => {
    const { selection } = await setup();
    const linked = {
      ...selection,
      items: [
        ...selection.items,
        { ...selection.items[0], id: "salad", name: "Salad", ingredients: [] },
      ],
    };
    const data = makeWeek(linked, "2026-10-05");
    data.batches[1].session = 0;
    data.allocations = [
      { ...data.allocations[0], batchId: "stew" },
      { ...data.allocations[1], batchId: "salad" },
    ];
    const doc = {
      id: "week",
      kind: "week",
      revision: 1,
      updatedAt: "now",
      data,
    };
    const unknown = weekView(doc, linked, shoppingCycleView(null, linked, 0));
    expect(unknown.lunches.map((l) => l.coverage)).toEqual([
      "uncovered",
      "planned",
    ]);
    expect(unknown.lunches[0].ingredientWarnings[0]).toContain(
      "arrival date is unknown",
    );
    const cycle = shoppingCycleView(
      {
        selectionId: linked.id,
        selectionRevision: linked.revision,
        purchases: [],
        routes: [
          {
            lineId: linked.lines[0].id,
            route: "market",
            availableOn: "2026-10-10",
            fingerprint: shoppingFingerprint(linked.lines[0]),
            actorId: "james",
            recordedAt: "now",
          },
        ],
      },
      linked,
      1,
    );
    const late = weekView(doc, linked, cycle);
    expect(late.lunches.map((l) => l.coverage)).toEqual([
      "uncovered",
      "planned",
    ]);
    expect(late.lunches[0].ingredientWarnings[0]).toContain("after cooking");
  });

  it("late ingredient arrival uncovers only its dependent planned batch; cooked facts remain", async () => {
    const { prisma, selection, week } = await setup();
    await changeWeek(prisma, week.id, "james", {
      operationId: "assign",
      expectedRevision: 1,
      command: {
        type: "set_allocations",
        allocations: [{ ...week.allocations[0], batchId: "stew" }],
      },
    });
    await changeShoppingCycle(prisma, selection.id, "james", {
      expectedActorId: "james",
      operationId: "latearrival",
      expectedRevision: 1,
      command: {
        type: "route",
        lineId: selection.lines[0].id,
        route: "market",
        availableOn: "2026-10-10",
      },
    });
    const late = await getWeek(prisma, week.id);
    expect(late!.lunches[0].coverage).toBe("uncovered");
    expect(late!.lunches[0].ingredientWarnings[0]).toContain("after cooking");
    const cooked = await changeWeek(prisma, week.id, "james", {
      operationId: "actualcook",
      expectedRevision: 2,
      command: {
        type: "set_status",
        batchId: "stew",
        status: "cooked",
        cookedAt: "2026-10-05T12:00:00Z",
      },
    });
    expect(cooked.lunches[0].coverage).toBe("cooked");
    expect(cooked.lunches[0].ingredientWarnings).toEqual([]);
  });
  it("known purchases remove late-route dependency without claiming raw ingredient freshness", async () => {
    const { prisma, selection, week } = await setup();
    const cycle = await changeShoppingCycle(prisma, selection.id, "james", {
      expectedActorId: "james",
      operationId: "latearrival",
      expectedRevision: 1,
      command: {
        type: "route",
        lineId: selection.lines[0].id,
        route: "market",
        availableOn: "2026-10-10",
      },
    });
    await changeShoppingCycle(prisma, selection.id, "james", {
      expectedActorId: "james",
      operationId: "purchased",
      expectedRevision: 2,
      command: {
        type: "purchase",
        lineId: selection.lines[0].id,
        quantity: cycle.lines[0].buyQuantity!,
        unit: cycle.lines[0].unit,
        observedFingerprint: cycle.lines[0].fingerprint,
        purchasedAt: "2026-10-04T12:00:00Z",
      },
    });
    const next = await changeWeek(prisma, week.id, "james", {
      operationId: "assign",
      expectedRevision: 1,
      command: {
        type: "set_allocations",
        allocations: [{ ...week.allocations[0], batchId: "stew" }],
      },
    });
    expect(next.lunches[0].coverage).toBe("planned");
    expect(next.lunches[0].ingredientWarnings).toEqual([]);
  });

  it("keeps routine supplies outside batches, while bakes and explicit batch slots can cook", async () => {
    const { selection } = await setup();
    const item = selection.items[0];
    const data = makeWeek(
      {
        ...selection,
        items: [
          { ...item, id: "routine:oats" },
          { ...item, id: "routine:bake:bread", recipeId: "bread" },
          { ...item, id: "batch:1" },
        ],
      },
      "2026-10-05",
    );
    expect(data.batches.map((b) => [b.id, b.session])).toEqual([
      ["routine:bake:bread", 0],
      ["batch:1", 1],
    ]);
    expect(
      reduceWeek(data, {
        type: "set_routines",
        routines: [
          {
            id: "breakfast",
            meal: "breakfast",
            note: "Oats",
            itemId: "routine:oats",
          },
        ],
      }).routines,
    ).toHaveLength(1);
    const feedback = reduceWeek(data, {
      type: "set_feedback",
      batchId: "batch:1",
      feedback: "too_much_effort",
    });
    expect(feedback.batches[1].feedback).toBe("too_much_effort");
    expect(feedback.batches[1].status).toBe("planned");
    expect(selection.items[0]).not.toHaveProperty("feedback");
  });

  it("repeat uses saved recipe amounts in a separate selection and resets cooking and stock", async () => {
    const { prisma, selection, week } = await setup();
    await changeSelection(prisma, selection.id, "james", {
      operationId: "later",
      expectedRevision: 1,
      command: {
        type: "replace_items",
        items: [{ ...selection.items[0], servings: 12 }],
      },
    });
    const repeated = await createWeek(prisma, "james", {
      operationId: "repeat",
      sourceWeekId: week.id,
      startDate: "2026-10-12",
    });
    expect(repeated.selectionId).not.toBe(selection.id);
    expect(repeated.batches[0].snapshot.servings).toBe(8);
    expect(repeated.batches[0].status).toBe("planned");
    expect(repeated.sessions).toEqual(["2026-10-12", "2026-10-15"]);
    expect((await getSelection(prisma, repeated.selectionId))!.stock).toEqual(
      [],
    );
    expect(
      await createWeek(prisma, "james", {
        operationId: "repeat",
        sourceWeekId: week.id,
        startDate: "2026-10-12",
      }),
    ).toEqual(repeated);
    expect(await listSelections(prisma)).toHaveLength(2);
  });

  it("stock and selection title changes leave recipe coverage current", async () => {
    const { prisma, selection, week } = await setup();
    await changeSelection(prisma, selection.id, "james", {
      operationId: "rename",
      expectedRevision: 1,
      command: { type: "rename", title: "This shop" },
    });
    const renamed = await getSelection(prisma, selection.id);
    await changeSelection(prisma, selection.id, "james", {
      operationId: "stock",
      expectedRevision: 2,
      command: { type: "have_all", lineId: renamed!.lines[0].id },
    });
    expect((await getWeek(prisma, week.id))?.needsRefresh).toBe(false);
  });
  it("refreshes uncooked recipes beside cooked snapshots and preserves allocations", async () => {
    const { prisma, selection, week } = await setup();
    const cooked = await changeWeek(prisma, week.id, "james", {
      operationId: "cooked",
      expectedRevision: 1,
      command: {
        type: "set_status",
        batchId: "stew",
        status: "cooked",
        cookedAt: "2026-10-05T12:00:00Z",
      },
    });
    await changeWeek(prisma, week.id, "james", {
      operationId: "allocated",
      expectedRevision: 2,
      command: {
        type: "set_allocations",
        allocations: [
          { ...week.allocations[6], batchId: "stew", freezeConfirmed: true },
        ],
      },
    });
    await changeSelection(prisma, selection.id, "james", {
      operationId: "new",
      expectedRevision: 1,
      command: {
        type: "replace_items",
        items: [
          { ...selection.items[0], servings: 12 },
          { ...selection.items[0], id: "soup", name: "Soup" },
        ],
      },
    });
    const next = await changeWeek(prisma, week.id, "james", {
      operationId: "refresh",
      expectedRevision: 3,
      command: { type: "refresh_selection" },
    });
    expect(next.batches[0]).toEqual(cooked.batches[0]);
    expect(next.batches).toHaveLength(2);
    expect(next.needsRefresh).toBe(false);
    expect(next.allocations[0].freezeConfirmed).toBe(true);
    expect(next.lunches[0].coverage).toBe("cooked");
  });

  it("covers four lunches for two with eight reserved portions and no second shop", async () => {
    const { prisma, selection, week } = await setup();
    const allocations = week.allocations.map((a) => ({
      ...a,
      batchId: a.date < "2026-10-09" ? "stew" : null,
      freezeConfirmed: true,
    }));
    const next = await changeWeek(prisma, week.id, "james", {
      operationId: "allocate",
      expectedRevision: 1,
      command: { type: "set_allocations", allocations },
    });
    expect(next.batchesSummary[0]).toMatchObject({
      yield: 8,
      allocated: 8,
      remaining: 0,
    });
    expect(next.lunches.filter((l) => l.coverage === "planned")).toHaveLength(
      8,
    );
    expect(await listSelections(prisma)).toHaveLength(1);
    expect(await getSelection(prisma, selection.id)).toEqual(selection);
    expect(
      await createWeek(prisma, "james", {
        operationId: "week",
        selectionId: selection.id,
        startDate: "2026-10-05",
      }),
    ).toEqual(week);
    await expect(
      changeWeek(prisma, week.id, "james", {
        operationId: "stale-week",
        expectedRevision: 1,
        command: { type: "set_allocations", allocations },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      changeWeek(prisma, week.id, "james", {
        operationId: "overflow",
        expectedRevision: 2,
        command: {
          type: "set_allocations",
          allocations: allocations.map((a) => ({ ...a, batchId: "stew" })),
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("requires explicit freeze confirmation after 48 hours; skipped cooking is uncovered", async () => {
    const { prisma, selection, week } = await setup();
    const boundary = await changeWeek(prisma, week.id, "james", {
      operationId: "48h",
      expectedRevision: 1,
      command: {
        type: "set_allocations",
        allocations: [{ ...week.allocations[4], batchId: "stew" }],
      },
    });
    expect(boundary.lunches[0].freezeRequired).toBe(false);
    const row = { ...week.allocations[6], batchId: "stew" };
    const late = await changeWeek(prisma, week.id, "james", {
      operationId: "late",
      expectedRevision: 2,
      command: { type: "set_allocations", allocations: [row] },
    });
    expect(late.lunches[0]).toMatchObject({
      freezeRequired: true,
      coverage: "uncovered",
    });
    expect(late.lunches[0].storageNote).toContain("thaw");
    const confirmed = await changeWeek(prisma, week.id, "james", {
      operationId: "freeze",
      expectedRevision: 3,
      command: {
        type: "set_allocations",
        allocations: [{ ...row, freezeConfirmed: true }],
      },
    });
    expect(confirmed.lunches[0].coverage).toBe("planned");
    expect(confirmed.batches[0].status).toBe("planned");
    const skipped = await changeWeek(prisma, week.id, "james", {
      operationId: "skip",
      expectedRevision: 4,
      command: { type: "set_status", batchId: "stew", status: "skipped" },
    });
    expect(skipped.lunches[0].coverage).toBe("uncovered");
    expect(await getSelection(prisma, selection.id)).toEqual(selection);
  });
  it("flags revised shopping authority and explicitly refreshes immutable snapshots", async () => {
    const { prisma, selection, week } = await setup();
    await changeSelection(prisma, selection.id, "james", {
      operationId: "more",
      expectedRevision: 1,
      command: {
        type: "replace_items",
        items: selection.items.map((i) => ({ ...i, servings: 10 })),
      },
    });
    const stale = await getWeek(prisma, week.id);
    expect(stale?.needsRefresh).toBe(true);
    expect(stale?.batches[0].snapshot.servings).toBe(8);
    const refreshed = await changeWeek(prisma, week.id, "james", {
      operationId: "refresh",
      expectedRevision: 1,
      command: { type: "refresh_selection" },
    });
    expect(refreshed.needsRefresh).toBe(false);
    expect(refreshed.batches[0].snapshot.servings).toBe(10);
  });
  it("cooking requires a logged actual time and cannot fabricate consumption", async () => {
    const { prisma, week } = await setup();
    await expect(
      changeWeek(prisma, week.id, "james", {
        operationId: "badcook",
        expectedRevision: 1,
        command: { type: "set_status", batchId: "stew", status: "cooked" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const cooked = await changeWeek(prisma, week.id, "james", {
      operationId: "cook",
      expectedRevision: 1,
      command: {
        type: "set_status",
        batchId: "stew",
        status: "cooked",
        cookedAt: "2026-10-05T12:00:00Z",
      },
    });
    expect(cooked.batches[0].cookedAt).toBe("2026-10-05T12:00:00Z");
    expect(cooked).not.toHaveProperty("consumed");
    expect((await getWeek(prisma, week.id))?.batches[0].status).toBe("cooked");
    await expect(
      changeWeek(prisma, week.id, "james", {
        operationId: "replace-cooked",
        expectedRevision: 2,
        command: { type: "refresh_selection" },
      }),
    ).resolves.toMatchObject({
      needsRefresh: false,
      batches: [{ status: "cooked", cookedAt: "2026-10-05T12:00:00Z" }],
    });
  });
  it("away rows do not reserve yield and duplicate lunches are rejected", async () => {
    const { prisma, week } = await setup();
    const row = { ...week.allocations[0], batchId: "stew" };
    await expect(
      changeWeek(prisma, week.id, "james", {
        operationId: "duplicates",
        expectedRevision: 1,
        command: { type: "set_allocations", allocations: [row, row] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const away = await changeWeek(prisma, week.id, "james", {
      operationId: "away",
      expectedRevision: 1,
      command: {
        type: "set_allocations",
        allocations: [{ ...row, away: true }],
      },
    });
    expect(away.batchesSummary[0].remaining).toBe(8);
    expect(away.lunches[0].coverage).toBe("away");
  });
});
