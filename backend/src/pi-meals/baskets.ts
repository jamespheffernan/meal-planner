import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname, platform } from "node:os";
import { z } from "zod";
import type {
  BasketManifestLine,
  BasketProposal,
  RecipeSelection,
} from "./contracts.js";
import { canonicalUnit } from "./compiler.js";
import { getSelection } from "./selections.js";
import { shoppingCycleView, type ShoppingCycleData } from "./shopping-cycle.js";
import {
  MealConflict,
  mutateDocument,
  readDocument,
  listDocuments,
  type MealDocument,
  canonical,
} from "./store.js";
import {
  asideAvailability,
  basketHandoff,
  launchAsideAttempt,
  stopAndInspectAsideSession,
  inspectAsideSession,
} from "./aside.js";

type BasketData = Omit<BasketProposal, "id" | "revision"> & {
  shoppingCycleRevision?: number;
};
export interface CartObservation {
  verified: true;
  items: Array<{ productId: string; quantity: number }>;
  evidence: unknown;
}
export interface BasketExecutor {
  /** A complete verified observation. Extraction failure must throw, never return an empty cart. */
  readCart(): Promise<CartObservation>;
  /** Exactly one attempt. No internal retries after an uncertain write. */
  addPacks(
    productId: string,
    packs: number,
    beforeWrite?: () => Promise<void>,
  ): Promise<void>;
}
export interface BasketDependencies {
  executor?: BasketExecutor;
  mutationsEnabled?: boolean;
  /** Internal test seam. HTTP callers cannot supply an owner probe. */
  ownerState?: (owner: ExecutionOwner) => "dead" | "live" | "unknown";
}
const text = z.string().trim().min(1);
const revision = z.number().int().nonnegative();
export const createBasketSchema = z
  .object({
    operationId: text,
    selectionId: text,
    executor: z.enum(["aside", "ocado"]).optional(),
  })
  .strict();
const manifestLine = z
  .object({
    id: text,
    name: text,
    quantity: z.number().finite().positive(),
    unit: text,
    productId: text.optional(),
    productName: text.optional(),
    packQuantity: z.number().finite().positive().optional(),
    packUnit: text.optional(),
    packs: z.number().int().positive().optional(),
    price: z.number().finite().nonnegative().optional(),
    baselineQuantity: z.number().int().nonnegative().optional(),
  })
  .strict();
export const prepareBasketSchema = z
  .object({
    operationId: text,
    expectedRevision: revision,
    lines: z.array(manifestLine),
  })
  .strict();
export const fillBasketSchema = z
  .object({
    operationId: text,
    expectedRevision: revision,
    selectionRevision: revision,
  })
  .strict();
export const reconcileBasketSchema = z
  .object({ operationId: text, expectedRevision: revision })
  .strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw Object.assign(new Error(result.error.message), { statusCode: 400 });
  return result.data;
}
function view(
  doc: MealDocument<BasketData>,
): BasketProposal & { shoppingCycleRevision?: number } {
  return { id: doc.id, revision: doc.revision, ...doc.data };
}
function required(current: BasketData | null): BasketData {
  if (!current)
    throw Object.assign(new Error("Basket not found."), { statusCode: 404 });
  return current;
}
export async function getBasket(prisma: PrismaClient, id: string) {
  const doc = await readDocument<BasketData>(prisma, id, "basket");
  return doc ? view(doc) : null;
}
export async function listBaskets(prisma: PrismaClient, selectionId?: string) {
  return (await listDocuments<BasketData>(prisma, "basket"))
    .filter(
      (document) => !selectionId || document.data.selectionId === selectionId,
    )
    .map(view);
}
async function supermarketSelection(
  prisma: PrismaClient,
  selection: RecipeSelection,
  boundRevision?: number,
) {
  const document = await readDocument<ShoppingCycleData>(
    prisma,
    `shopping_${selection.id}`,
    "shopping_cycle",
  );
  const cycle = shoppingCycleView(
    document?.data ?? null,
    selection,
    document?.revision ?? 0,
  );
  if (boundRevision !== undefined && cycle.revision !== boundRevision)
    throw new MealConflict(
      "Shopping routes or purchases changed. Create and review a new supermarket basket.",
    );
  if (cycle.lines.some((line) => line.sourceChanged))
    throw new MealConflict(
      "A shopping route refers to changed ingredients. Review those routes before preparing the supermarket basket.",
    );
  return {
    selection: {
      ...selection,
      lines: cycle.lines
        .filter((line) => line.route === "supermarket")
        .map((line) => ({ ...line, buyQuantity: line.remainingQuantity })),
    },
    revision: cycle.revision,
  };
}
function selectionLines(selection: RecipeSelection): BasketManifestLine[] {
  return selection.lines
    .filter((l) => l.buyQuantity === null || l.buyQuantity > 0)
    .map((l) => ({
      id: l.id,
      name: l.name,
      quantity: l.buyQuantity ?? 0,
      unit: l.unit,
    }));
}
export function reviewManifest(
  selection: RecipeSelection,
  lines: BasketManifestLine[],
): BasketManifestLine[] {
  const expected = selectionLines(selection);
  if (!expected.length || expected.some((l) => l.quantity <= 0))
    throw Object.assign(
      new Error(
        "Resolve ingredient quantities before preparing a non-empty basket.",
      ),
      { statusCode: 400 },
    );
  if (
    lines.length !== expected.length ||
    new Set(lines.map((l) => l.id)).size !== lines.length
  )
    throw Object.assign(
      new Error("Manifest must cover every shopping line exactly once."),
      { statusCode: 400 },
    );
  const products = new Set<string>();
  return expected.map((source) => {
    const line = lines.find((l) => l.id === source.id);
    if (
      !line ||
      line.quantity !== source.quantity ||
      line.unit !== source.unit ||
      !line.productId ||
      !line.productName ||
      !line.packQuantity ||
      !line.packUnit
    )
      throw Object.assign(
        new Error(
          "Each shopping line needs reviewed product and pack details matching the selection.",
        ),
        { statusCode: 400 },
      );
    if (products.has(line.productId))
      throw Object.assign(
        new Error(
          "Combine shopping lines that use the same product before review.",
        ),
        { statusCode: 400 },
      );
    products.add(line.productId);
    const buy = canonicalUnit(source.unit),
      pack = canonicalUnit(line.packUnit);
    if (buy.unit !== pack.unit)
      throw Object.assign(
        new Error("Product pack unit does not match ingredient unit."),
        { statusCode: 400 },
      );
    const packs = Math.ceil(
      (source.quantity * buy.factor) / (line.packQuantity * pack.factor),
    );
    if (
      !Number.isSafeInteger(packs) ||
      packs < 1 ||
      (line.packs !== undefined && line.packs !== packs)
    )
      throw Object.assign(
        new Error("Reviewed pack count does not cover the shopping quantity."),
        { statusCode: 400 },
      );
    const { baselineQuantity: _, ...clean } = line;
    return { ...clean, name: source.name, packs };
  });
}
export async function createBasket(
  prisma: PrismaClient,
  actorId: string,
  input: {
    operationId: string;
    selectionId: string;
    executor?: "aside" | "ocado";
  },
) {
  const parsed = parse(createBasketSchema, input),
    selection = await getSelection(prisma, parsed.selectionId);
  if (!selection)
    throw Object.assign(new Error("Recipe selection not found."), {
      statusCode: 404,
    });
  const shopping = await supermarketSelection(prisma, selection);
  const id = `basket_${createHash("sha256")
    .update(JSON.stringify([actorId, parsed.operationId]))
    .digest("hex")
    .slice(0, 24)}`;
  return view(
    await mutateDocument<BasketData>(prisma, {
      id,
      kind: "basket",
      actorId,
      operationId: parsed.operationId,
      expectedRevision: 0,
      payload: parsed,
      reduce: () => ({
        selectionId: selection.id,
        selectionRevision: selection.revision,
        shoppingCycleRevision: shopping.revision,
        executor: parsed.executor ?? "aside",
        status: "draft",
        lines: selectionLines(shopping.selection),
        unresolved: [
          (parsed.executor ?? "aside") === "aside"
            ? "Shop with Aside to choose suitable products and pack sizes. Aside will ask about any unknown ingredient amounts."
            : "Choose products and review pack sizes and quantities before filling.",
        ],
      }),
    }),
  );
}
export async function prepareBasket(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: {
    operationId: string;
    expectedRevision: number;
    lines: BasketManifestLine[];
  },
) {
  const parsed = parse(prepareBasketSchema, input);
  if (
    await prisma.piMealOperation.findUnique({
      where: { id: parsed.operationId },
    })
  )
    return view(
      await mutateDocument<BasketData>(prisma, {
        id,
        kind: "basket",
        actorId,
        operationId: parsed.operationId,
        expectedRevision: parsed.expectedRevision,
        payload: parsed,
        reduce: () => {
          throw new Error("Missing operation receipt");
        },
      }),
    );
  const basket = await getBasket(prisma, id);
  if (!basket)
    throw Object.assign(new Error("Basket not found."), { statusCode: 404 });
  const selection = await getSelection(prisma, basket.selectionId);
  if (!selection || selection.revision !== basket.selectionRevision)
    throw new MealConflict(
      "The recipe selection changed. Create a new basket.",
    );
  const shopping = await supermarketSelection(
    prisma,
    selection,
    basket.shoppingCycleRevision ?? 0,
  );
  const lines = reviewManifest(shopping.selection, parsed.lines);
  return view(
    await mutateDocument<BasketData>(prisma, {
      id,
      kind: "basket",
      actorId,
      operationId: parsed.operationId,
      expectedRevision: parsed.expectedRevision,
      payload: parsed,
      reduce: (current) => {
        const data = required(current);
        if (data.status === "running" || data.receipt)
          throw new MealConflict(
            "An execution already exists. Reconcile it before creating another basket.",
          );
        return { ...data, lines, status: "ready", unresolved: [] };
      },
    }),
  );
}
function observation(input: CartObservation): CartObservation {
  if (
    input?.verified !== true ||
    !Array.isArray(input.items) ||
    input.evidence === undefined ||
    input.evidence === null ||
    new Set(input.items.map((i) => i.productId)).size !== input.items.length ||
    input.items.some(
      (i) =>
        !i.productId || !Number.isSafeInteger(i.quantity) || i.quantity < 0,
    )
  )
    throw new Error(
      "Cart read failed: complete structured evidence is required.",
    );
  return input;
}
export function verifyReadback(
  baseline: CartObservation,
  after: CartObservation,
  lines: BasketManifestLine[],
): string[] {
  observation(baseline);
  observation(after);
  const targets = new Map(baseline.items.map((i) => [i.productId, i.quantity]));
  for (const line of lines)
    targets.set(
      line.productId!,
      (targets.get(line.productId!) ?? 0) + line.packs!,
    );
  const actual = new Map(after.items.map((i) => [i.productId, i.quantity])),
    issues: string[] = [];
  for (const [id, quantity] of targets)
    if ((actual.get(id) ?? 0) !== quantity)
      issues.push(
        `Product ${id}: expected ${quantity}, observed ${actual.get(id) ?? 0}.`,
      );
  for (const [id, quantity] of actual)
    if (!targets.has(id) && quantity > 0)
      issues.push(`Unexpected product ${id} appeared in the trolley.`);
  return issues;
}
export interface ExecutionOwner {
  host: string;
  hostIdentity?: string;
  processId: number;
  processStart?: string;
}
interface ExecutionReceipt {
  effect?: string;
  operationId?: string;
  owner?: ExecutionOwner;
  manifest?: BasketManifestLine[];
  baseline?: CartObservation;
  after?: CartObservation;
  executionFinished?: boolean;
  uncertain?: boolean;
  remoteTerminationUnknown?: boolean;
  noWritesAttempted?: boolean;
  sessionId?: string;
  verification?: "user";
  reviewToken?: string;
  reviewRevision?: number;
  sessionStopped?: { sessionId: string; status: string; observedAt: string };
}
interface AccountGuard {
  basketId: string;
  operationId: string;
  executor: "ocado" | "aside";
  owner: ExecutionOwner;
  held: boolean;
}
// The application has one encrypted provider session shared by both household actors.
// Account replacement does not silently clear an uncertain attempt on that session.
const accountGuardId = "pi-meals-cart-guard:ocado:configured-account";
function hostIdentity(): string | undefined {
  try {
    const identity =
      platform() === "darwin"
        ? execFileSync(
            "/usr/sbin/ioreg",
            ["-rd1", "-c", "IOPlatformExpertDevice"],
            { encoding: "utf8", timeout: 2000 },
          ).match(/"IOPlatformUUID"\s*=\s*"([^"\n]+)"/)?.[1]
        : readFileSync("/etc/machine-id", "utf8").trim();
    return identity
      ? createHash("sha256").update(identity).digest("hex")
      : undefined;
  } catch {
    return undefined;
  }
}
function processStart(processId: number): string | undefined {
  try {
    return (
      execFileSync("/bin/ps", ["-p", String(processId), "-o", "lstart="], {
        encoding: "utf8",
        timeout: 2000,
        env: { ...process.env, LC_ALL: "C" },
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}
export function executionOwner(): ExecutionOwner {
  return {
    host: hostname(),
    hostIdentity: hostIdentity(),
    processId: process.pid,
    processStart: processStart(process.pid),
  };
}
export function executionOwnerState(
  owner: ExecutionOwner,
): "dead" | "live" | "unknown" {
  const identity = hostIdentity();
  if (
    !owner ||
    owner.host !== hostname() ||
    !owner.hostIdentity ||
    !identity ||
    owner.hostIdentity !== identity ||
    !Number.isSafeInteger(owner.processId) ||
    owner.processId < 1
  )
    return "unknown";
  try {
    process.kill(owner.processId, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "dead"
      : "unknown";
  }
  const started = processStart(owner.processId);
  if (!started || !owner.processStart) return "unknown";
  return started === owner.processStart ? "live" : "dead";
}
/** Reuse the document/receipt reducer inside the enclosing account-guard transaction. */
function transactionStore(tx: Prisma.TransactionClient): PrismaClient {
  return {
    piMealDocument: tx.piMealDocument,
    piMealOperation: tx.piMealOperation,
    $transaction: async (
      run: (client: Prisma.TransactionClient) => Promise<unknown>,
    ) => run(tx),
  } as unknown as PrismaClient;
}
async function claimExecution(
  prisma: PrismaClient,
  command: Parameters<typeof mutateDocument<BasketData>>[1],
  executor: "ocado" | "aside",
  owner: ExecutionOwner,
): Promise<{ document: MealDocument<BasketData>; claimed: boolean }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const client = transactionStore(tx);
        // A concurrent duplicate request may have committed since the initial lookup.
        if (
          await tx.piMealOperation.findUnique({
            where: { id: command.operationId },
          })
        )
          return {
            document: await mutateDocument(client, command),
            claimed: false,
          };
        const current = await tx.piMealDocument.findUnique({
          where: { id: accountGuardId },
        });
        if (
          current &&
          (current.kind !== "cart-execution-guard" ||
            (current.data as unknown as AccountGuard).held)
        )
          throw new MealConflict(
            "Another Ocado basket attempt is active or uncertain. Inspect and reconcile that attempt before starting another executor.",
          );
        const existing = await tx.piMealDocument.findMany({
          where: { kind: "basket" },
        });
        for (const row of existing) {
          if (row.id === command.id) continue;
          const basket = row.data as unknown as BasketData;
          const receipt = basket.receipt as ExecutionReceipt | undefined;
          if (
            basket.status === "running" ||
            receipt?.uncertain === true ||
            receipt?.remoteTerminationUnknown === true
          )
            throw new MealConflict(
              `Ocado basket ${row.id} has an active or uncertain attempt. Reconcile it before starting another executor.`,
            );
        }
        const data: AccountGuard = {
          basketId: command.id,
          operationId: command.operationId,
          executor,
          owner,
          held: true,
        };
        const update = {
          kind: "cart-execution-guard",
          revision: (current?.revision ?? 0) + 1,
          data: data as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        };
        if (current) {
          const result = await tx.piMealDocument.updateMany({
            where: { id: accountGuardId, revision: current.revision },
            data: update,
          });
          if (result.count !== 1)
            throw new MealConflict(
              "Another basket claimed this Ocado account.",
            );
        } else
          await tx.piMealDocument.create({
            data: { id: accountGuardId, ...update },
          });
        return {
          document: await mutateDocument(client, command),
          claimed: true,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    )
      throw new MealConflict(
        "Another basket claimed this Ocado account. Do not replay an uncertain attempt.",
      );
    throw error;
  }
}
async function assertExecutionGuard(
  prisma: PrismaClient,
  id: string,
  operationId: string,
) {
  const guard = await readDocument<AccountGuard>(
    prisma,
    accountGuardId,
    "cart-execution-guard",
  );
  if (
    !guard?.data.held ||
    guard.data.basketId !== id ||
    guard.data.operationId !== operationId
  )
    throw new MealConflict(
      "This execution no longer owns the Ocado account. Stop without retrying.",
    );
}
async function releaseExecutionGuard(
  prisma: PrismaClient,
  id: string,
  operationId: string,
) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.piMealDocument.findUnique({
      where: { id: accountGuardId },
    });
    const guard = current?.data as unknown as AccountGuard | undefined;
    if (
      !current ||
      current.kind !== "cart-execution-guard" ||
      !guard?.held ||
      guard.basketId !== id ||
      guard.operationId !== operationId
    )
      return;
    const changed = await tx.piMealDocument.updateMany({
      where: { id: accountGuardId, revision: current.revision },
      data: {
        revision: current.revision + 1,
        data: { ...guard, held: false } as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    if (changed.count !== 1)
      throw new MealConflict("Cart ownership changed during reconciliation.");
  });
}
function ownerAllowsReconciliation(
  basket: BasketProposal,
  deps: BasketDependencies,
): boolean {
  if (basket.status !== "running") return true;
  const receipt = basket.receipt as ExecutionReceipt | undefined;
  return (
    !!receipt?.owner &&
    (deps.ownerState ?? executionOwnerState)(receipt.owner) === "dead"
  );
}
export function assertBasketReconciliationAllowed(
  basket: BasketProposal,
  deps: BasketDependencies = {},
) {
  if (
    basket.executor === "aside" &&
    (basket.receipt as ExecutionReceipt | undefined)?.effect ===
      "aside_stopped_for_review"
  )
    throw new MealConflict(
      "Aside is stopped. Review the actual trolley, then use the post-stop confirmation to finish this shop.",
    );
  if (
    basket.executor === "aside" &&
    basket.status === "complete" &&
    (basket.receipt as ExecutionReceipt | undefined)?.verification === "user"
  )
    throw new MealConflict(
      "This Aside shop was finished after your trolley review. Its receipt is user verification; open Ocado to inspect the trolley again.",
    );
  if (!basket.receipt)
    throw new MealConflict(
      "This basket has not been filled. Choose and save products before filling; checking the cart does not prepare a basket.",
    );
  if (!ownerAllowsReconciliation(basket, deps))
    throw new MealConflict(
      "The recorded execution owner is still live or cannot be proven dead on this host. Stop it and confirm its owner is dead before a read-only reconciliation; do not launch another executor.",
    );
}
export async function fillBasket(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: {
    operationId: string;
    expectedRevision: number;
    selectionRevision: number;
  },
  deps: BasketDependencies = {},
) {
  const parsed = parse(fillBasketSchema, input);
  const prior = await prisma.piMealOperation.findUnique({
    where: { id: parsed.operationId },
  });
  // Replay goes through store hashing, so a reused ID cannot change its request.
  if (prior) {
    const replay = await mutateDocument<BasketData>(prisma, {
      id,
      kind: "basket",
      actorId,
      operationId: parsed.operationId,
      expectedRevision: parsed.expectedRevision,
      payload: parsed,
      reduce: () => {
        throw new Error("Missing operation receipt");
      },
    });
    return view(replay);
  }
  const basket = await getBasket(prisma, id);
  if (!basket)
    throw Object.assign(new Error("Basket not found."), { statusCode: 404 });
  const selection = await getSelection(prisma, basket.selectionId);
  if (
    !selection ||
    selection.revision !== basket.selectionRevision ||
    parsed.selectionRevision !== selection.revision
  )
    throw new MealConflict(
      "The recipe selection changed. Review a new basket before filling.",
    );
  const shopping = await supermarketSelection(
    prisma,
    selection,
    basket.shoppingCycleRevision ?? 0,
  );
  const manifest = reviewManifest(shopping.selection, basket.lines);
  const enabled =
    deps.mutationsEnabled ??
    process.env.PI_MEALS_CART_MUTATIONS_ENABLED === "true";
  const supported = basket.executor === "ocado" && enabled && !!deps.executor;
  const owner = executionOwner();
  const execution = { operationId: parsed.operationId, owner, manifest };
  const command: Parameters<typeof mutateDocument<BasketData>>[1] = {
    id,
    kind: "basket",
    actorId,
    operationId: parsed.operationId,
    expectedRevision: parsed.expectedRevision,
    payload: parsed,
    reduce: (current) => {
      const data = required(current);
      if (data.status !== "ready" || data.receipt)
        throw new MealConflict(
          "Basket execution already started or is not reviewed.",
        );
      return {
        ...data,
        lines: manifest,
        status: supported ? "running" : "needs_review",
        taskId: `basket-task:${id}:${parsed.operationId}`,
        unresolved: supported
          ? []
          : [
              basket.executor === "aside"
                ? asideAvailability
                : "Automatic cart mutations are disabled or no verified Ocado adapter is configured.",
            ],
        receipt: {
          ...execution,
          effect: "fill_requested",
          uncertain: supported,
          checkout: false,
        },
      };
    },
  };
  const claim = supported
    ? await claimExecution(prisma, command, "ocado", owner)
    : { document: await mutateDocument(prisma, command), claimed: false };
  const started = claim.document;
  if (!supported || !claim.claimed) return view(started);
  let current = started,
    baseline: CartObservation | undefined,
    after: CartObservation | undefined,
    intent: unknown;
  const save = async (data: BasketData, label: string) => {
    current = await mutateDocument<BasketData>(prisma, {
      id,
      kind: "basket",
      actorId,
      operationId: `${parsed.operationId}:${label}`,
      expectedRevision: current.revision,
      payload: data,
      reduce: () => data,
    });
  };
  try {
    baseline = observation(await deps.executor!.readCart());
    await save(
      {
        ...current.data,
        receipt: {
          ...execution,
          effect: "baseline_read",
          baseline,
          uncertain: false,
          checkout: false,
        },
      },
      "baseline",
    );
    for (let index = 0; index < manifest.length; index++) {
      const line = manifest[index];
      intent = {
        productId: line.productId,
        packs: line.packs,
        targetQuantity:
          (baseline.items.find((i) => i.productId === line.productId)
            ?.quantity ?? 0) + line.packs!,
      };
      await save(
        {
          ...current.data,
          receipt: {
            ...execution,
            effect: "write_intent",
            baseline,
            intent,
            uncertain: true,
            checkout: false,
          },
        },
        `intent-${index}`,
      );
      const assertReviewedWrite = async () => {
        const liveSelection = await getSelection(prisma, basket.selectionId);
        if (
          !liveSelection ||
          liveSelection.revision !== basket.selectionRevision
        )
          throw new MealConflict(
            "The selection changed during execution. Stop and review the trolley.",
          );
        const liveShopping = await supermarketSelection(
          prisma,
          liveSelection,
          basket.shoppingCycleRevision ?? 0,
        );
        reviewManifest(liveShopping.selection, manifest);
        const liveBasket = await getBasket(prisma, id);
        if (
          !liveBasket ||
          liveBasket.revision !== current.revision ||
          canonical(liveBasket.lines) !== canonical(manifest)
        )
          throw new MealConflict(
            "The reviewed basket changed during execution. Stop without retrying.",
          );
        await assertExecutionGuard(prisma, id, parsed.operationId);
      };
      await assertReviewedWrite();
      await deps.executor!.addPacks(
        line.productId!,
        line.packs!,
        assertReviewedWrite,
      );
    }
    after = observation(await deps.executor!.readCart());
    const unresolved = verifyReadback(baseline, after, manifest);
    await save(
      {
        ...current.data,
        status: unresolved.length ? "needs_review" : "complete",
        unresolved,
        receipt: {
          ...execution,
          executionFinished: true,
          effect: "readback",
          baseline,
          after,
          uncertain: unresolved.length > 0,
          checkout: false,
        },
      },
      "result",
    );
  } catch (error) {
    await save(
      {
        ...current.data,
        status: "needs_review",
        unresolved: [
          error instanceof Error ? error.message : "Cart execution failed.",
        ],
        receipt: {
          ...execution,
          executionFinished: true,
          effect: intent ? "write_uncertain" : "read_failed",
          ...(baseline ? { baseline } : {}),
          ...(intent ? { intent } : {}),
          ...(after ? { after } : {}),
          uncertain: !!intent,
          checkout: false,
        },
      },
      "failure",
    );
  }
  if (current.data.status === "complete" || !intent)
    await releaseExecutionGuard(prisma, id, parsed.operationId);
  // Seal the original operation receipt with the final observed result. Duplicate calls
  // during execution return running; they never execute effects again.
  await prisma.piMealOperation.update({
    where: { id: parsed.operationId },
    data: { result: JSON.parse(JSON.stringify(current)) },
  });
  return view(current);
}
export async function reconcileBasket(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: { operationId: string; expectedRevision: number },
  deps: BasketDependencies = {},
) {
  const parsed = parse(reconcileBasketSchema, input);
  if (
    await prisma.piMealOperation.findUnique({
      where: { id: parsed.operationId },
    })
  )
    return view(
      await mutateDocument<BasketData>(prisma, {
        id,
        kind: "basket",
        actorId,
        operationId: parsed.operationId,
        expectedRevision: parsed.expectedRevision,
        payload: parsed,
        reduce: () => {
          throw new Error("Missing operation receipt");
        },
      }),
    );
  const basket = await getBasket(prisma, id);
  if (!basket)
    throw Object.assign(new Error("Basket not found."), { statusCode: 404 });
  assertBasketReconciliationAllowed(basket, deps);
  const receipt = basket.receipt as ExecutionReceipt;
  const manifest = receipt.manifest ?? basket.lines;
  let after: CartObservation | undefined;
  let unresolved = [
    "No verified baseline is available. Do not replay the fill; inspect the exact handoff.",
  ];
  if (basket.executor === "ocado" && deps.executor && receipt.baseline) {
    try {
      after = observation(await deps.executor.readCart());
      unresolved = verifyReadback(receipt.baseline, after, manifest);
    } catch (error) {
      unresolved = [
        error instanceof Error ? error.message : "Cart read failed.",
      ];
    }
  }
  if (basket.executor === "aside")
    unresolved = [
      "Aside remote task termination and its structured baseline/readback are unverified. Inspect the existing task in Aside; the account remains reserved, even if its local process has stopped.",
    ];
  const complete =
    !!after && unresolved.length === 0 && basket.executor === "ocado";
  const noWrites =
    basket.executor === "ocado" &&
    !!receipt.operationId &&
    (receipt.noWritesAttempted === true ||
      (["fill_requested", "baseline_read", "read_failed"].includes(
        receipt.effect ?? "",
      ) &&
        (receipt.executionFinished === true ||
          (!!receipt.owner &&
            (deps.ownerState ?? executionOwnerState)(receipt.owner) ===
              "dead"))));
  if (noWrites && !complete)
    unresolved = [
      "The local execution ended before any cart write intent was recorded. No cart additions were attempted. Create a new basket to continue.",
    ];
  const result = await mutateDocument<BasketData>(prisma, {
    id,
    kind: "basket",
    actorId,
    operationId: parsed.operationId,
    expectedRevision: parsed.expectedRevision,
    payload: parsed,
    reduce: (current) => {
      const data = required(current);
      if (
        !ownerAllowsReconciliation(
          view({
            id,
            kind: "basket",
            revision: parsed.expectedRevision,
            data,
            updatedAt: "",
          }),
          deps,
        )
      )
        throw new MealConflict(
          "Execution may still be live. Do not reconcile or launch another executor.",
        );
      return {
        ...data,
        status: complete ? "complete" : "needs_review",
        unresolved,
        receipt: {
          ...((data.receipt as object) ?? {}),
          ...(after ? { after } : {}),
          effect: "reconciled_read_only",
          executionFinished: basket.executor === "ocado",
          ...(noWrites ? { noWritesAttempted: true } : {}),
          uncertain: !complete && !noWrites,
          checkout: false,
        },
      };
    },
  });
  if ((complete || noWrites) && receipt.operationId)
    await releaseExecutionGuard(prisma, id, receipt.operationId);
  return view(result);
}
export { basketHandoff };

export async function openAsideBasket(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: { operationId: string; expectedRevision: number },
) {
  const parsed = parse(reconcileBasketSchema, input);
  if (
    await prisma.piMealOperation.findUnique({
      where: { id: parsed.operationId },
    })
  )
    return view(
      await mutateDocument<BasketData>(prisma, {
        id,
        kind: "basket",
        actorId,
        operationId: parsed.operationId,
        expectedRevision: parsed.expectedRevision,
        payload: parsed,
        reduce: () => {
          throw new Error("Missing operation receipt");
        },
      }),
    );
  if (process.env.PI_MEALS_ASIDE_LAUNCH_ENABLED !== "true")
    throw Object.assign(
      new Error(
        "Shopping with Aside is unavailable because agent launch is disabled on this server.",
      ),
      { statusCode: 503 },
    );
  const basket = await getBasket(prisma, id);
  if (!basket)
    throw Object.assign(new Error("Basket not found."), { statusCode: 404 });
  if (
    basket.receipt ||
    basket.status === "running" ||
    basket.status === "complete"
  )
    throw new MealConflict(
      "An execution already exists. Inspect it in Aside and reconcile the trolley; do not launch again.",
    );
  const selection = await getSelection(prisma, basket.selectionId);
  if (!selection || selection.revision !== basket.selectionRevision)
    throw new MealConflict("The selection changed. Create a new basket.");
  const shopping = await supermarketSelection(
    prisma,
    selection,
    basket.shoppingCycleRevision ?? 0,
  );
  const expected = selectionLines(shopping.selection);
  if (
    canonical(
      basket.lines.map((line) => ({
        id: line.id,
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
      })),
    ) !== canonical(expected)
  )
    throw new MealConflict(
      "The supermarket requirement changed. Create a new basket before opening Aside.",
    );
  if (
    !basket.lines.length ||
    basket.lines.some(
      (line) => !Number.isFinite(line.quantity) || line.quantity < 0,
    )
  )
    throw Object.assign(
      new Error(
        "Add ingredients and resolve invalid quantities before opening Aside.",
      ),
      { statusCode: 400 },
    );
  const taskId = `aside-attempt:${id}:${parsed.operationId}`,
    handoff = basketHandoff(basket);
  const unresolved = [
    "Aside is an attended handoff. The local process ID does not prove the remote task is running or stopped. Review the actual trolley; do not retry this launch or start another executor. Checkout remains manual.",
  ];
  const owner = executionOwner();
  const command: Parameters<typeof mutateDocument<BasketData>>[1] = {
    id,
    kind: "basket",
    actorId,
    operationId: parsed.operationId,
    expectedRevision: parsed.expectedRevision,
    payload: parsed,
    reduce: (current) => {
      const data = required(current);
      if (
        data.receipt ||
        data.status === "running" ||
        data.status === "complete"
      )
        throw new MealConflict(
          "An execution already exists. Inspect it in Aside and reconcile the trolley; do not launch again.",
        );
      return {
        ...data,
        executor: "aside",
        status: "needs_review",
        unresolved,
        receipt: {
          owner,
          operationId: parsed.operationId,
          manifest: basket.lines,
          remoteTerminationUnknown: true,
          effect: "aside_launch_intent",
          attemptId: taskId,
          handoff,
          uncertain: true,
          checkout: false,
        },
      };
    },
  };
  const claimed = await claimExecution(prisma, command, "aside", owner);
  const intent = claimed.document;
  if (!claimed.claimed) return view(intent);
  let receipt: unknown;
  try {
    const liveSelection = await getSelection(prisma, basket.selectionId);
    if (!liveSelection || liveSelection.revision !== basket.selectionRevision)
      throw new MealConflict(
        "The selection changed before Aside launch. Do not retry this attempt.",
      );
    await supermarketSelection(
      prisma,
      liveSelection,
      basket.shoppingCycleRevision ?? 0,
    );
    await assertExecutionGuard(prisma, id, parsed.operationId);
    const process = await launchAsideAttempt(handoff, parsed.operationId);
    receipt = {
      owner,
      operationId: parsed.operationId,
      manifest: basket.lines,
      remoteTerminationUnknown: true,
      effect:
        process.processState === "failed"
          ? "aside_launch_failed"
          : "aside_process_spawned",
      attemptId: taskId,
      ...process,
      handoff,
      localProcessLimitMinutes: 10,
      outputLimitBytes: 65536,
      uncertain: true,
      checkout: false,
    };
  } catch (error) {
    receipt = {
      owner,
      operationId: parsed.operationId,
      manifest: basket.lines,
      remoteTerminationUnknown: true,
      effect: "aside_launch_unresolved",
      attemptId: taskId,
      handoff,
      error: error instanceof Error ? error.message : "Aside launch failed",
      uncertain: true,
      checkout: false,
    };
  }
  const result = await mutateDocument<BasketData>(prisma, {
    id,
    kind: "basket",
    actorId,
    operationId: `${parsed.operationId}:spawn-receipt`,
    expectedRevision: intent.revision,
    payload: receipt,
    reduce: (current) => {
      const sessionId = (receipt as { sessionId?: string }).sessionId;
      const data = required(current);
      const launchError = (receipt as { error?: string }).error;
      return {
        ...data,
        receipt,
        ...(sessionId ? { taskId: sessionId } : {}),
        unresolved: launchError
          ? [
              `Aside could not start shopping: ${launchError}. Keep this attempt reserved until its session and trolley are checked.`,
            ]
          : sessionId
            ? [
                `Aside session ${sessionId} is recorded. Stop that session here, review the stopped trolley, then confirm it to finish shopping. Checkout stays manual.`,
              ]
            : [
                "Aside session identity was not captured. Do not launch again; inspect the existing task in Aside. The account stays reserved until its identity and stop state can be verified.",
              ],
      };
    },
  });
  await prisma.piMealOperation.update({
    where: { id: parsed.operationId },
    data: { result: JSON.parse(JSON.stringify(result)) },
  });
  return view(result);
}

export async function stopAsideBasket(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: { operationId: string; expectedRevision: number },
) {
  const parsed = parse(reconcileBasketSchema, input);
  if (
    await prisma.piMealOperation.findUnique({
      where: { id: parsed.operationId },
    })
  )
    return view(
      await mutateDocument<BasketData>(prisma, {
        id,
        kind: "basket",
        actorId,
        operationId: parsed.operationId,
        expectedRevision: parsed.expectedRevision,
        payload: parsed,
        reduce: () => {
          throw new Error("Missing operation receipt");
        },
      }),
    );
  const basket = await getBasket(prisma, id);
  if (!basket)
    throw Object.assign(new Error("Basket not found."), { statusCode: 404 });
  const receipt = basket.receipt as ExecutionReceipt | undefined;
  if (
    basket.executor !== "aside" ||
    !receipt?.sessionId ||
    !receipt.operationId
  )
    throw new MealConflict(
      "No captured Aside session belongs to this basket. Inspect the existing task; the account cannot be released from a local process ID or copied text.",
    );
  if (basket.status === "complete")
    throw new MealConflict("This shopping task is already finished.");
  await assertExecutionGuard(prisma, id, receipt.operationId);
  const stopping = await mutateDocument<BasketData>(prisma, {
    id,
    kind: "basket",
    actorId,
    operationId: parsed.operationId,
    expectedRevision: parsed.expectedRevision,
    payload: parsed,
    reduce: (current) => {
      const data = required(current),
        currentReceipt = data.receipt as ExecutionReceipt | undefined;
      if (
        !currentReceipt ||
        currentReceipt.sessionId !== receipt.sessionId ||
        currentReceipt.operationId !== receipt.operationId ||
        data.executor !== "aside" ||
        data.status === "complete"
      )
        throw new MealConflict(
          "The recorded task changed. Reload before stopping it.",
        );
      const nextReceipt = { ...((data.receipt as object) ?? {}) } as Record<
        string,
        unknown
      >;
      delete nextReceipt.reviewToken;
      delete nextReceipt.reviewRevision;
      delete nextReceipt.sessionStopped;
      return {
        ...data,
        status: "needs_review",
        unresolved: [
          "Stopping the recorded Aside task. Review the actual trolley after its matching session is confirmed idle.",
        ],
        receipt: {
          ...nextReceipt,
          effect: "aside_stop_requested",
          stopOperationId: parsed.operationId,
          uncertain: true,
          remoteTerminationUnknown: true,
          checkout: false,
        },
      };
    },
  });
  let stopped: Awaited<ReturnType<typeof stopAndInspectAsideSession>>;
  try {
    stopped = await stopAndInspectAsideSession(receipt.sessionId);
  } catch (error) {
    const failure = await mutateDocument<BasketData>(prisma, {
      id,
      kind: "basket",
      actorId,
      operationId: `${parsed.operationId}:stop-unresolved`,
      expectedRevision: stopping.revision,
      payload: {
        error:
          error instanceof Error
            ? error.message
            : "Aside stop could not be verified",
      },
      reduce: (current) => ({
        ...required(current),
        status: "needs_review",
        unresolved: [
          error instanceof Error
            ? error.message
            : "Aside stop could not be verified",
        ],
        receipt: {
          ...((required(current).receipt as object) ?? {}),
          effect: "aside_stop_unresolved",
          uncertain: true,
          remoteTerminationUnknown: true,
          checkout: false,
        },
      }),
    });
    await prisma.piMealOperation.update({
      where: { id: parsed.operationId },
      data: { result: JSON.parse(JSON.stringify(failure)) },
    });
    return view(failure);
  }
  const reviewToken = randomUUID();
  const result = await mutateDocument<BasketData>(prisma, {
    id,
    kind: "basket",
    actorId,
    operationId: `${parsed.operationId}:stopped-for-review`,
    expectedRevision: stopping.revision,
    payload: { stopped, reviewToken },
    reduce: (current) => {
      const data = required(current),
        currentReceipt = data.receipt as ExecutionReceipt | undefined;
      if (
        !currentReceipt ||
        currentReceipt.sessionId !== stopped.sessionId ||
        currentReceipt.operationId !== receipt.operationId
      )
        throw new MealConflict(
          "The session receipt changed. Keep the account reserved and inspect this task.",
        );
      return {
        ...data,
        status: "needs_review",
        unresolved: [
          "The recorded Aside task is stopped and idle. Now inspect the actual Ocado trolley, including existing manual items, then confirm your review to finish shopping.",
        ],
        receipt: {
          ...((data.receipt as object) ?? {}),
          effect: "aside_stopped_for_review",
          sessionStopped: stopped,
          reviewToken,
          reviewRevision: stopping.revision + 1,
          remoteTerminationUnknown: false,
          executionFinished: true,
          uncertain: true,
          checkout: false,
        },
      };
    },
  });
  await prisma.piMealOperation.update({
    where: { id: parsed.operationId },
    data: { result: JSON.parse(JSON.stringify(result)) },
  });
  return view(result);
}
const finishAsideSchema = reconcileBasketSchema
  .extend({
    confirmedTrolley: z.literal(true),
    stoppedSessionId: text,
    reviewToken: text,
  })
  .strict();
export async function finishAsideBasket(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: {
    operationId: string;
    expectedRevision: number;
    confirmedTrolley: true;
    stoppedSessionId: string;
    reviewToken: string;
  },
) {
  const parsed = parse(finishAsideSchema, input);
  if (
    await prisma.piMealOperation.findUnique({
      where: { id: parsed.operationId },
    })
  )
    return view(
      await mutateDocument<BasketData>(prisma, {
        id,
        kind: "basket",
        actorId,
        operationId: parsed.operationId,
        expectedRevision: parsed.expectedRevision,
        payload: parsed,
        reduce: () => {
          throw new Error("Missing operation receipt");
        },
      }),
    );
  const basket = await getBasket(prisma, id);
  if (!basket)
    throw Object.assign(new Error("Basket not found."), { statusCode: 404 });
  const receipt = basket.receipt as ExecutionReceipt | undefined;
  if (
    basket.executor !== "aside" ||
    !receipt?.sessionId ||
    !receipt.operationId ||
    receipt.effect !== "aside_stopped_for_review" ||
    receipt.sessionStopped?.status !== "idle" ||
    receipt.sessionStopped.sessionId !== receipt.sessionId ||
    receipt.reviewToken !== parsed.reviewToken ||
    receipt.sessionId !== parsed.stoppedSessionId ||
    receipt.reviewRevision !== basket.revision ||
    parsed.expectedRevision !== basket.revision
  )
    throw new MealConflict(
      "Stop the recorded Aside task first. Then review the stopped trolley and confirm that exact review; an earlier confirmation cannot finish shopping.",
    );
  await assertExecutionGuard(prisma, id, receipt.operationId);
  let inspected: Awaited<ReturnType<typeof inspectAsideSession>>;
  try {
    inspected = await inspectAsideSession(receipt.sessionId);
    if (inspected.status !== "idle")
      throw new Error(
        "The Aside task is no longer idle. Stop it again, then review the changed trolley before confirming.",
      );
  } catch (error) {
    return view(
      await mutateDocument<BasketData>(prisma, {
        id,
        kind: "basket",
        actorId,
        operationId: parsed.operationId,
        expectedRevision: parsed.expectedRevision,
        payload: parsed,
        reduce: (current) => {
          const data = required(current);
          const nextReceipt = { ...((data.receipt as object) ?? {}) } as Record<
            string,
            unknown
          >;
          delete nextReceipt.reviewToken;
          delete nextReceipt.reviewRevision;
          return {
            ...data,
            status: "needs_review",
            unresolved: [
              error instanceof Error
                ? error.message
                : "The stopped Aside session could not be verified. Stop it and review again.",
            ],
            receipt: {
              ...nextReceipt,
              effect: "aside_review_invalidated",
              uncertain: true,
              remoteTerminationUnknown: true,
              checkout: false,
            },
          };
        },
      }),
    );
  }
  const confirmedAt = new Date().toISOString();
  // User attestation is recorded only after a separately completed stop/review phase.
  const result = await prisma.$transaction(async (tx) => {
    const client = transactionStore(tx);
    const result = await mutateDocument<BasketData>(client, {
      id,
      kind: "basket",
      actorId,
      operationId: parsed.operationId,
      expectedRevision: parsed.expectedRevision,
      payload: parsed,
      reduce: (current) => {
        const data = required(current),
          currentReceipt = data.receipt as ExecutionReceipt | undefined;
        if (
          !currentReceipt ||
          currentReceipt.effect !== "aside_stopped_for_review" ||
          currentReceipt.sessionId !== parsed.stoppedSessionId ||
          currentReceipt.reviewToken !== parsed.reviewToken ||
          currentReceipt.reviewRevision !== parsed.expectedRevision
        )
          throw new MealConflict(
            "The stopped review changed. Stop and review the trolley again before confirming.",
          );
        return {
          ...data,
          status: "complete",
          unresolved: [],
          receipt: {
            ...((data.receipt as object) ?? {}),
            effect: "aside_user_verified",
            verification: "user",
            confirmedTrolley: true,
            confirmedBy: actorId,
            confirmedAt,
            sessionConfirmedIdle: inspected,
            remoteTerminationUnknown: false,
            executionFinished: true,
            uncertain: false,
            checkout: false,
          },
        };
      },
    });
    await releaseExecutionGuard(client, id, receipt.operationId!);
    return result;
  });
  return view(result);
}
