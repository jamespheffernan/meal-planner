import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { mutateDocument, readDocument } from "./store.js";
import { createSelection } from "./selections.js";
import {
  createWeek,
  changeWeek,
  type Allocation,
  type Member,
  type Routine,
} from "./week.js";
import type { SelectionItem, RecipeIngredientInput } from "./contracts.js";
const text = z.string().trim().min(1);
const positive = z.number().finite().positive();
const member = z.enum(["James", "Manon"]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a real calendar date.",
  );
const requirement = z
  .object({ name: text, quantity: positive, unit: text })
  .strict();
export const profileSchema = z
  .object({
    version: z.literal(1),
    confirmed: z.boolean(),
    rotationRecipeIds: z.array(text).min(1),
    people: z
      .array(
        z
          .object({
            member,
            homeLunchDays: z.array(z.number().int().min(0).max(6)),
            portions: positive,
          })
          .strict(),
      )
      .length(2),
    exclusions: z.array(
      z
        .object({
          subject: z.union([member, z.literal("household")]),
          ingredient: text,
        })
        .strict(),
    ),
    preferences: z.array(
      z
        .object({
          subject: z.union([member, z.literal("household")]),
          note: text,
        })
        .strict(),
    ),
    routines: z.array(
      z
        .object({
          id: text,
          meal: z.enum(["breakfast", "light_dinner"]),
          note: text,
          weeklyRequirements: z.array(requirement),
          bakeRecipeId: text.optional(),
          bakeServings: positive.optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((p, c) => {
    if (new Set(p.people.map((v) => v.member)).size !== 2)
      c.addIssue({ code: "custom", message: "Record both James and Manon." });
    if (new Set(p.rotationRecipeIds).size !== p.rotationRecipeIds.length)
      c.addIssue({
        code: "custom",
        message: "Rotation choices must be unique.",
      });
    if (new Set(p.routines.map((v) => v.id)).size !== p.routines.length)
      c.addIssue({ code: "custom", message: "Routine IDs must be unique." });
    for (const r of p.routines)
      if (Boolean(r.bakeRecipeId) !== Boolean(r.bakeServings))
        c.addIssue({
          code: "custom",
          message: "A breakfast bake needs a recipe and explicit portions.",
        });
  });
export type HouseholdProfile = z.infer<typeof profileSchema>;
export interface HouseholdData {
  profile: HouseholdProfile;
  author: string;
}
function privateInterviewNotes(): { source: string; notes: string[] } | null {
  try {
    const value = JSON.parse(
      process.env.PI_MEALS_HOUSEHOLD_NOTES_JSON || "null",
    );
    const parsed = z
      .object({ source: text, notes: z.array(text).max(20) })
      .strict()
      .safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export const interviewNotes = {
  confirmed: false,
  ...(privateInterviewNotes() ?? {
    source: "Household setup prompts",
    notes: [
      "Choose your usual cooking days.",
      "Confirm breakfast supplies and any regular bake.",
      "Confirm lunch portions and your evening routine.",
    ],
  }),
  gaps: [
    "Confirm current exclusions and preferences.",
    "Confirm each person’s home-lunch days and portions.",
    "Supply explicit weekly breakfast and evening ingredient amounts, plus bake yield if used.",
  ],
};
const profileId = "household:shared";
function bad(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) bad(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}
export function getHousehold(prisma: PrismaClient) {
  return readDocument<HouseholdData>(prisma, profileId, "household");
}
export async function saveHousehold(
  prisma: PrismaClient,
  actorId: string,
  input: unknown,
) {
  const p = parse(
    z
      .object({
        operationId: text,
        expectedRevision: z.number().int().nonnegative(),
        profile: profileSchema,
      })
      .strict(),
    input,
  );
  return mutateDocument<HouseholdData>(prisma, {
    id: profileId,
    kind: "household",
    operationId: p.operationId,
    actorId,
    expectedRevision: p.expectedRevision,
    payload: p.profile,
    reduce: () => ({ profile: p.profile, author: actorId }),
  });
}
type LibraryRecipe = Prisma.RecipeGetPayload<{
  include: {
    recipeIngredients: { include: { ingredient: true } };
    recipeInstructions: true;
  };
}>;
export function recipeItem(
  recipe: LibraryRecipe,
  servings: number,
  id = recipe.id,
): SelectionItem {
  if (
    !(recipe.servings > 0) ||
    !recipe.recipeIngredients.length ||
    !recipe.recipeInstructions.length
  )
    bad(`${recipe.name}: recipe yield, ingredients or method is missing.`);
  const ingredients: RecipeIngredientInput[] = recipe.recipeIngredients.map(
    (r) => ({
      id: r.ingredientId,
      name: r.ingredient.name,
      quantity: Number(r.quantity.toString()),
      unit: r.unit,
      raw: r.notes ?? undefined,
    }),
  );
  if (
    ingredients.some(
      (i) =>
        !Number.isFinite(i.quantity) ||
        Number(i.quantity) <= 0 ||
        !i.unit.trim(),
    )
  )
    bad(`${recipe.name}: ingredient quantities or units need correction.`);
  return {
    id,
    recipeId: recipe.id,
    name: recipe.name,
    source: recipe.source ?? undefined,
    photoUrl: recipe.photoUrl ?? undefined,
    baseServings: recipe.servings,
    servings,
    ingredients,
  };
}
function library(prisma: PrismaClient, ids?: string[]) {
  return prisma.recipe.findMany({
    where: { approvalStatus: "approved", ...(ids ? { id: { in: ids } } : {}) },
    include: {
      recipeIngredients: { include: { ingredient: true } },
      recipeInstructions: true,
    },
    orderBy: [{ timesCooked: "desc" }, { name: "asc" }],
  });
}
// This deliberately matches ingredient words, not allergen families or hidden derivatives.
// Singular/plural spelling is normalized only for ordinary ingredient-name forms.
function ingredientWords(name: string): string[] {
  const irregular: Record<string, string> = {
    leaves: "leaf",
    loaves: "loaf",
    knives: "knife",
    tomatoes: "tomato",
    potatoes: "potato",
    chillies: "chilli",
  };
  return (
    name
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9]+/g) ?? []
  ).map((word) => {
    if (irregular[word]) return irregular[word];
    if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && /(ches|shes|xes|zes|sses)$/.test(word))
      return word.slice(0, -2);
    if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word))
      return word.slice(0, -1);
    return word;
  });
}
function ingredientMatches(name: string, exclusion: string): boolean {
  const words = ingredientWords(name),
    phrase = ingredientWords(exclusion);
  return (
    phrase.length > 0 &&
    words.some((_, index) =>
      phrase.every((word, offset) => words[index + offset] === word),
    )
  );
}
function conflicts(
  item: SelectionItem,
  exclusions: HouseholdProfile["exclusions"],
) {
  return exclusions
    .filter((x) =>
      item.ingredients.some((i) => ingredientMatches(i.name, x.ingredient)),
    )
    .map((x) => `${x.subject}: ${x.ingredient}`);
}
export const candidateQuerySchema = z
  .object({
    expanded: z.enum(["true", "false"]).optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export async function rotationCandidates(
  prisma: PrismaClient,
  options: { expanded?: boolean; search?: string } = {},
) {
  const doc = await getHousehold(prisma);
  const eligible = await library(prisma);
  const cards: Array<{
    recipe: SelectionItem;
    reason: string;
    confirmedRotation: boolean;
  }> = [];
  const gaps: string[] = [];
  const retained = new Set([
    ...(doc?.data.profile.rotationRecipeIds ?? []),
    ...(doc?.data.profile.routines.flatMap((r) =>
      r.bakeRecipeId ? [r.bakeRecipeId] : [],
    ) ?? []),
  ]);
  for (const r of eligible) {
    try {
      const item = recipeItem(r, r.servings);
      const blocked = conflicts(item, doc?.data.profile.exclusions ?? []);
      if (blocked.length && !retained.has(r.id)) continue;
      if (
        options.search &&
        !retained.has(r.id) &&
        !r.name.toLocaleLowerCase().includes(options.search.toLocaleLowerCase())
      )
        continue;
      cards.push({
        recipe: item,
        reason: blocked.length
          ? `Saved household choice currently conflicts with ${blocked.join(", ")}; correct before planning.`
          : r.timesCooked > 0
            ? `Library records ${r.timesCooked} previous cook(s); confirm whether it belongs in your rotation.`
            : "Approved library recipe with recorded ingredients and method; household use is unconfirmed.",
        confirmedRotation: Boolean(
          doc?.data.profile.confirmed &&
          doc.data.profile.rotationRecipeIds.includes(r.id),
        ),
      });
    } catch (e) {
      gaps.push((e as Error).message);
    }
  }
  const retainedCards = cards.filter((c) => retained.has(c.recipe.id));
  const otherCards = cards.filter((c) => !retained.has(c.recipe.id));
  for (const id of retained)
    if (!retainedCards.some((c) => c.recipe.id === id))
      gaps.push(
        `Saved recipe ${id} is unavailable, unapproved or missing required recipe evidence.`,
      );
  return {
    cards: options.expanded
      ? [...retainedCards, ...otherCards]
      : [
          ...retainedCards,
          ...otherCards.slice(0, Math.max(0, 10 - retainedCards.length)),
        ],
    gaps:
      cards.length < 6
        ? [
            `Only ${cards.length} eligible candidates have enough recipe evidence.`,
            ...gaps,
          ]
        : gaps,
    interviewNotes,
  };
}
export const preparationSchema = z
  .object({
    operationId: text,
    expectedRevision: z.number().int().nonnegative(),
    startDate: date,
    away: z.array(z.object({ date, member }).strict()).default([]),
    temporaryExclusions: z.array(text).default([]),
  })
  .strict();
type PreparationInput = z.output<typeof preparationSchema>;
interface Preparation {
  input: PreparationInput;
  profileRevision: number;
  items: SelectionItem[];
  allocations: Allocation[];
  routines: Routine[];
  warnings: string[];
}
function day(start: string, offset: number) {
  return new Date(Date.parse(start) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function planHousehold(
  profile: HouseholdProfile,
  recipes: LibraryRecipe[],
  input: PreparationInput,
): Omit<Preparation, "profileRevision"> {
  if (!profile.confirmed)
    bad("Correct and confirm the household routine first.");
  if (
    !profile.routines.some((r) => r.meal === "breakfast") ||
    !profile.routines.some((r) => r.meal === "light_dinner")
  )
    bad(
      "Record breakfast and light dinner supply, including explicit weekly amounts.",
    );
  if (
    profile.routines.some(
      (r) => !r.weeklyRequirements.length && !r.bakeRecipeId,
    )
  )
    bad(
      "Each routine needs explicit weekly supplies or a bake recipe and yield.",
    );
  for (const a of input.away)
    if (a.date < input.startDate || a.date > day(input.startDate, 6))
      bad("Away dates must fall within this week.");
  const allocations: Allocation[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const d = day(input.startDate, offset),
      weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    for (const p of profile.people) {
      if (p.homeLunchDays.includes(weekday))
        allocations.push({
          date: d,
          member: p.member as Member,
          batchId: null,
          portions: p.portions,
          away: input.away.some((a) => a.date === d && a.member === p.member),
          freezeConfirmed: false,
        });
    }
  }
  const exclusions = [
    ...profile.exclusions,
    ...input.temporaryExclusions.map((ingredient) => ({
      subject: "household" as const,
      ingredient,
    })),
  ];
  const warnings = [
    "Ingredient-name checks do not establish allergen safety. Review full recipe evidence for hard dietary exclusions.",
    "Lunches more than 48 hours after cooking require a confirmed freeze/thaw plan.",
  ];
  const chosen: SelectionItem[] = [];
  for (const id of profile.rotationRecipeIds) {
    const r = recipes.find((r) => r.id === id);
    if (!r) {
      warnings.push(
        `Confirmed rotation recipe ${id} is unavailable or unapproved this week.`,
      );
      continue;
    }
    let item: SelectionItem;
    try {
      item = recipeItem(r, r.servings);
    } catch (e) {
      warnings.push((e as Error).message);
      continue;
    }
    const blocked = conflicts(item, exclusions);
    if (blocked.length) {
      warnings.push(
        `${r.name} conflicts with ${blocked.join(", ")} and was replaced from your confirmed rotation.`,
      );
      continue;
    }
    chosen.push(item);
  }
  const home = allocations.some((a) => !a.away);
  if (home && !chosen.length)
    bad(
      `No confirmed rotation recipe is viable this week. ${warnings.slice(2).join(" ")}`,
    );
  const weekIndex = Math.floor(Date.parse(input.startDate) / (7 * 86400000));
  const items: SelectionItem[] = [];
  for (const session of [0, 1]) {
    const rows = allocations.filter(
      (a) => !a.away && (a.date < day(input.startDate, 3) ? 0 : 1) === session,
    );
    const portions = rows.reduce((s, a) => s + a.portions, 0);
    if (!portions) continue;
    const item = {
      ...chosen[(weekIndex + session) % chosen.length],
      id: `batch:${session}`,
      servings: portions,
    };
    items.push(item);
    rows.forEach((a) => (a.batchId = item.id));
  }
  if (items.length > 1 && chosen.length === 1)
    warnings.push(
      `Only one confirmed rotation recipe is viable; ${chosen[0].name} is repeated across both cooking sessions.`,
    );
  const routines: Routine[] = [];
  for (const r of profile.routines) {
    const id = `routine:${r.id}`;
    if (r.weeklyRequirements.length) {
      const item: SelectionItem = {
        id,
        name: r.note,
        baseServings: 1,
        servings: 1,
        ingredients: r.weeklyRequirements,
      };
      if (conflicts(item, exclusions).length)
        bad(`${r.note} conflicts with household exclusions.`);
      items.push(item);
    }
    routines.push({
      id: r.id,
      meal: r.meal,
      note: r.note,
      itemId: r.weeklyRequirements.length ? id : undefined,
    });
    if (r.bakeRecipeId) {
      const recipe = recipes.find((v) => v.id === r.bakeRecipeId);
      if (!recipe) bad("Routine bake recipe is unavailable or unapproved.");
      const bake = recipeItem(recipe, r.bakeServings!, `routine:bake:${r.id}`);
      if (conflicts(bake, exclusions).length)
        bad("Routine bake conflicts with household exclusions.");
      items.push(bake);
      routines.push({
        id: `bake:${r.id}`,
        meal: r.meal,
        note: `Bake ${recipe.name}; ${r.bakeServings} portions`,
        itemId: bake.id,
      });
    }
  }
  if (!items.length)
    bad("This week has no home lunch or routine requirements.");
  return { input, items, allocations, routines, warnings };
}
export async function prepareHouseholdWeek(
  prisma: PrismaClient,
  actorId: string,
  value: unknown,
) {
  const input = parse(preparationSchema, value);
  const id = `preparation_${createHash("sha256")
    .update(JSON.stringify([actorId, input.operationId]))
    .digest("hex")
    .slice(0, 24)}`;
  const existing = await readDocument<Preparation>(
    prisma,
    id,
    "household_preparation",
  );
  // Persist immutable intent before any child commands so retries use the same recipe snapshot.
  let intent = existing?.data;
  if (!intent) {
    const doc = await getHousehold(prisma);
    if (!doc) bad("Confirm a household routine first.");
    if (doc.revision !== input.expectedRevision)
      bad("Household routine changed. Refresh before preparing.");
    intent = {
      ...planHousehold(
        doc.data.profile,
        await library(prisma, [
          ...new Set([
            ...doc.data.profile.rotationRecipeIds,
            ...doc.data.profile.routines.flatMap((r) =>
              r.bakeRecipeId ? [r.bakeRecipeId] : [],
            ),
          ]),
        ]),
        input,
      ),
      profileRevision: doc.revision,
    };
  }
  const receipt = await mutateDocument<Preparation>(prisma, {
    id,
    kind: "household_preparation",
    operationId: input.operationId,
    actorId,
    expectedRevision: 0,
    payload: input,
    reduce: () => intent!,
  });
  const plan = receipt.data;
  const selection = await createSelection(prisma, actorId, {
    operationId: `${input.operationId}:selection`,
    title: `Our week · ${input.startDate}`,
    items: plan.items,
  });
  let week = await createWeek(prisma, actorId, {
    operationId: `${input.operationId}:week`,
    selectionId: selection.id,
    startDate: input.startDate,
  });
  week = await changeWeek(prisma, week.id, actorId, {
    operationId: `${input.operationId}:allocations`,
    expectedRevision: 1,
    command: { type: "set_allocations", allocations: plan.allocations },
  });
  week = await changeWeek(prisma, week.id, actorId, {
    operationId: `${input.operationId}:routines`,
    expectedRevision: 2,
    command: { type: "set_routines", routines: plan.routines },
  });
  return {
    week,
    selection,
    warnings: plan.warnings,
    profileRevision: plan.profileRevision,
  };
}
