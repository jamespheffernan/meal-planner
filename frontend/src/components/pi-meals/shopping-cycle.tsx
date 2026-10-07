"use client";
import { useEffect, useState, useRef } from "react";
import type { RecipeSelection } from "../../lib/pi-meals-api";
import {
  cachedShopping,
  loadShopping,
  queuePurchase,
  flushShopping,
  sendShopping,
  saveCachedShopping,
  reconcileShoppingPurchase,
  retainConflictedPurchase,
  type CachedShopping,
  type CycleLine,
  type ShoppingRoute,
} from "../../lib/pi-meals-shopping-api";
import styles from "./shopping-cycle.module.css";
export function ShoppingCycle({ selection }: { selection: RecipeSelection }) {
  const [savedState, setSaved] = useState<CachedShopping | null>(null);
  const saved =
    savedState?.cycle.selectionId === selection.id ? savedState : null;
  const lifecycle = useRef(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [arrivalRoute, setArrivalRoute] =
    useState<ShoppingRoute>("supermarket");
  const [arrival, setArrival] = useState("");
  async function setArrivalForRoute() {
    if (!saved || !arrival) return;
    const generation = lifecycle.current;
    setBusy(true);
    try {
      const value = await sendShopping(saved, {
        type: "route_defaults",
        route: arrivalRoute,
        availableOn: arrival,
        observedSelectionRevision: saved.cycle.selectionRevision,
      });
      if (generation !== lifecycle.current) return;
      setSaved(value);
      setError("");
    } catch (e) {
      if (generation === lifecycle.current) setError((e as Error).message);
    } finally {
      if (generation === lifecycle.current) setBusy(false);
    }
  }

  async function flush(generation = lifecycle.current) {
    try {
      let value = await flushShopping();
      if (generation !== lifecycle.current) return;
      setSaved(value?.cycle.selectionId === selection.id ? value : null);
      while (value?.pending.length && value.pending[0].status === "pending") {
        value = await flushShopping();
        if (generation !== lifecycle.current) return;
        setSaved(value?.cycle.selectionId === selection.id ? value : null);
      }
    } catch (e) {
      if (generation === lifecycle.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    let live = true;
    const generation = ++lifecycle.current;
    const controller = new AbortController();
    setSaved(null);
    setError("");
    setBusy(false);
    cachedShopping()
      .then((v) => {
        if (
          live &&
          generation === lifecycle.current &&
          v?.cycle.selectionId === selection.id
        )
          setSaved(v);
      })
      .catch(() => {});
    loadShopping(selection.id, controller.signal)
      .then((v) => {
        if (live && generation === lifecycle.current) {
          setSaved(v);
          void flush(generation);
        }
      })
      .catch((e) => {
        if (live && generation === lifecycle.current) setError(e.message);
      });
    const online = () => void flush(generation);
    window.addEventListener("online", online);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/market/sw.js", { scope: "/market/" })
        .catch((e) => {
          if (live && generation === lifecycle.current)
            setError(`Offline page unavailable: ${e.message}`);
        });
    return () => {
      live = false;
      controller.abort();
      lifecycle.current++;
      window.removeEventListener("online", online);
    };
  }, [selection.id, selection.revision]);
  async function buy(line: CycleLine, quantity: number) {
    if (!saved) return;
    const generation = lifecycle.current;
    setBusy(true);
    setError("");
    try {
      const value = await queuePurchase(saved, line, quantity);
      if (generation !== lifecycle.current) return;
      setSaved(value);
      if (navigator.onLine) await flush(generation);
    } catch (e) {
      if (generation === lifecycle.current) setError((e as Error).message);
    } finally {
      if (generation === lifecycle.current) setBusy(false);
    }
  }
  async function route(
    line: CycleLine,
    values: {
      route: ShoppingRoute;
      neededOn?: string;
      availableOn?: string;
    },
  ) {
    if (!saved) return;
    const generation = lifecycle.current;
    setBusy(true);
    try {
      const value = await sendShopping(saved, {
        type: "route",
        lineId: line.id,
        ...values,
      });
      if (generation !== lifecycle.current) return;
      setSaved(value);
      setError("");
    } catch (e) {
      if (generation === lifecycle.current) setError((e as Error).message);
    } finally {
      if (generation === lifecycle.current) setBusy(false);
    }
  }
  async function reconcile(id: string, retain = false) {
    const generation = lifecycle.current;
    setBusy(true);
    try {
      const value = await (retain
        ? retainConflictedPurchase(id)
        : reconcileShoppingPurchase(id));
      if (generation === lifecycle.current) {
        setSaved(value);
        setError("");
      }
    } catch (e) {
      if (generation === lifecycle.current) setError((e as Error).message);
    } finally {
      if (generation === lifecycle.current) setBusy(false);
    }
  }
  return (
    <section className={styles.root} aria-label="Shopping routes">
      <h2>Where to shop</h2>
      <div className={styles.controls}>
        <label>
          Shop
          <select
            value={arrivalRoute}
            onChange={(event) =>
              setArrivalRoute(event.target.value as ShoppingRoute)
            }
          >
            <option value="supermarket">Supermarket</option>
            <option value="market">Saturday market</option>
            <option value="topup">Exceptional top-up</option>
          </select>
        </label>
        <label>
          Confirmed expected arrival
          <input
            type="date"
            value={arrival}
            onChange={(event) => setArrival(event.target.value)}
          />
        </label>
        <button
          disabled={busy || !saved || !arrival}
          onClick={() => void setArrivalForRoute()}
        >
          Set {arrivalRoute === "topup" ? "top-up" : arrivalRoute} arrival for
          all {arrivalRoute === "topup" ? "top-up" : arrivalRoute} items
        </button>
      </div>
      <p>
        Planned food becomes bought only when you confirm the amount. This does
        not change pantry stock.
      </p>
      <a href="/market/index.html">Open the offline market list</a>
      <p>
        This device keeps a household list for offline use. Clear it before
        sharing the device.
      </p>
      <button
        onClick={async () => {
          lifecycle.current++;
          setSaved(null);
          setBusy(false);
          setError("");
          await saveCachedShopping(null);
        }}
      >
        Clear saved list and unsent purchases
      </button>
      {error && <p role="alert">{error}</p>}
      {saved && (
        <>
          <p>
            Saved {new Date(saved.cachedAt).toLocaleString()} · list revision{" "}
            {saved.cycle.revision}
          </p>
          {saved.cycle.sourceChanged && (
            <p role="alert">
              Recipe selection changed. Review routes and amounts.
            </p>
          )}
          {saved.pending.map((p) => (
            <p key={p.operationId} role="status">
              {p.status === "conflict"
                ? "Needs reconciliation"
                : "Unsent purchase"}
              : {p.command.quantity} {p.command.unit} for {p.command.lineId}.{" "}
              {p.error}{" "}
              <button
                disabled={
                  busy ||
                  p.status !== "conflict" ||
                  saved.pending[0].operationId !== p.operationId
                }
                onClick={() => void reconcile(p.operationId)}
              >
                Review current list and retry this saved purchase
              </button>{" "}
              {p.status === "conflict" && (
                <button
                  disabled={busy}
                  onClick={() => void reconcile(p.operationId, true)}
                >
                  Keep observation for later and unblock other purchases
                </button>
              )}{" "}
              (saved by {p.actorId})
            </p>
          ))}
          {saved.pending.length > 0 && (
            <button onClick={() => void flush()}>Sync saved purchases</button>
          )}
          {saved.cycle.purchases.length > 0 && (
            <details>
              <summary>Confirmed purchases</summary>
              {saved.cycle.purchases.map((p, i) => (
                <p key={i}>
                  {p.quantity} {p.unit}{" "}
                  {saved.cycle.lines.find((l) => l.id === p.lineId)?.name ??
                    p.lineId}{" "}
                  · {p.actorId} · {new Date(p.purchasedAt).toLocaleString()}
                </p>
              ))}
            </details>
          )}
          {saved.unresolvedPurchases?.map((p) => (
            <p key={p.operationId} role="status">
              Retained for reconciliation: {p.command.quantity} {p.command.unit}{" "}
              {p.command.lineId} · {p.actorId} · {p.command.purchasedAt}
            </p>
          ))}
          {saved.cycle.orphanPurchases.length > 0 && (
            <p role="alert">
              {saved.cycle.orphanPurchases.length} earlier purchases need
              reconciliation after a recipe change.
            </p>
          )}
          {(["supermarket", "market", "topup"] as const).map((r) => (
            <div key={r}>
              <h3>
                {r === "topup"
                  ? "Exceptional top-up"
                  : r === "market"
                    ? "Saturday market"
                    : "Supermarket"}
              </h3>
              {saved.cycle.lines
                .filter((l) => l.route === r)
                .map((line) => (
                  <ShoppingRow
                    key={line.id}
                    line={line}
                    busy={busy}
                    buy={buy}
                    route={route}
                  />
                ))}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
function ShoppingRow({
  line,
  busy,
  buy,
  route,
}: {
  line: CycleLine;
  busy: boolean;
  buy: (l: CycleLine, q: number) => Promise<void>;
  route: (
    l: CycleLine,
    v: {
      route: ShoppingRoute;
      neededOn?: string;
      availableOn?: string;
    },
  ) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(
    String(line.remainingQuantity ?? ""),
  );
  const [needed, setNeeded] = useState(line.neededOn ?? "");
  const [available, setAvailable] = useState(line.availableOn ?? "");
  const [choice, setChoice] = useState(line.route);
  useEffect(() => {
    setQuantity(String(line.remainingQuantity ?? ""));
    setNeeded(line.neededOn ?? "");
    setAvailable(line.availableOn ?? "");
    setChoice(line.route);
  }, [
    line.id,
    line.remainingQuantity,
    line.neededOn,
    line.availableOn,
    line.route,
  ]);
  return (
    <article className={styles.row}>
      <strong>{line.name}</strong>
      <span>
        {line.remainingQuantity ?? "Amount to confirm"} {line.unit} remaining ·{" "}
        {line.boughtQuantity} bought
      </span>
      <small>{line.sources.map((s) => s.name).join(", ")}</small>
      {line.late && (
        <p role="alert">Arrives after it is needed. Plan is incomplete.</p>
      )}
      {line.sourceChanged && (
        <p role="alert">Requirement changed; confirm this route again.</p>
      )}
      <div className={styles.controls}>
        <label>
          Shop
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value as ShoppingRoute)}
          >
            <option value="supermarket">Supermarket</option>
            <option value="market">Market</option>
            <option value="topup">Top-up</option>
          </select>
        </label>
        <label>
          Needed on
          <input
            type="date"
            value={needed}
            onChange={(e) => setNeeded(e.target.value)}
          />
        </label>
        <label>
          Available on
          <input
            type="date"
            value={available}
            onChange={(e) => setAvailable(e.target.value)}
          />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            route(line, {
              route: choice,
              neededOn: needed || undefined,
              availableOn: available || undefined,
            })
          }
        >
          Save route
        </button>
        <label>
          Actually bought ({line.unit})
          <input
            type="number"
            min="0.001"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !(Number(quantity) > 0)}
          onClick={() => buy(line, Number(quantity))}
        >
          Record purchase
        </button>
      </div>
    </article>
  );
}
export default ShoppingCycle;
