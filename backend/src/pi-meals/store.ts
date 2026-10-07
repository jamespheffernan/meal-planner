import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export class MealConflict extends Error {
  statusCode = 409;
  constructor(
    message = "This changed since you opened it. Refresh and try again.",
  ) {
    super(message);
  }
}
export interface MealDocument<T> {
  id: string;
  kind: string;
  revision: number;
  data: T;
  updatedAt: string;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function readDocument<T>(
  prisma: PrismaClient,
  id: string,
  kind?: string,
): Promise<MealDocument<T> | null> {
  const row = await prisma.piMealDocument.findUnique({ where: { id } });
  if (!row || (kind && row.kind !== kind)) return null;
  return {
    id: row.id,
    kind: row.kind,
    revision: row.revision,
    data: row.data as T,
    updatedAt: row.updatedAt.toISOString(),
  };
}
export async function listDocuments<T>(
  prisma: PrismaClient,
  kind: string,
): Promise<MealDocument<T>[]> {
  const rows = await prisma.piMealDocument.findMany({
    where: { kind },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    revision: row.revision,
    data: row.data as T,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
/** Reducers must be deterministic and side-effect free. Effects run after this transaction. */
export async function mutateDocument<T>(
  prisma: PrismaClient,
  input: {
    id: string;
    kind: string;
    operationId: string;
    actorId: string;
    expectedRevision: number;
    payload: unknown;
    reduce: (current: T | null) => T;
  },
): Promise<MealDocument<T>> {
  if (
    !input.operationId ||
    !input.actorId ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    throw new Error("Invalid command identity or revision");
  const hash = createHash("sha256")
    .update(
      canonical({
        id: input.id,
        kind: input.kind,
        actorId: input.actorId,
        expectedRevision: input.expectedRevision,
        payload: input.payload,
      }),
    )
    .digest("hex");
  const prior = await prisma.piMealOperation.findUnique({
    where: { id: input.operationId },
  });
  if (prior) {
    if (prior.payloadHash !== hash)
      throw new MealConflict(
        "This command ID was already used for a different change.",
      );
    return prior.result as unknown as MealDocument<T>;
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.piMealDocument.findUnique({
        where: { id: input.id },
      });
      if (
        (row?.revision ?? 0) !== input.expectedRevision ||
        (row && row.kind !== input.kind)
      )
        throw new MealConflict();
      const data = input.reduce(row ? (row.data as T) : null);
      const revision = input.expectedRevision + 1;
      const updatedAt = new Date();
      if (row) {
        const changed = await tx.piMealDocument.updateMany({
          where: { id: input.id, revision: input.expectedRevision },
          data: { data: data as Prisma.InputJsonValue, revision, updatedAt },
        });
        if (changed.count !== 1) throw new MealConflict();
      } else
        await tx.piMealDocument.create({
          data: {
            id: input.id,
            kind: input.kind,
            revision,
            data: data as Prisma.InputJsonValue,
            updatedAt,
          },
        });
      const result = {
        id: input.id,
        kind: input.kind,
        revision,
        data,
        updatedAt: updatedAt.toISOString(),
      };
      await tx.piMealOperation.create({
        data: {
          id: input.operationId,
          documentId: input.id,
          actorId: input.actorId,
          payloadHash: hash,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    });
  } catch (error) {
    const committed = await prisma.piMealOperation.findUnique({
      where: { id: input.operationId },
    });
    if (committed) {
      if (committed.payloadHash !== hash)
        throw new MealConflict(
          "This command ID was already used for a different change.",
        );
      return committed.result as unknown as MealDocument<T>;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    )
      throw new MealConflict();
    throw error;
  }
}
