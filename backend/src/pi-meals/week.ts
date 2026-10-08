import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type {
  CommandEnvelope,
  RecipeSelection,
  SelectionItem,
} from "./contracts.js";
import { createSelection, getSelection } from "./selections.js";
import { shoppingCycleView, type ShoppingCycleData } from "./shopping-cycle.js";
type ShoppingCycle = ReturnType<typeof shoppingCycleView>;
import {
  listDocuments,
  mutateDocument,
  readDocument,
  type MealDocument,
} from "./store.js";
export type Member = "James" | "Manon";
export interface WeekBatch {
  id: string;
  itemId: string;
  snapshot: SelectionItem;
  session: 0 | 1;
  status: "planned" | "cooked" | "skipped";
  cookedAt?: string;
  feedback?: "make_again" | "too_much_effort" | "not_this_week";
}
export interface Allocation {
  date: string;
  member: Member;
  batchId: string | null;
  portions: number;
  away: boolean;
  freezeConfirmed: boolean;
  uncoveredReason?: string;
}
export interface Routine {
  id: string;
  meal: "breakfast" | "light_dinner";
  note: string;
  itemId?: string;
}
export interface WeekData {
  selectionId: string;
  selectionRevision: number;
  startDate: string;
  sessions: [string, string];
  batches: WeekBatch[];
  allocations: Allocation[];
  routines: Routine[];
  routineItemIds?: string[];
  routineItems?: SelectionItem[];
  sourceWeekId?: string;
}
export interface MealWeek extends WeekData {
  id: string;
  revision: number;
  needsRefresh: boolean;
  batchesSummary: Array<{
    id: string;
    yield: number;
    allocated: number;
    remaining: number;
  }>;
  lunches: Array<
    Allocation & {
      coverage: "away" | "uncovered" | "planned" | "cooked";
      freezeRequired: boolean;
      storageNote: string;
      ingredientWarnings: string[];
    }
  >;
}
const text = z.string().trim().min(1);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a real calendar date.",
  );
const allocation = z
  .object({
    date,
    member: z.enum(["James", "Manon"]),
    batchId: text.nullable(),
    portions: z.number().finite().positive(),
    away: z.boolean(),
    freezeConfirmed: z.boolean(),
    uncoveredReason: text.optional(),
  })
  .strict();
const routine = z
  .object({
    id: text,
    meal: z.enum(["breakfast", "light_dinner"]),
    note: text,
    itemId: text.optional(),
  })
  .strict();
const commands = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set_sessions"),
      sessions: z.tuple([date, date]),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_batch_session"),
      batchId: text,
      session: z.union([z.literal(0), z.literal(1)]),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_status"),
      batchId: text,
      status: z.enum(["planned", "cooked", "skipped"]),
      cookedAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_allocations"),
      allocations: z.array(allocation),
    })
    .strict(),
  z
    .object({ type: z.literal("set_routines"), routines: z.array(routine) })
    .strict(),
  z
    .object({
      type: z.literal("set_feedback"),
      batchId: text,
      feedback: z
        .enum(["make_again", "too_much_effort", "not_this_week"])
        .nullable(),
    })
    .strict(),
  z.object({ type: z.literal("refresh_selection") }).strict(),
]);
export type WeekCommand = z.infer<typeof commands>;
function bad(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    bad(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
function day(start: string, offset: number) {
  return new Date(Date.parse(start) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}
function isCookingItem(item: SelectionItem): boolean {
  return !item.id.startsWith("routine:") || !!item.recipeId || !!item.draftId;
}
function batchSession(item: SelectionItem, index: number): 0 | 1 {
  if (item.id.startsWith("routine:bake:") || item.id === "batch:0") return 0;
  if (item.id === "batch:1") return 1;
  return (index % 2) as 0 | 1;
}
export function makeWeek(
  selection: RecipeSelection,
  startDate: string,
): WeekData {
  if (!selection.items.length) bad("Choose recipes in Shop recipes first.");
  return {
    selectionId: selection.id,
    selectionRevision: selection.revision,
    startDate,
    sessions: [startDate, day(startDate, 3)],
    routineItems: structuredClone(
      selection.items.filter((i) => !isCookingItem(i)),
    ),
    routineItemIds: selection.items
      .filter((i) => !isCookingItem(i))
      .map((i) => i.id),
    batches: selection.items
      .filter((i) => isCookingItem(i))
      .map((item, index) => ({
        id: item.id,
        itemId: item.id,
        snapshot: structuredClone(item),
        session: batchSession(item, index),
        status: "planned",
      })),
    allocations: Array.from({ length: 5 }, (_, offset) =>
      (["James", "Manon"] as Member[]).map((member) => ({
        date: day(startDate, offset),
        member,
        batchId: null,
        portions: 1,
        away: false,
        freezeConfirmed: false,
      })),
    ).flat(),
    routines: [],
  };
}
function validate(data: WeekData) {
  const slots = new Set<string>();
  for (const row of data.allocations) {
    if (row.date < data.startDate || row.date > day(data.startDate, 6))
      bad("Lunch date must be within this week.");
    const key = `${row.date}:${row.member}`;
    if (slots.has(key)) bad("Each person has one lunch allocation per day.");
    slots.add(key);
    if (row.batchId && !data.batches.some((b) => b.id === row.batchId))
      bad("Unknown batch.");
  }
  for (const batch of data.batches) {
    const used = data.allocations
      .filter((a) => !a.away && a.batchId === batch.id)
      .reduce((sum, a) => sum + a.portions, 0);
    if (used > batch.snapshot.servings)
      bad(
        "Allocations exceed this batch yield. Update servings in Shop recipes, then refresh this week.",
      );
  }
  for (const row of data.routines)
    if (
      row.itemId &&
      !data.batches.some((b) => b.itemId === row.itemId) &&
      !data.routineItemIds?.includes(row.itemId)
    )
      bad("Routine recipe must belong to the linked selection.");
}
export function reduceWeek(
  current: WeekData | null,
  command: WeekCommand,
  selection?: RecipeSelection,
): WeekData {
  if (!current)
    throw Object.assign(new Error("Week not found."), { statusCode: 404 });
  let next = structuredClone(current);
  if (command.type === "set_sessions") next.sessions = command.sessions;
  if (command.type === "set_feedback") {
    const batch = next.batches.find((b) => b.id === command.batchId);
    if (!batch) bad("Unknown batch.");
    batch.feedback = command.feedback ?? undefined;
  }
  if (command.type === "set_allocations")
    next.allocations = command.allocations.map((row) => ({
      ...row,
      uncoveredReason: row.batchId ? undefined : row.uncoveredReason,
    }));
  if (command.type === "set_routines") next.routines = command.routines;
  if (command.type === "set_batch_session" || command.type === "set_status") {
    const batch = next.batches.find((b) => b.id === command.batchId);
    if (!batch) bad("Unknown batch.");
    if (command.type === "set_batch_session") {
      batch.session = command.session;
      next.allocations.forEach((a) => {
        if (a.batchId === batch.id) a.freezeConfirmed = false;
      });
    } else {
      if (command.status === "cooked" && !command.cookedAt)
        bad("Record the actual cooked time.");
      batch.status = command.status;
      batch.cookedAt =
        command.status === "cooked" ? command.cookedAt : undefined;
      next.allocations.forEach((a) => {
        if (a.batchId === batch.id) a.freezeConfirmed = false;
      });
    }
  }
  if (command.type === "set_sessions")
    next.allocations.forEach((a) => (a.freezeConfirmed = false));
  if (command.type === "refresh_selection") {
    if (!selection) bad("Selection unavailable.");
    next.selectionRevision = selection.revision;
    const previous = next.batches;
    next.routineItems = structuredClone(
      selection.items.filter((i) => !isCookingItem(i)),
    );
    next.routineItemIds = selection.items
      .filter((i) => !isCookingItem(i))
      .map((i) => i.id);
    next.batches = selection.items
      .filter((i) => isCookingItem(i))
      .map((item, index) => {
        const old = previous.find((b) => b.itemId === item.id);
        if (old?.status === "cooked") return old;
        return {
          ...old,
          id: item.id,
          itemId: item.id,
          snapshot: structuredClone(item),
          session: old?.session ?? batchSession(item, index),
          status: old?.status ?? "planned",
        };
      });
    next.batches.push(
      ...previous.filter(
        (b) =>
          b.status === "cooked" && !next.batches.some((n) => n.id === b.id),
      ),
    );
    next.allocations.forEach((a) => {
      const batch = next.batches.find((b) => b.id === a.batchId);
      if (!batch) {
        a.batchId = null;
        a.freezeConfirmed = false;
      } else if (
        fingerprint(batch.snapshot) !==
        fingerprint(previous.find((b) => b.id === batch.id)!.snapshot)
      )
        a.freezeConfirmed = false;
    });
    for (const batch of next.batches) {
      const old = previous.find((entry) => entry.id === batch.id);
      if (
        !old ||
        batch.status === "cooked" ||
        batch.snapshot.servings >= old.snapshot.servings
      )
        continue;
      let capacity = batch.snapshot.servings;
      const rows = next.allocations
        .filter((row) => !row.away && row.batchId === batch.id)
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || a.member.localeCompare(b.member),
        );
      for (const row of rows) {
        if (row.portions <= capacity + 1e-9) capacity -= row.portions;
        else {
          row.batchId = null;
          row.freezeConfirmed = false;
          row.uncoveredReason = `${batch.snapshot.name} yield reduced to ${batch.snapshot.servings} portions. Reassign this lunch; its previous ${row.portions} portions no longer fit.`;
        }
      }
    }
    next.routines = next.routines.filter(
      (r) =>
        !r.itemId ||
        next.batches.some((b) => b.itemId === r.itemId) ||
        next.routineItemIds?.includes(r.itemId),
    );
  }
  validate(next);
  return next;
}
function fingerprint(item: SelectionItem): string {
  return JSON.stringify([
    item.recipeId,
    item.draftId,
    item.name,
    item.source,
    item.baseServings,
    item.servings,
    item.ingredients.map((i) => [i.name, i.quantity, i.unit, i.raw]),
  ]);
}
function staleBatch(
  batch: WeekBatch,
  selection: RecipeSelection | null,
): boolean {
  if (batch.status === "cooked") return false;
  const item = selection?.items.find((i) => i.id === batch.itemId);
  return !item || fingerprint(item) !== fingerprint(batch.snapshot);
}
function routineSnapshotsChanged(
  data: WeekData,
  selection: RecipeSelection,
): boolean {
  const items = selection.items.filter((item) => !isCookingItem(item));
  const saved = data.routineItems ?? [];
  return (
    items.length !== saved.length ||
    items.some((item) => {
      const previous = saved.find((old) => old.id === item.id);
      return !previous || fingerprint(previous) !== fingerprint(item);
    })
  );
}
// Supply is consumed once, in cooking order. An early batch can use stock while
// the later batch waits for the remainder of the same merged shopping line.
function batchIngredientWarnings(
  data: WeekData,
  selection: RecipeSelection | null,
  cycle?: ShoppingCycle | null,
): Map<string, string[]> {
  const warnings = new Map(
    data.batches.map((batch) => [batch.id, [] as string[]]),
  );
  if (!selection) return warnings;
  const ordered = data.batches
    .filter((batch) => batch.status !== "skipped")
    .sort((a, b) => {
      const first = a.cookedAt?.slice(0, 10) ?? data.sessions[a.session];
      const second = b.cookedAt?.slice(0, 10) ?? data.sessions[b.session];
      return first.localeCompare(second) || a.id.localeCompare(b.id);
    });
  for (const requirement of selection.lines) {
    const line = cycle?.lines.find((row) => row.id === requirement.id);
    const supplies: Array<{ quantity: number; date: string }> = [
      { quantity: requirement.haveQuantity, date: "" },
    ];
    for (const purchase of cycle?.purchases ?? []) {
      if (line && purchase.lineId === line.id && purchase.unit === line.unit)
        supplies.push({
          quantity: purchase.quantity,
          date: purchase.purchasedAt.slice(0, 10),
        });
    }
    if (
      line &&
      !line.sourceChanged &&
      line.availableOn &&
      line.remainingQuantity !== null
    )
      supplies.push({
        quantity: line.remainingQuantity,
        date: line.availableOn,
      });
    supplies.sort((a, b) => a.date.localeCompare(b.date));
    for (const batch of ordered) {
      const contributions = requirement.sources.filter(
        (source) => source.itemId === batch.itemId,
      );
      if (!contributions.length) continue;
      const cookDate =
        batch.cookedAt?.slice(0, 10) ?? data.sessions[batch.session];
      if (contributions.some((source) => source.quantity === null)) {
        if (batch.status === "planned")
          warnings
            .get(batch.id)!
            .push(`${requirement.name}: required amount is unknown.`);
        continue;
      }
      let missing = contributions.reduce(
        (sum, source) => sum + source.quantity!,
        0,
      );
      for (const supply of supplies) {
        if (supply.date > cookDate) continue;
        const used = Math.min(missing, supply.quantity);
        supply.quantity -= used;
        missing -= used;
      }
      if (missing <= 1e-9 || batch.status === "cooked") continue;
      const reason = line?.sourceChanged
        ? "shopping requirement changed; check the arrival plan."
        : !line?.availableOn
          ? "arrival date is unknown; confirm it is available before cooking."
          : line.availableOn > cookDate
            ? `arrives ${line.availableOn}, after cooking on ${cookDate}.`
            : "available supply is already reserved for another batch; check the required amount.";
      warnings
        .get(batch.id)!
        .push(
          `${requirement.name}: ${missing} ${requirement.unit} still needed; ${reason}`,
        );
    }
  }
  return warnings;
}
export function weekView(
  document: MealDocument<WeekData>,
  selection: RecipeSelection | null,
  cycle?: ShoppingCycle | null,
): MealWeek {
  const data = document.data,
    needsRefresh =
      !selection ||
      routineSnapshotsChanged(data, selection) ||
      data.batches.some((b) => staleBatch(b, selection)) ||
      selection.items.some(
        (i) => isCookingItem(i) && !data.batches.some((b) => b.itemId === i.id),
      );
  const batchWarnings = batchIngredientWarnings(data, selection, cycle);
  return {
    ...data,
    id: document.id,
    revision: document.revision,
    needsRefresh,
    batchesSummary: data.batches.map((b) => {
      const allocated = data.allocations
        .filter((a) => !a.away && a.batchId === b.id)
        .reduce((s, a) => s + a.portions, 0);
      return {
        id: b.id,
        yield: b.snapshot.servings,
        allocated,
        remaining: b.snapshot.servings - allocated,
      };
    }),
    lunches: data.allocations.map((a) => {
      const b = data.batches.find((b) => b.id === a.batchId),
        cook = b
          ? (b.cookedAt ?? `${data.sessions[b.session]}T12:00:00Z`)
          : null,
        eat = `${a.date}T12:00:00Z`,
        before = !!cook && Date.parse(eat) < Date.parse(cook),
        freezeRequired =
          !!cook && Date.parse(eat) - Date.parse(cook) > 48 * 3600000;
      const ingredientWarnings = b ? (batchWarnings.get(b.id) ?? []) : [];
      const uncovered =
        ingredientWarnings.length > 0 ||
        (b ? staleBatch(b, selection) : false) ||
        !b ||
        b.status === "skipped" ||
        before ||
        (freezeRequired && !a.freezeConfirmed);
      return {
        ...a,
        coverage: a.away
          ? "away"
          : uncovered
            ? "uncovered"
            : b?.status === "cooked"
              ? "cooked"
              : "planned",
        freezeRequired,
        ingredientWarnings,
        storageNote:
          a.uncoveredReason ??
          (freezeRequired
            ? "Freeze promptly after cooking; thaw safely in the fridge before this lunch. Confirm freezer space and this plan."
            : before
              ? "Lunch is before this batch is cooked."
              : "Refrigerate promptly; eat within 48 hours. Actual cooking must be recorded."),
      };
    }),
  };
}
async function cycleFor(
  prisma: PrismaClient,
  selection: RecipeSelection | null,
) {
  if (!selection) return null;
  const doc = await readDocument<ShoppingCycleData>(
    prisma,
    `shopping_${selection.id}`,
    "shopping_cycle",
  );
  return shoppingCycleView(doc?.data ?? null, selection, doc?.revision ?? 0);
}
async function view(prisma: PrismaClient, doc: MealDocument<WeekData>) {
  const selection = await getSelection(prisma, doc.data.selectionId);
  return weekView(doc, selection, await cycleFor(prisma, selection));
}
export async function getWeek(prisma: PrismaClient, id: string) {
  const doc = await readDocument<WeekData>(prisma, id, "week");
  return doc ? view(prisma, doc) : null;
}
export async function listWeeks(prisma: PrismaClient) {
  const docs = await listDocuments<WeekData>(prisma, "week");
  const sources = new Map(
    await Promise.all(
      [...new Set(docs.map((doc) => doc.data.selectionId))].map(async (id) => {
        const selection = await getSelection(prisma, id);
        return [
          id,
          { selection, cycle: await cycleFor(prisma, selection) },
        ] as const;
      }),
    ),
  );
  return docs.map((doc) => {
    const source = sources.get(doc.data.selectionId)!;
    return weekView(doc, source.selection, source.cycle);
  });
}
export async function createWeek(
  prisma: PrismaClient,
  actorId: string,
  input: unknown,
) {
  const parsed = parse(
    z
      .object({
        operationId: text,
        selectionId: text.optional(),
        sourceWeekId: text.optional(),
        startDate: date,
      })
      .strict()
      .refine(
        (v) => !!v.selectionId !== !!v.sourceWeekId,
        "Choose a selection or source week.",
      ),
    input,
  );
  const source = parsed.sourceWeekId
    ? await readDocument<WeekData>(prisma, parsed.sourceWeekId, "week")
    : null;
  if (parsed.sourceWeekId && !source) bad("Source week not found.");
  const repeatSelectionId = `selection_${createHash("sha256")
    .update(JSON.stringify([actorId, `${parsed.operationId}:repeat-selection`]))
    .digest("hex")
    .slice(0, 24)}`;
  const existingRepeat = source
    ? await getSelection(prisma, repeatSelectionId)
    : null;
  if (source && !existingRepeat) {
    const linked = await getSelection(prisma, source.data.selectionId);
    if (!linked || routineSnapshotsChanged(source.data, linked))
      bad(
        "Routine supplies changed. Refresh the source week before repeating it.",
      );
  }
  const selection = source
    ? (existingRepeat ??
      (await createSelection(prisma, actorId, {
        operationId: `${parsed.operationId}:repeat-selection`,
        title: `Week from ${parsed.startDate}`,
        items: [
          ...source.data.batches.map((b) => b.snapshot),
          ...(source.data.routineItems ?? []),
        ],
      })))
    : await getSelection(prisma, parsed.selectionId!);
  if (!selection) bad("Recipe selection not found.");
  const id = `week_${createHash("sha256")
    .update(JSON.stringify([actorId, parsed.operationId]))
    .digest("hex")
    .slice(0, 24)}`;
  return view(
    prisma,
    await mutateDocument<WeekData>(prisma, {
      id,
      kind: "week",
      operationId: parsed.operationId,
      actorId,
      expectedRevision: 0,
      payload: parsed,
      reduce: () => {
        const next = makeWeek(selection, parsed.startDate);
        if (source) {
          const offset =
            Date.parse(parsed.startDate) - Date.parse(source.data.startDate);
          const shift = (date: string) =>
            new Date(Date.parse(date) + offset).toISOString().slice(0, 10);
          next.sourceWeekId = source.id;
          next.sessions = source.data.sessions.map(shift) as [string, string];
          next.batches.forEach((b) => {
            b.session =
              source.data.batches.find((old) => old.itemId === b.itemId)
                ?.session ?? b.session;
          });
          next.allocations = source.data.allocations.map((a) => ({
            ...a,
            date: shift(a.date),
            freezeConfirmed: false,
          }));
          next.routines = structuredClone(
            source.data.routines.filter(
              (r) =>
                !r.itemId ||
                next.batches.some((b) => b.itemId === r.itemId) ||
                next.routineItemIds?.includes(r.itemId),
            ),
          );
          validate(next);
        }
        return next;
      },
    }),
  );
}
export async function changeWeek(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: CommandEnvelope<WeekCommand>,
) {
  const parsed = parse(
    z
      .object({
        operationId: text,
        expectedRevision: z.number().int().nonnegative().max(2147483646),
        command: commands,
      })
      .strict(),
    input,
  );
  const existing = await readDocument<WeekData>(prisma, id, "week");
  const selection = existing
    ? await getSelection(prisma, existing.data.selectionId)
    : null;
  return view(
    prisma,
    await mutateDocument<WeekData>(prisma, {
      id,
      kind: "week",
      operationId: parsed.operationId,
      actorId,
      expectedRevision: parsed.expectedRevision,
      payload: parsed.command,
      reduce: (current) =>
        reduceWeek(current, parsed.command, selection ?? undefined),
    }),
  );
}
