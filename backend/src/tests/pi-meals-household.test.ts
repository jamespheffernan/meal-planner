import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  planHousehold,
  profileSchema,
  prepareHouseholdWeek,
  saveHousehold,
  rotationCandidates,
} from "../pi-meals/household.js";
import { compileSelectionLines } from "../pi-meals/compiler.js";
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
const recipe = {
  id: "soup",
  name: "Soup",
  servings: 4,
  source: null,
  photoUrl: null,
  approvalStatus: "approved",
  timesCooked: 0,
  recipeIngredients: [
    {
      ingredientId: "carrot",
      quantity: new Prisma.Decimal("400.50"),
      unit: "g",
      notes: null,
      ingredient: { name: "Carrot" },
    },
  ],
  recipeInstructions: [{ instructionText: "Cook." }],
} as any;
const profile = () =>
  profileSchema.parse({
    version: 1,
    confirmed: true,
    rotationRecipeIds: ["soup"],
    people: [
      { member: "James", homeLunchDays: [0, 1, 2, 3], portions: 1 },
      { member: "Manon", homeLunchDays: [0, 1, 2, 3], portions: 1 },
    ],
    exclusions: [],
    preferences: [],
    routines: [
      {
        id: "breakfast",
        meal: "breakfast",
        note: "Yogurt for the week",
        weeklyRequirements: [{ name: "Yogurt", quantity: 1000, unit: "g" }],
      },
      {
        id: "evening",
        meal: "light_dinner",
        note: "Bread for the week",
        weeklyRequirements: [{ name: "Bread", quantity: 1, unit: "loaf" }],
      },
    ],
  });
const input = {
  operationId: "prepare",
  expectedRevision: 1,
  startDate: "2026-10-11",
  away: [],
  temporaryExclusions: [],
};
describe("household routine preparation", () => {
  it("matches singular and plural exclusion words while respecting ingredient boundaries", () => {
    const p = profile();
    p.exclusions = [{ subject: "household", ingredient: "eggs" }];
    const egg = {
      ...recipe,
      recipeIngredients: [
        {
          ...recipe.recipeIngredients[0],
          ingredient: { name: "Free range egg" },
        },
      ],
    };
    expect(() => planHousehold(p, [egg], input)).toThrow("conflicts");
    p.exclusions = [{ subject: "household", ingredient: "egg" }];
    const eggs = {
      ...egg,
      recipeIngredients: [
        { ...egg.recipeIngredients[0], ingredient: { name: "Eggs" } },
      ],
    };
    expect(() => planHousehold(p, [eggs], input)).toThrow("conflicts");
    p.exclusions = [{ subject: "household", ingredient: "ham" }];
    const mushroom = {
      ...egg,
      recipeIngredients: [
        {
          ...egg.recipeIngredients[0],
          ingredient: { name: "Champignon mushrooms" },
        },
      ],
    };
    expect(() => planHousehold(p, [mushroom], input)).not.toThrow();
    p.exclusions = [{ subject: "household", ingredient: "red peppers" }];
    const pepper = {
      ...egg,
      recipeIngredients: [
        {
          ...egg.recipeIngredients[0],
          ingredient: { name: "Chopped red pepper" },
        },
      ],
    };
    expect(() => planHousehold(p, [pepper], input)).toThrow("conflicts");
  });
  it("scales eight portions for four two-person lunches without per-lunch ingredient duplication", () => {
    const plan = planHousehold(profile(), [recipe], input);
    expect(plan.allocations).toHaveLength(8);
    expect(
      plan.items.filter((i) => i.recipeId).reduce((s, i) => s + i.servings, 0),
    ).toBe(8);
    const lines = compileSelectionLines(plan.items);
    expect(lines.find((i) => i.name === "Carrot")?.quantity).toBe(801);
    expect(lines.find((i) => i.name === "Yogurt")?.quantity).toBe(1000);
    expect(lines.find((i) => i.name === "Bread")?.quantity).toBe(1);
  });
  it("reduces only the absent person lunch portions", () => {
    const plan = planHousehold(profile(), [recipe], {
      ...input,
      away: [
        { member: "Manon", date: "2026-10-12" },
        { member: "Manon", date: "2026-10-13" },
      ],
    });
    expect(
      plan.items.filter((i) => i.recipeId).reduce((s, i) => s + i.servings, 0),
    ).toBe(6);
    expect(
      plan.allocations.filter((a) => a.member === "James" && !a.away),
    ).toHaveLength(4);
  });
  it("reports confirmed rotation conflicts rather than silently dropping a meal", () => {
    const p = profile();
    p.exclusions = [{ subject: "Manon", ingredient: "carrot" }];
    expect(() => planHousehold(p, [recipe], input)).toThrow("conflicts");
    expect(() =>
      planHousehold(profile(), [recipe], {
        ...input,
        temporaryExclusions: ["carrot"],
      }),
    ).toThrow("conflicts");
  });
  it("cannot turn unconfirmed candidates into a household rotation", () => {
    const p = profile();
    p.confirmed = false;
    expect(() => planHousehold(p, [recipe], input)).toThrow("confirm");
    expect(() => planHousehold(profile(), [], input)).toThrow("unavailable");
  });
  it("reports incomplete recipe evidence and routine quantities", () => {
    expect(() =>
      planHousehold(profile(), [{ ...recipe, recipeInstructions: [] }], input),
    ).toThrow("method");
    const p = profile();
    p.routines[0].weeklyRequirements = [];
    expect(() => planHousehold(p, [recipe], input)).toThrow("explicit");
  });
  it("recovers immutable intent between selection and week and rejects changed payload", async () => {
    const prisma = memoryStore();
    (prisma as any).recipe = { findMany: async () => [recipe] };
    await saveHousehold(prisma, "james", {
      operationId: "profile",
      expectedRevision: 0,
      profile: profile(),
    });
    const find = (prisma as any).piMealOperation.findUnique;
    let fail = true;
    (prisma as any).piMealOperation.findUnique = async (arg: any) => {
      if (arg.where.id === "prepare:week" && fail) {
        fail = false;
        throw new Error("interrupted");
      }
      return find(arg);
    };
    await expect(prepareHouseholdWeek(prisma, "james", input)).rejects.toThrow(
      "interrupted",
    );
    (prisma as any).recipe.findMany = async () => [];
    const result = await prepareHouseholdWeek(prisma, "james", input),
      retry = await prepareHouseholdWeek(prisma, "james", input);
    expect(retry.week.id).toBe(result.week.id);
    expect(retry.selection.id).toBe(result.selection.id);
    expect(result.week.allocations).toHaveLength(8);
    expect(result.week.batches.every((b) => !b.id.startsWith("routine:"))).toBe(
      true,
    );
    await expect(
      prepareHouseholdWeek(prisma, "james", {
        ...input,
        startDate: "2026-10-12",
      }),
    ).rejects.toThrow("different change");
  });
  it("counts a bake once and keeps its cooking work in the first session", async () => {
    const p = profile();
    p.routines[0].bakeRecipeId = "soup";
    p.routines[0].bakeServings = 4;
    const prisma = memoryStore();
    (prisma as any).recipe = { findMany: async () => [recipe] };
    await saveHousehold(prisma, "manon", {
      operationId: "bakeprofile",
      expectedRevision: 0,
      profile: p,
    });
    const result = await prepareHouseholdWeek(prisma, "manon", {
      ...input,
      operationId: "bakeweek",
    });
    expect(
      result.selection.lines.find((i) => i.name === "Carrot")?.quantity,
    ).toBe(1201.5);
    expect(
      result.week.batches.find((b) => b.id === "routine:bake:breakfast")
        ?.session,
    ).toBe(0);
    expect(
      result.week.batches.find((b) => b.id === "routine:breakfast"),
    ).toBeUndefined();
  });
  it("keeps the second session when no first-session lunches are at home", async () => {
    const p = profile();
    p.people.forEach((v) => (v.homeLunchDays = [3]));
    const prisma = memoryStore();
    (prisma as any).recipe = { findMany: async () => [recipe] };
    await saveHousehold(prisma, "james", {
      operationId: "lateprofile",
      expectedRevision: 0,
      profile: p,
    });
    const result = await prepareHouseholdWeek(prisma, "james", {
      ...input,
      operationId: "lateweek",
    });
    expect(result.week.batches.find((b) => b.id === "batch:1")?.session).toBe(
      1,
    );
  });
  it("rotates confirmed recipes across weeks deterministically", () => {
    const p = profile();
    p.rotationRecipeIds = ["soup", "potatoes", "stew"];
    const choices = [
      recipe,
      { ...recipe, id: "potatoes", name: "Potatoes" },
      { ...recipe, id: "stew", name: "Stew" },
    ];
    const first = planHousehold(p, choices, input),
      second = planHousehold(p, choices, { ...input, startDate: "2026-10-18" });
    expect(first.items[0].recipeId).not.toBe(second.items[0].recipeId);
    expect(planHousehold(p, choices, input).items).toEqual(first.items);
  });
  it("uses viable confirmed alternatives for a temporary exclusion and explains repetition", () => {
    const p = profile();
    p.rotationRecipeIds = ["soup", "potatoes"];
    const potatoes = {
      ...recipe,
      id: "potatoes",
      name: "Potatoes",
      recipeIngredients: [
        {
          ...recipe.recipeIngredients[0],
          ingredientId: "potato",
          ingredient: { name: "Potato" },
        },
      ],
    };
    const plan = planHousehold(p, [recipe, potatoes], {
      ...input,
      temporaryExclusions: ["carrot"],
    });
    expect(
      plan.items
        .filter((i) => i.recipeId)
        .every((i) => i.recipeId === "potatoes"),
    ).toBe(true);
    expect(plan.warnings.some((w) => w.includes("replaced"))).toBe(true);
    expect(plan.warnings.some((w) => w.includes("repeated"))).toBe(true);
  });
  it("keeps confirmed and bake choices visible beyond the default shortlist and searches the eligible library", async () => {
    const prisma = memoryStore();
    const recipes = Array.from({ length: 15 }, (_, i) => ({
      ...recipe,
      id: `r${i}`,
      name: `Recipe ${i}`,
    }));
    (prisma as any).recipe = { findMany: async () => recipes };
    const p = profile();
    p.rotationRecipeIds = ["r14"];
    p.routines[0].bakeRecipeId = "r13";
    p.routines[0].bakeServings = 4;
    await saveHousehold(prisma, "james", {
      operationId: "choices",
      expectedRevision: 0,
      profile: p,
    });
    const shortlist = await rotationCandidates(prisma);
    expect(shortlist.cards).toHaveLength(10);
    expect(shortlist.cards.some((c) => c.recipe.id === "r14")).toBe(true);
    expect(shortlist.cards.some((c) => c.recipe.id === "r13")).toBe(true);
    expect(
      (await rotationCandidates(prisma, { expanded: true })).cards,
    ).toHaveLength(15);
    const search = await rotationCandidates(prisma, {
      expanded: true,
      search: "Recipe 12",
    });
    expect(search.cards.map((c) => c.recipe.id)).toEqual(["r13", "r14", "r12"]);
  });
  it("shows library candidates without claiming household regularity", async () => {
    const prisma = memoryStore();
    (prisma as any).recipe = { findMany: async () => [recipe] };
    const result = await rotationCandidates(prisma);
    expect(result.cards[0].confirmedRotation).toBe(false);
    expect(result.cards[0].reason).toContain("unconfirmed");
    expect(result.gaps[0]).toContain("Only 1");
  });
});
