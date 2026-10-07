import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { RecipeSelection, ShoppingLine } from "./contracts.js";
import { getSelection } from "./selections.js";
import { MealConflict, mutateDocument, readDocument } from "./store.js";
export type ShoppingRoute = "supermarket" | "market" | "topup";
export interface RouteDecision {
  lineId: string;
  route: ShoppingRoute;
  neededOn?: string;
  availableOn?: string;
  fingerprint: string;
  actorId: string;
  recordedAt: string;
}
export interface PurchaseObservation {
  lineId: string;
  quantity: number;
  unit: string;
  fingerprint: string;
  actorId: string;
  purchasedAt: string;
  recordedAt: string;
}
export interface ShoppingCycleData {
  selectionId: string;
  selectionRevision: number;
  routes: RouteDecision[];
  purchases: PurchaseObservation[];
}
export type ShoppingCycleCommand =
  | {
      type: "route_defaults";
      route: ShoppingRoute;
      availableOn: string;
      neededOn?: string;
      observedSelectionRevision: number;
    }
  | {
      type: "route";
      lineId: string;
      route: ShoppingRoute;
      neededOn?: string;
      availableOn?: string;
    }
  | {
      type: "purchase";
      lineId: string;
      quantity: number;
      unit: string;
      observedFingerprint: string;
      purchasedAt: string;
    };
const text = z.string().trim().min(1);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const schema = z
  .object({
    expectedActorId: text,
    operationId: text,
    expectedRevision: z.number().int().nonnegative(),
    command: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("route_defaults"),
          route: z.enum(["supermarket", "market", "topup"]),
          availableOn: day,
          neededOn: day.optional(),
          observedSelectionRevision: z.number().int().nonnegative(),
        })
        .strict(),
      z
        .object({
          type: z.literal("route"),
          lineId: text,
          route: z.enum(["supermarket", "market", "topup"]),
          neededOn: day.optional(),
          availableOn: day.optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("purchase"),
          lineId: text,
          quantity: z.number().finite().positive(),
          unit: z.string(),
          observedFingerprint: text,
          purchasedAt: z.string().datetime(),
        })
        .strict(),
    ]),
  })
  .strict();
export function shoppingFingerprint(line: ShoppingLine): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        line.id,
        line.name,
        line.unit,
        line.buyQuantity,
        line.sources,
      ]),
    )
    .digest("hex");
}
export function shoppingCycleView(
  data: ShoppingCycleData | null,
  selection: RecipeSelection,
  revision: number,
) {
  const purchases = data?.purchases ?? [];
  const lines = selection.lines
    .filter((l) => l.buyQuantity !== 0)
    .map((line) => {
      const fingerprint = shoppingFingerprint(line);
      const decision = data?.routes.find((r) => r.lineId === line.id);
      const bought = purchases
        .filter((p) => p.lineId === line.id && p.unit === line.unit)
        .reduce((sum, p) => sum + p.quantity, 0);
      return {
        ...line,
        fingerprint,
        route: decision?.route ?? ("supermarket" as ShoppingRoute),
        neededOn: decision?.neededOn,
        availableOn: decision?.availableOn,
        sourceChanged: !!decision && decision.fingerprint !== fingerprint,
        late:
          !!decision?.neededOn &&
          !!decision.availableOn &&
          decision.availableOn > decision.neededOn,
        planned: bought === 0,
        boughtQuantity: bought,
        remainingQuantity:
          line.buyQuantity === null
            ? null
            : Math.max(0, line.buyQuantity - bought),
      };
    });
  return {
    id: `shopping_${selection.id}`,
    revision,
    selectionId: selection.id,
    selectionRevision: selection.revision,
    sourceChanged: !!data && data.selectionRevision !== selection.revision,
    lines,
    purchases,
    orphanPurchases: purchases.filter(
      (p) => !lines.some((l) => l.id === p.lineId && l.unit === p.unit),
    ),
  };
}
export function reduceShoppingCycle(
  current: ShoppingCycleData | null,
  command: ShoppingCycleCommand,
  selection: RecipeSelection,
  actorId: string,
  now: string,
): ShoppingCycleData {
  if (command.type === "route_defaults") {
    if (command.observedSelectionRevision !== selection.revision)
      throw new MealConflict(
        "The recipe selection changed. Review the route before setting its arrival date.",
      );
    const data = current ?? {
      selectionId: selection.id,
      selectionRevision: selection.revision,
      routes: [],
      purchases: [],
    };
    const targets = shoppingCycleView(data, selection, 0).lines.filter(
      (line) => line.route === command.route && line.remainingQuantity !== 0,
    );
    const ids = new Set(targets.map((line) => line.id));
    return {
      ...data,
      selectionRevision: selection.revision,
      routes: [
        ...data.routes.filter((route) => !ids.has(route.lineId)),
        ...targets.map((line) => ({
          lineId: line.id,
          route: command.route,
          availableOn: command.availableOn,
          neededOn: command.neededOn ?? line.neededOn,
          fingerprint: line.fingerprint,
          actorId,
          recordedAt: now,
        })),
      ],
    };
  }
  const line = selection.lines.find(
    (l) => l.id === command.lineId && l.buyQuantity !== 0,
  );
  if (!line)
    throw new MealConflict(
      "The shopping requirement disappeared. Keep the purchase observation for reconciliation.",
    );
  const fingerprint = shoppingFingerprint(line);
  const data = current ?? {
    selectionId: selection.id,
    selectionRevision: selection.revision,
    routes: [],
    purchases: [],
  };
  if (command.type === "route")
    return {
      ...data,
      selectionRevision: selection.revision,
      routes: [
        ...data.routes.filter((r) => r.lineId !== line.id),
        { ...command, fingerprint, actorId, recordedAt: now },
      ],
    };
  if (command.observedFingerprint !== fingerprint || command.unit !== line.unit)
    throw new MealConflict(
      "This requirement changed. Reconcile the saved purchase before applying it.",
    );
  return {
    ...data,
    selectionRevision: selection.revision,
    purchases: [
      ...data.purchases,
      {
        lineId: line.id,
        quantity: command.quantity,
        unit: command.unit,
        fingerprint,
        actorId,
        purchasedAt: command.purchasedAt,
        recordedAt: now,
      },
    ],
  };
}
async function requireSelection(prisma: PrismaClient, id: string) {
  const selection = await getSelection(prisma, id);
  if (!selection)
    throw Object.assign(new Error("Selection not found"), { statusCode: 404 });
  return selection;
}
export async function getShoppingCycle(
  prisma: PrismaClient,
  selectionId: string,
) {
  const selection = await requireSelection(prisma, selectionId);
  const doc = await readDocument<ShoppingCycleData>(
    prisma,
    `shopping_${selectionId}`,
    "shopping_cycle",
  );
  return shoppingCycleView(doc?.data ?? null, selection, doc?.revision ?? 0);
}
export async function changeShoppingCycle(
  prisma: PrismaClient,
  selectionId: string,
  actorId: string,
  input: unknown,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw Object.assign(new Error(parsed.error.message), { statusCode: 400 });
  if (parsed.data.expectedActorId !== actorId)
    throw new MealConflict("Saved shopping command belongs to another member.");
  const selection = await requireSelection(prisma, selectionId);
  const now = new Date().toISOString();
  const doc = await mutateDocument<ShoppingCycleData>(prisma, {
    id: `shopping_${selectionId}`,
    kind: "shopping_cycle",
    actorId,
    operationId: parsed.data.operationId,
    expectedRevision: parsed.data.expectedRevision,
    payload: parsed.data.command,
    reduce: (current) =>
      reduceShoppingCycle(
        current,
        parsed.data.command,
        selection,
        actorId,
        now,
      ),
  });
  return shoppingCycleView(doc.data, selection, doc.revision);
}
