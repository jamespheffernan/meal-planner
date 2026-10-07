import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { Type } from "@earendil-works/pi-ai";
import {
  defineDoc,
  defineTool,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import type {
  RecipeDraft,
  RecipeSelection,
  SelectionChange,
  SelectionItem,
} from "./contracts.js";
import {
  getShoppingCycle,
  changeShoppingCycle,
  shoppingCycleView,
  type ShoppingCycleCommand,
  type ShoppingCycleData,
} from "./shopping-cycle.js";
import {
  getHousehold,
  saveHousehold,
  profileSchema,
  rotationCandidates,
  prepareHouseholdWeek,
  preparationSchema,
} from "./household.js";
import { mealContext } from "./durable.js";
import { changeSelection, getSelection } from "./selections.js";
import { compileSelectionLines } from "./compiler.js";
import {
  createDraft,
  patchDraft,
  patchSchema,
  saveDraft,
  intakeSchema,
} from "./intake.js";
import { readDocument, listDocuments, type MealDocument } from "./store.js";
import {
  changeWeek,
  weekView,
  type WeekCommand,
  type WeekData,
} from "./week.js";

type Run = { actorId: string; selectionId: string; requestId: string };
const Drafts = defineDoc<{ ids: string[] }>({
  kind: "meals.assistant-drafts",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ ids: [] }),
});
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
function operation(context: Run, api: ToolExecutionApi) {
  return (
    "meal_tool_" +
    createHash("sha256")
      .update(
        JSON.stringify([
          context.actorId,
          context.requestId,
          context.selectionId,
          api.callId,
        ]),
      )
      .digest("hex")
  );
}
async function receipt(
  prisma: PrismaClient,
  context: Run,
  api: ToolExecutionApi,
) {
  const row = await prisma.piMealOperation.findUnique({
    where: { id: operation(context, api) },
  });
  if (row && row.actorId !== context.actorId)
    throw new Error("Tool receipt actor mismatch.");
  return row;
}
function selectionView(
  row: MealDocument<{
    title: string;
    items: SelectionItem[];
    stock: RecipeSelection["stock"];
  }>,
): RecipeSelection {
  return {
    ...row.data,
    id: row.id,
    revision: row.revision,
    updatedAt: row.updatedAt,
    lines: compileSelectionLines(row.data.items, row.data.stock),
  };
}
export async function selectionMutation(
  prisma: PrismaClient,
  context: Run,
  api: ToolExecutionApi,
  prepare: (selection: RecipeSelection) => Promise<SelectionChange>,
) {
  const prior = await receipt(prisma, context, api);
  if (prior) {
    if (prior.documentId !== context.selectionId)
      throw new Error("Tool receipt selection mismatch.");
    return selectionView(
      prior.result as unknown as Parameters<typeof selectionView>[0],
    );
  }
  let stored = await api.memo<string>("selection-change", mealContext);
  if (!stored) {
    const current = await getSelection(prisma, context.selectionId);
    if (!current) throw new Error("Recipe selection not found.");
    stored = await api.memo(
      "selection-change",
      JSON.stringify({
        revision: current.revision,
        command: await prepare(current),
      }),
      mealContext,
    );
  }
  const prepared = JSON.parse(stored) as {
    revision: number;
    command: SelectionChange;
  };
  return changeSelection(prisma, context.selectionId, context.actorId, {
    operationId: operation(context, api),
    expectedRevision: prepared.revision,
    command: prepared.command,
  });
}
export function librarySnapshot(
  recipe: {
    id: string;
    name: string;
    servings: number;
    source: string | null;
    photoUrl: string | null;
    recipeIngredients: Array<{
      id: string;
      quantity: number | { toNumber(): number };
      unit: string;
      notes: string | null;
      ingredient: { name: string };
    }>;
  },
  servings?: number,
): SelectionItem {
  return {
    id: `recipe:${recipe.id}`,
    recipeId: recipe.id,
    name: recipe.name,
    baseServings: recipe.servings,
    servings: servings ?? recipe.servings,
    ...(recipe.source ? { source: recipe.source } : {}),
    ...(recipe.photoUrl ? { photoUrl: recipe.photoUrl } : {}),
    ingredients: recipe.recipeIngredients.map((i) => ({
      id: i.id,
      name: i.ingredient.name,
      quantity:
        typeof i.quantity === "number" ? i.quantity : i.quantity.toNumber(),
      unit: i.unit,
      ...(i.notes ? { raw: i.notes } : {}),
    })),
  };
}
export function mealDomainTools(
  prisma: PrismaClient,
  run: (api: ToolExecutionApi) => Promise<Run>,
) {
  const library = async (id: string, servings?: number) => {
    const row = await prisma.recipe.findUnique({
      where: { id },
      include: { recipeIngredients: { include: { ingredient: true } } },
    });
    if (!row) throw new Error("Library recipe not found.");
    return librarySnapshot(row, servings);
  };
  const tracked = async (api: ToolExecutionApi, id: string) => {
    const state = await api.snapshot(Drafts, api.conversationId, mealContext);
    const selection = await getSelection(prisma, (await run(api)).selectionId);
    if (
      !state?.ids.includes(id) &&
      !selection?.items.some((i) => i.draftId === id)
    )
      throw new Error(
        "Draft is not attached to this conversation or selection.",
      );
    const row = await readDocument<RecipeDraft>(prisma, id, "recipe-draft");
    if (!row) throw new Error("Recipe draft not found.");
    return { ...row.data, revision: row.revision };
  };
  const remember = async (api: ToolExecutionApi, id: string) =>
    api.commit(async (tx) => {
      const state = await tx.doc(Drafts, api.conversationId);
      if (!state.ids.includes(id)) state.ids.push(id);
    }, mealContext);
  const linked = async (api: ToolExecutionApi, id?: string) => {
    const context = await run(api);
    const docs = (await listDocuments<WeekData>(prisma, "week")).filter(
      (d) => d.data.selectionId === context.selectionId,
    );
    const doc = id
      ? docs.find((d) => d.id === id)
      : docs.length === 1
        ? docs[0]
        : undefined;
    if (!doc)
      throw new Error(
        docs.length > 1
          ? "Choose a linked week ID from get_linked_weeks."
          : "Linked week not found.",
      );
    return { context, doc };
  };
  const shoppingRoute = Type.Union([
    Type.Literal("supermarket"),
    Type.Literal("market"),
    Type.Literal("topup"),
  ]);
  const member = Type.Union([Type.Literal("James"), Type.Literal("Manon")]);
  const subject = Type.Union([member, Type.Literal("household")]);
  const householdProfile = Type.Object({
    version: Type.Literal(1),
    confirmed: Type.Boolean(),
    rotationRecipeIds: Type.Array(Type.String(), { minItems: 1 }),
    people: Type.Array(
      Type.Object({
        member,
        homeLunchDays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 })),
        portions: Type.Number({ exclusiveMinimum: 0 }),
      }),
      { minItems: 2, maxItems: 2 },
    ),
    exclusions: Type.Array(Type.Object({ subject, ingredient: Type.String() })),
    preferences: Type.Array(Type.Object({ subject, note: Type.String() })),
    routines: Type.Array(
      Type.Object({
        id: Type.String(),
        meal: Type.Union([
          Type.Literal("breakfast"),
          Type.Literal("light_dinner"),
        ]),
        note: Type.String(),
        weeklyRequirements: Type.Array(
          Type.Object({
            name: Type.String(),
            quantity: Type.Number({ exclusiveMinimum: 0 }),
            unit: Type.String(),
          }),
        ),
        bakeRecipeId: Type.Optional(Type.String()),
        bakeServings: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      }),
    ),
  });
  return [
    defineTool({
      name: "list_recipe_drafts",
      description:
        "List shared household drafts imported in the UI or chat, returning IDs, titles and editable gaps. Listed drafts become available to this conversation; read a draft before changing it.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async (_args, api) => {
        const docs = await listDocuments<RecipeDraft>(prisma, "recipe-draft");
        await api.commit(async (tx) => {
          const state = await tx.doc(Drafts, api.conversationId);
          for (const doc of docs)
            if (!state.ids.includes(doc.id)) state.ids.push(doc.id);
        }, mealContext);
        return json(
          docs.map((doc) => ({
            id: doc.id,
            name: doc.data.name,
            revision: doc.revision,
            status: doc.data.status,
            gaps: doc.data.gaps,
          })),
        );
      },
    }),
    defineTool({
      name: "add_shopping_extra",
      description:
        "Add an extra shopping requirement explicitly requested by the user, without inventing a recipe. Keep an unknown amount null and an unknown unit empty; ask for missing details.",
      parameters: Type.Object({
        name: Type.String({ minLength: 1 }),
        quantity: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        unit: Type.String(),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        return json(
          await selectionMutation(prisma, context, api, async (selection) => ({
            type: "replace_items",
            items: [
              ...selection.items,
              {
                id: `routine:extra:${operation(context, api)}`,
                name: args.name,
                baseServings: 1,
                servings: 1,
                ingredients: [
                  { name: args.name, quantity: args.quantity, unit: args.unit },
                ],
              },
            ],
          })),
        );
      },
    }),
    defineTool({
      name: "save_household",
      description:
        'Save only the household profile changes explicitly requested by the user. Read get_household first and preserve unrelated facts. instructionQuote must exactly quote the current user request. Never infer dietary exclusions. To first enable a routine, obtain an exact confirmationQuote such as "I confirm this household routine" from the current user message; ask one clarification if missing. A draft routine may be saved with confirmed false.',
      parameters: Type.Object({
        profile: householdProfile,
        instructionQuote: Type.String({ minLength: 1 }),
        confirmationQuote: Type.Optional(Type.String({ minLength: 1 })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        const prior = await receipt(prisma, context, api);
        if (prior) {
          if (prior.documentId !== "household:shared")
            throw new Error("Household receipt target mismatch.");
          return json(prior.result);
        }
        let encoded = await api.memo<string>(
          "household-profile-change",
          mealContext,
        );
        if (!encoded) {
          const current = await getHousehold(prisma);
          const row = await prisma.piMealOutbox.findUnique({
            where: { id: context.requestId },
          });
          const message = (row?.payload as { message?: string } | undefined)
            ?.message;
          if (
            row?.actorId !== context.actorId ||
            row?.documentId !== context.selectionId ||
            !message ||
            !message.includes(args.instructionQuote)
          )
            throw new Error(
              "Quote the current user instruction before changing the household routine.",
            );
          const profile = profileSchema.parse(args.profile);
          if (profile.confirmed && !current?.data.profile.confirmed) {
            const quote = args.confirmationQuote?.trim();
            if (
              !quote ||
              !message.includes(quote) ||
              !/^(?:i\s+)?(?:confirm|approve)\b[\s\S]*\bhousehold\b[\s\S]*\b(?:routine|profile|setup)\b/i.test(
                quote,
              ) ||
              /\b(?:not|never|no|unconfirmed)\b|don['’]t|do not/i.test(quote)
            )
              throw new Error(
                "Ask the user to explicitly confirm the household routine before enabling it.",
              );
          }
          const old = current?.data.profile.exclusions ?? [];
          const key = (e: { subject: string; ingredient: string }) =>
            JSON.stringify([e.subject, e.ingredient]);
          const changed = [
            ...profile.exclusions.filter(
              (e) => !old.some((o) => key(o) === key(e)),
            ),
            ...old.filter(
              (e) => !profile.exclusions.some((o) => key(o) === key(e)),
            ),
          ];
          if (
            changed.some(
              (e) =>
                !message.toLowerCase().includes(e.ingredient.toLowerCase()) ||
                (e.subject !== "household" &&
                  !message.toLowerCase().includes(e.subject.toLowerCase())),
            )
          )
            throw new Error(
              "Dietary exclusion changes require the ingredient and person in the user request.",
            );
          encoded = await api.memo(
            "household-profile-change",
            JSON.stringify({
              expectedRevision: current?.revision ?? 0,
              profile,
            }),
            mealContext,
          );
        }
        return json(
          await saveHousehold(prisma, context.actorId, {
            ...JSON.parse(encoded),
            operationId: operation(context, api),
          }),
        );
      },
    }),

    defineTool({
      name: "get_shopping_cycle",
      description:
        "Read routes, arrival dates, remaining quantities, purchases and requirement fingerprints for the current selection.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async (_args, api) =>
        json(await getShoppingCycle(prisma, (await run(api)).selectionId)),
    }),
    defineTool({
      name: "change_shopping_cycle",
      description:
        "Record only an explicit user instruction: route, arrival date, or an actual purchased amount and purchase time. Read get_shopping_cycle first; copy observedFingerprint or observedSelectionRevision from that read. Planned routes or dates never imply a purchase.",
      parameters: Type.Object({
        command: Type.Union([
          Type.Object({
            type: Type.Literal("route"),
            lineId: Type.String(),
            route: shoppingRoute,
            neededOn: Type.Optional(Type.String()),
            availableOn: Type.Optional(Type.String()),
          }),
          Type.Object({
            type: Type.Literal("route_defaults"),
            route: shoppingRoute,
            availableOn: Type.String(),
            neededOn: Type.Optional(Type.String()),
            observedSelectionRevision: Type.Integer({ minimum: 0 }),
          }),
          Type.Object({
            type: Type.Literal("purchase"),
            lineId: Type.String(),
            quantity: Type.Number({ exclusiveMinimum: 0 }),
            unit: Type.String(),
            observedFingerprint: Type.String(),
            purchasedAt: Type.String(),
          }),
        ]),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        const prior = await receipt(prisma, context, api);
        if (prior) {
          if (prior.documentId !== `shopping_${context.selectionId}`)
            throw new Error("Shopping receipt selection mismatch.");
          const doc =
            prior.result as unknown as MealDocument<ShoppingCycleData>;
          const selection = await getSelection(prisma, context.selectionId);
          if (!selection) throw new Error("Recipe selection not found.");
          return json(shoppingCycleView(doc.data, selection, doc.revision));
        }
        let encoded = await api.memo<string>("shopping-change", mealContext);
        if (!encoded) {
          const cycle = await getShoppingCycle(prisma, context.selectionId);
          encoded = await api.memo(
            "shopping-change",
            JSON.stringify({ revision: cycle.revision, command: args.command }),
            mealContext,
          );
        }
        const prepared = JSON.parse(encoded) as {
          revision: number;
          command: ShoppingCycleCommand;
        };
        return json(
          await changeShoppingCycle(
            prisma,
            context.selectionId,
            context.actorId,
            {
              expectedActorId: context.actorId,
              operationId: operation(context, api),
              expectedRevision: prepared.revision,
              command: prepared.command,
            },
          ),
        );
      },
    }),
    defineTool({
      name: "get_household",
      description:
        "Read the saved household routine and its confirmation status. Do not turn interview notes or inferred preferences into confirmed constraints.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => json(await getHousehold(prisma)),
    }),
    defineTool({
      name: "get_household_candidates",
      description:
        "Read actual rotation candidates for the saved household routine. expanded broadens the view only when requested.",
      parameters: Type.Object({
        expanded: Type.Optional(Type.Boolean()),
        search: Type.Optional(Type.String({ maxLength: 200 })),
      }),
      replay: "safe",
      execute: async (args) => json(await rotationCandidates(prisma, args)),
    }),
    defineTool({
      name: "prepare_our_week",
      description:
        "Prepare a new selection and week from an already confirmed household routine. Use only the user-chosen start date, away dates and temporary exclusions. Returns selection and week IDs; this conversation remains on its current selection. Ask the user to open the returned week.",
      parameters: Type.Object({
        startDate: Type.String(),
        away: Type.Optional(
          Type.Array(
            Type.Object({
              date: Type.String(),
              member: Type.Union([
                Type.Literal("James"),
                Type.Literal("Manon"),
              ]),
            }),
          ),
        ),
        temporaryExclusions: Type.Optional(Type.Array(Type.String())),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        const cached = await api.memo<string>("household-result", mealContext);
        if (cached) return json(JSON.parse(cached));
        let encoded = await api.memo<string>(
          "household-preparation",
          mealContext,
        );
        if (!encoded) {
          const household = await getHousehold(prisma);
          if (!household?.data.profile.confirmed)
            throw new Error(
              "Confirm a household routine before preparing a week.",
            );
          const input = preparationSchema.parse({
            ...args,
            operationId: operation(context, api),
            expectedRevision: household.revision,
          });
          encoded = await api.memo(
            "household-preparation",
            JSON.stringify(input),
            mealContext,
          );
        }
        const result = await prepareHouseholdWeek(
          prisma,
          context.actorId,
          JSON.parse(encoded),
        );
        const response = {
          ...result,
          currentConversationSelectionId: context.selectionId,
          openWeekId: result.week.id,
        };
        return json(
          JSON.parse(
            await api.memo(
              "household-result",
              JSON.stringify(response),
              mealContext,
            ),
          ),
        );
      },
    }),

    defineTool({
      name: "find_library_recipe",
      description:
        "Find real stored library recipes by name. Use returned IDs, never invent recipes.",
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 200 }),
      }),
      replay: "safe",
      execute: async (args) =>
        json(
          (
            await prisma.recipe.findMany({
              where: { name: { contains: args.query, mode: "insensitive" } },
              take: 20,
              orderBy: { name: "asc" },
              include: { recipeIngredients: { include: { ingredient: true } } },
            })
          ).map((r) => librarySnapshot(r)),
        ),
    }),
    defineTool({
      name: "add_library_recipe",
      description: "Add an actual library recipe to the current selection.",
      parameters: Type.Object({
        recipeId: Type.String(),
        servings: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      }),
      replay: "safe",
      execute: async (args, api) =>
        json(
          await selectionMutation(prisma, await run(api), api, async (s) => {
            const item = await library(args.recipeId, args.servings);
            if (s.items.some((i) => i.id === item.id))
              throw new Error(
                "Recipe already selected. Change its servings instead.",
              );
            return { type: "replace_items", items: [...s.items, item] };
          }),
        ),
    }),
    defineTool({
      name: "remove_selected_recipe",
      description: "Remove a selected recipe by its item ID.",
      parameters: Type.Object({ itemId: Type.String() }),
      replay: "safe",
      execute: async (args, api) =>
        json(
          await selectionMutation(prisma, await run(api), api, async (s) => {
            if (!s.items.some((i) => i.id === args.itemId))
              throw new Error("Selected recipe not found.");
            return {
              type: "replace_items",
              items: s.items.filter((i) => i.id !== args.itemId),
            };
          }),
        ),
    }),
    defineTool({
      name: "replace_selected_recipe",
      description: "Swap one selected recipe for an actual library recipe.",
      parameters: Type.Object({
        itemId: Type.String(),
        recipeId: Type.String(),
        servings: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      }),
      replay: "safe",
      execute: async (args, api) =>
        json(
          await selectionMutation(prisma, await run(api), api, async (s) => {
            if (!s.items.some((i) => i.id === args.itemId))
              throw new Error("Selected recipe not found.");
            const item = await library(args.recipeId, args.servings);
            return {
              type: "replace_items",
              items: s.items.map((i) =>
                i.id === args.itemId ? { ...item, id: args.itemId } : i,
              ),
            };
          }),
        ),
    }),
    defineTool({
      name: "import_recipe_draft",
      description:
        "Import a user-supplied URL or exact user-supplied recipe text through bounded intake. Never fabricate source text. Returns editable gaps; ask the user for missing details.",
      parameters: Type.Object({
        url: Type.Optional(Type.String({ maxLength: 4000 })),
        text: Type.Optional(Type.String({ maxLength: 128000 })),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        const prior = await receipt(prisma, context, api);
        let draft: RecipeDraft;
        if (prior) {
          const row = prior.result as unknown as MealDocument<RecipeDraft>;
          draft = { ...row.data, revision: row.revision };
        } else {
          const message = await prisma.piMealOutbox.findUnique({
            where: { id: context.requestId },
          });
          const original = (
            message?.payload as { message?: string } | undefined
          )?.message;
          if (
            message?.actorId !== context.actorId ||
            message?.documentId !== context.selectionId ||
            !original ||
            (args.text && !original.includes(args.text)) ||
            (args.url && !original.includes(args.url))
          )
            throw new Error(
              "Import requires exact recipe text or URL supplied in the current user message.",
            );
          draft = await createDraft(
            prisma,
            context.actorId,
            intakeSchema.parse({
              ...args,
              operationId: operation(context, api),
            }),
          );
        }
        await remember(api, draft.id);
        return json(draft);
      },
    }),
    defineTool({
      name: "get_recipe_draft",
      description:
        "Read an imported or selected draft, including evidence and gaps.",
      parameters: Type.Object({ draftId: Type.String() }),
      replay: "safe",
      execute: async (args, api) => json(await tracked(api, args.draftId)),
    }),
    defineTool({
      name: "patch_recipe_draft",
      description:
        "Apply only details supplied or confirmed by the user to an attached draft. Preserve unknown quantities as null.",
      parameters: Type.Object({
        draftId: Type.String(),
        draft: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1 })),
          servings: Type.Optional(
            Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
          ),
          ingredients: Type.Optional(
            Type.Array(
              Type.Object({
                name: Type.String(),
                quantity: Type.Union([
                  Type.Number({ exclusiveMinimum: 0 }),
                  Type.Null(),
                ]),
                unit: Type.String(),
                raw: Type.Optional(Type.String()),
              }),
              { maxItems: 500 },
            ),
          ),
          instructions: Type.Optional(
            Type.Array(Type.String(), { maxItems: 500 }),
          ),
        }),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        const prior = await receipt(prisma, context, api);
        if (prior) {
          const row = prior.result as unknown as MealDocument<RecipeDraft>;
          return json({ ...row.data, revision: row.revision });
        }
        let prepared = await api.memo<{ revision: number }>(
          "draft-revision",
          mealContext,
        );
        if (!prepared)
          prepared = await api.memo(
            "draft-revision",
            { revision: (await tracked(api, args.draftId)).revision },
            mealContext,
          );
        return json(
          await patchDraft(
            prisma,
            context.actorId,
            args.draftId,
            patchSchema.parse({
              operationId: operation(context, api),
              expectedRevision: prepared.revision,
              draft: args.draft,
            }),
          ),
        );
      },
    }),
    defineTool({
      name: "save_recipe_draft",
      description:
        "Save an attached complete draft to the recipe library for reuse. Does not add it to the selection; use add_library_recipe with returned recipeId.",
      parameters: Type.Object({ draftId: Type.String() }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        const prior = await receipt(prisma, context, api);
        if (prior) {
          const row = prior.result as unknown as MealDocument<RecipeDraft>;
          return json({ ...row.data, revision: row.revision });
        }
        let prepared = await api.memo<{ revision: number }>(
          "draft-revision",
          mealContext,
        );
        if (!prepared)
          prepared = await api.memo(
            "draft-revision",
            { revision: (await tracked(api, args.draftId)).revision },
            mealContext,
          );
        return json(
          await saveDraft(prisma, context.actorId, args.draftId, {
            operationId: operation(context, api),
            expectedRevision: prepared.revision,
          }),
        );
      },
    }),
    defineTool({
      name: "add_recipe_draft",
      description:
        "Add an attached draft to the current selection. Requires confirmed base servings; unknown ingredient amounts remain visible.",
      parameters: Type.Object({
        draftId: Type.String(),
        servings: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      }),
      replay: "safe",
      execute: async (args, api) =>
        json(
          await selectionMutation(prisma, await run(api), api, async (s) => {
            const d = await tracked(api, args.draftId);
            if (!d.servings)
              throw new Error(
                "Confirm base servings before selecting this draft.",
              );
            const id = `draft:${d.id}`;
            if (s.items.some((i) => i.id === id))
              throw new Error("Draft already selected.");
            return {
              type: "replace_items",
              items: [
                ...s.items,
                {
                  id,
                  draftId: d.id,
                  name: d.name,
                  source: d.source,
                  baseServings: d.servings,
                  servings: args.servings ?? d.servings,
                  ingredients: d.ingredients,
                },
              ],
            };
          }),
        ),
    }),
    defineTool({
      name: "get_linked_weeks",
      description:
        "Read weeks linked to the current recipe selection, including lunch coverage, away days, skipped batches and sessions.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async (_args, api) => {
        const context = await run(api);
        const docs = (await listDocuments<WeekData>(prisma, "week")).filter(
          (d) => d.data.selectionId === context.selectionId,
        );
        const selection = await getSelection(prisma, context.selectionId);
        const cycle = selection
          ? await getShoppingCycle(prisma, context.selectionId)
          : undefined;
        return json(docs.map((d) => weekView(d, selection, cycle)));
      },
    }),
    defineTool({
      name: "change_linked_week",
      description:
        "Change only a week linked to the current selection. Supports sessions, batch session/status (cooked requires actual cookedAt), allocations including away/freezer confirmation, routines, feedback and refresh_selection. Read the week first; send the full allocation array when changing an away day.",
      parameters: Type.Object({
        weekId: Type.Optional(Type.String()),
        command: Type.Union([
          Type.Object({
            type: Type.Literal("set_sessions"),
            sessions: Type.Tuple([Type.String(), Type.String()]),
          }),
          Type.Object({
            type: Type.Literal("set_batch_session"),
            batchId: Type.String(),
            session: Type.Union([Type.Literal(0), Type.Literal(1)]),
          }),
          Type.Object({
            type: Type.Literal("set_status"),
            batchId: Type.String(),
            status: Type.Union([
              Type.Literal("planned"),
              Type.Literal("cooked"),
              Type.Literal("skipped"),
            ]),
            cookedAt: Type.Optional(Type.String()),
          }),
          Type.Object({
            type: Type.Literal("set_allocations"),
            allocations: Type.Array(
              Type.Object({
                date: Type.String(),
                member: Type.Union([
                  Type.Literal("James"),
                  Type.Literal("Manon"),
                ]),
                batchId: Type.Union([Type.String(), Type.Null()]),
                portions: Type.Number({ exclusiveMinimum: 0 }),
                away: Type.Boolean(),
                freezeConfirmed: Type.Boolean(),
              }),
              { maxItems: 14 },
            ),
          }),
          Type.Object({
            type: Type.Literal("set_routines"),
            routines: Type.Array(
              Type.Object({
                id: Type.String(),
                meal: Type.Union([
                  Type.Literal("breakfast"),
                  Type.Literal("light_dinner"),
                ]),
                note: Type.String(),
                itemId: Type.Optional(Type.String()),
              }),
              { maxItems: 20 },
            ),
          }),
          Type.Object({
            type: Type.Literal("set_feedback"),
            batchId: Type.String(),
            feedback: Type.Union([
              Type.Literal("make_again"),
              Type.Literal("too_much_effort"),
              Type.Literal("not_this_week"),
              Type.Null(),
            ]),
          }),
          Type.Object({ type: Type.Literal("refresh_selection") }),
        ]),
      }),
      replay: "safe",
      execute: async (args, api) => {
        const context = await run(api);
        const prior = await receipt(prisma, context, api);
        if (prior) {
          const row = prior.result as unknown as MealDocument<WeekData>;
          if (row.data.selectionId !== context.selectionId)
            throw new Error("Week is not linked to this selection.");
          return json(
            weekView(
              row,
              await getSelection(prisma, context.selectionId),
              await getShoppingCycle(prisma, context.selectionId),
            ),
          );
        }
        let prepared = await api.memo<{ id: string; revision: number }>(
          "week-target",
          mealContext,
        );
        if (!prepared) {
          const { doc } = await linked(api, args.weekId);
          prepared = await api.memo(
            "week-target",
            { id: doc.id, revision: doc.revision },
            mealContext,
          );
        }
        return json(
          await changeWeek(prisma, prepared.id, context.actorId, {
            operationId: operation(context, api),
            expectedRevision: prepared.revision,
            command: args.command as WeekCommand,
          }),
        );
      },
    }),
  ];
}
