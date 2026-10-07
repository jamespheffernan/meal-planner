import {
  mealsRequest,
  mealsApi,
  operationId,
  MealsApiError,
  type ShoppingLine,
} from "./pi-meals-api";
export type ShoppingRoute = "supermarket" | "market" | "topup";
export interface CycleLine extends ShoppingLine {
  fingerprint: string;
  route: ShoppingRoute;
  neededOn?: string;
  availableOn?: string;
  late: boolean;
  sourceChanged: boolean;
  planned: boolean;
  boughtQuantity: number;
  remainingQuantity: number | null;
}
export interface ShoppingCycle {
  id: string;
  revision: number;
  selectionId: string;
  selectionRevision: number;
  sourceChanged: boolean;
  lines: CycleLine[];
  purchases: Array<{
    lineId: string;
    actorId: string;
    quantity: number;
    unit: string;
    purchasedAt: string;
  }>;
  orphanPurchases: unknown[];
}
export type ShoppingCommand =
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
export interface PendingPurchase {
  operationId: string;
  expectedRevision: number;
  command: Extract<
    ShoppingCommand,
    {
      type: "purchase";
    }
  >;
  actorId: string;
  status: "pending" | "conflict";
  error?: string;
  previousOperationIds?: string[];
}
export interface CachedShopping {
  actorId: string;
  apiBase: string;
  cycle: ShoppingCycle;
  pending: PendingPurchase[];
  unresolvedPurchases?: PendingPurchase[];
  cachedAt: string;
}
let cacheEpoch = 0;
function cacheVersion(): string {
  return typeof localStorage === "undefined"
    ? String(cacheEpoch)
    : (localStorage.getItem("pi-meals-market-epoch") ?? "0");
}
function invalidateCache() {
  cacheEpoch++;
  if (typeof localStorage !== "undefined")
    localStorage.setItem("pi-meals-market-epoch", crypto.randomUUID());
}
const DB = "pi-meals-market-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("shopping");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function cachedShopping(): Promise<CachedShopping | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction("shopping");
    const r = t.objectStore("shopping").get("current");
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  });
}
export async function saveCachedShopping(value: CachedShopping | null) {
  if (!value) invalidateCache();
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("shopping", "readwrite");
    if (value) t.objectStore("shopping").put(value, "current");
    else t.objectStore("shopping").delete("current");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}
async function updateCachedShopping(
  change: (value: CachedShopping | null) => CachedShopping,
  version = cacheVersion(),
): Promise<CachedShopping> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction("shopping", "readwrite");
    const store = t.objectStore("shopping");
    const r = store.get("current");
    let result: CachedShopping;
    r.onsuccess = () => {
      try {
        if (cacheVersion() !== version)
          throw new Error("Saved list cleared or changed during request.");
        result = change(r.result ?? null);
        store.put(result, "current");
      } catch (e) {
        t.abort();
        reject(e);
      }
    };
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}
const apiBase =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3001/api"
    : "/api");
export async function loadShopping(selectionId: string, signal?: AbortSignal) {
  const version = cacheVersion();
  const session = await mealsApi.session();
  const cycle = await mealsRequest<ShoppingCycle>(
    `/pi-meals/shopping/${encodeURIComponent(selectionId)}`,
  );
  return updateCachedShopping((old) => {
    if (signal?.aborted)
      throw new Error("Shopping selection changed during load.");
    if (
      old &&
      (old.pending.length || old.unresolvedPurchases?.length) &&
      (old.actorId !== session.actorId || old.cycle.selectionId !== selectionId)
    )
      throw new Error(
        "Resolve or clear the saved purchases before changing the offline list or member.",
      );
    return {
      actorId: session.actorId,
      apiBase,
      cycle,
      pending:
        old?.actorId === session.actorId &&
        old.cycle.selectionId === selectionId
          ? old.pending
          : [],
      unresolvedPurchases:
        old?.actorId === session.actorId &&
        old.cycle.selectionId === selectionId
          ? old.unresolvedPurchases
          : undefined,
      cachedAt: new Date().toISOString(),
    };
  }, version);
}
export async function sendShopping(
  value: CachedShopping,
  command: ShoppingCommand,
) {
  const version = cacheVersion();
  const session = await mealsApi.session();
  if (session.actorId !== value.actorId)
    throw new Error("Sign in as the member who saved this list.");
  const cycle = await mealsRequest<ShoppingCycle>(
    `/pi-meals/shopping/${value.cycle.selectionId}/commands`,
    "POST",
    {
      expectedActorId: value.actorId,
      operationId: operationId(),
      expectedRevision: value.cycle.revision,
      command,
    },
  );
  return updateCachedShopping((current) => {
    if (
      current &&
      (current.actorId !== value.actorId ||
        current.cycle.selectionId !== value.cycle.selectionId)
    )
      throw new Error("Saved member or list changed during request.");
    if (!current) throw new Error("Saved list cleared during request.");
    return { ...current, cycle, cachedAt: new Date().toISOString() };
  }, version);
}
export async function queuePurchase(
  value: CachedShopping,
  line: CycleLine,
  quantity: number,
) {
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Enter the amount actually bought.");
  return updateCachedShopping((current) => {
    if (!current)
      throw new Error(
        "Saved list cleared. Reload before recording a purchase.",
      );
    const latest = current;
    if (
      latest.actorId !== value.actorId ||
      latest.cycle.selectionId !== value.cycle.selectionId
    )
      throw new Error(
        "The saved offline member or selection changed. Reload before recording a purchase.",
      );
    return {
      ...latest,
      pending: [
        ...latest.pending,
        {
          operationId: operationId(),
          expectedRevision: latest.cycle.revision + latest.pending.length,
          actorId: latest.actorId,
          status: "pending" as const,
          command: {
            type: "purchase" as const,
            lineId: line.id,
            quantity,
            unit: line.unit,
            observedFingerprint: line.fingerprint,
            purchasedAt: new Date().toISOString(),
          },
        },
      ],
    };
  });
}
let flushing: Promise<CachedShopping | null> | null = null;
export function flushShopping(): Promise<CachedShopping | null> {
  if (flushing) return flushing;
  flushing = (async () => {
    const version = cacheVersion();
    const value = await cachedShopping();
    if (!value?.pending.length) return value;
    const session = await mealsApi.session();
    if (session.actorId !== value.actorId)
      throw new Error(
        "Saved purchases belong to another member. Sign in as that member to sync.",
      );
    const entry = value.pending[0];
    if (entry.status === "conflict") return value;
    try {
      const cycle = await mealsRequest<ShoppingCycle>(
        `/pi-meals/shopping/${value.cycle.selectionId}/commands`,
        "POST",
        {
          expectedActorId: entry.actorId,
          operationId: entry.operationId,
          expectedRevision: entry.expectedRevision,
          command: entry.command,
        },
      );
      return updateCachedShopping((current) => {
        if (
          !current ||
          current.actorId !== value.actorId ||
          current.cycle.selectionId !== value.cycle.selectionId
        )
          throw new Error("Offline list changed during sync.");
        return {
          ...current,
          cycle,
          pending: current.pending.filter(
            (p) => p.operationId !== entry.operationId,
          ),
          cachedAt: new Date().toISOString(),
        };
      }, version);
    } catch (e) {
      if (e instanceof MealsApiError && e.status === 409) {
        return updateCachedShopping((current) => {
          if (!current) throw new Error("Offline list cleared during sync.");
          return {
            ...current,
            pending: current.pending.map((p) =>
              p.operationId === entry.operationId
                ? { ...p, status: "conflict" as const, error: e.message }
                : p,
            ),
          };
        }, version);
      }
      throw e;
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
/** Explicit user reconciliation preserves the observation time and amount; it never runs automatically. */
export async function reconcileShoppingPurchase(id: string) {
  const version = cacheVersion();
  const value = await cachedShopping();
  const observation = value?.pending.find((p) => p.operationId === id);
  if (!value || !observation) throw new Error("Saved purchase not found.");
  const session = await mealsApi.session();
  if (session.actorId !== observation.actorId)
    throw new Error("Sign in as the member who recorded this purchase.");
  const current = await mealsRequest<ShoppingCycle>(
    `/pi-meals/shopping/${value.cycle.selectionId}`,
  );
  const line = current.lines.find(
    (line) =>
      line.id === observation.command.lineId &&
      line.unit === observation.command.unit,
  );
  if (!line || line.fingerprint !== observation.command.observedFingerprint)
    throw new Error(
      "The ingredient meaning or amount changed. Keep this observation and review the current recipe before recording a separate correction.",
    );
  if (observation.status !== "conflict" || value.pending[0]?.operationId !== id)
    throw new Error(
      "Sync earlier purchases first. Retry only a confirmed conflict.",
    );
  await updateCachedShopping((saved) => {
    if (
      !saved ||
      saved.actorId !== value.actorId ||
      saved.cycle.selectionId !== value.cycle.selectionId
    )
      throw new Error("Saved list changed during reconciliation.");
    return {
      ...saved,
      cycle: current,
      pending: saved.pending.map((p) =>
        p.operationId === id
          ? {
              ...p,
              operationId: operationId(),
              expectedRevision: current.revision,
              status: "pending" as const,
              error: undefined,
              previousOperationIds: [
                ...(p.previousOperationIds ?? []),
                p.operationId,
              ],
            }
          : p,
      ),
    };
  }, version);
  const result = await flushShopping();
  if (!result) throw new Error("Saved list cleared during reconciliation.");
  return result;
}

/** Keep a changed purchase observation locally while releasing unrelated queued commands. */
export async function retainConflictedPurchase(id: string) {
  return updateCachedShopping((saved) => {
    if (!saved) throw new Error("Saved list cleared.");
    const observation = saved.pending.find(
      (p) => p.operationId === id && p.status === "conflict",
    );
    if (!observation) throw new Error("Conflicted purchase not found.");
    return {
      ...saved,
      pending: saved.pending.filter((p) => p.operationId !== id),
      unresolvedPurchases: [...(saved.unresolvedPurchases ?? []), observation],
    };
  });
}
