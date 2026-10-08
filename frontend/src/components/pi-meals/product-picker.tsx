"use client";
import { useEffect, useRef, useState } from "react";
import {
  mealsApi,
  type BasketProposal,
  type BasketManifestLine,
} from "@/lib/pi-meals-api";
import { productsApi, type MealProduct } from "@/lib/pi-meals-products-api";
import styles from "./product-picker.module.css";
export interface ProductPickerProps {
  basket: BasketProposal;
  onUpdated: (basket: BasketProposal) => void;
  disabled?: boolean;
}
export function ProductPicker({
  basket,
  onUpdated,
  disabled = false,
}: ProductPickerProps) {
  const [lines, setLines] = useState(basket.lines),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setLines(basket.lines);
    setError("");
  }, [basket.id, basket.revision, basket.lines]);
  const asideReceipt = basket.receipt as
    | {
        sessionId?: string;
        reviewToken?: string;
        sessionStopped?: { status: string };
        processState?: string;
        error?: string;
      }
    | undefined;
  const locked =
    disabled || busy || !!basket.receipt || basket.status === "running";
  async function action(run: () => Promise<BasketProposal>) {
    setBusy(true);
    setError("");
    try {
      onUpdated(await run());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Basket request failed");
    } finally {
      setBusy(false);
    }
  }
  if (basket.executor === "aside") {
    const stopped =
      !!asideReceipt?.reviewToken &&
      asideReceipt.sessionStopped?.status === "idle";
    const finished = basket.status === "complete";
    return (
      <div className={styles.picker}>
        <h3>
          {finished
            ? "Your trolley is ready for checkout"
            : stopped
              ? "Review your Ocado trolley"
              : asideReceipt?.sessionId
                ? "Shopping task opened in Aside"
                : "Start your Ocado shop"}
        </h3>
        <p>
          {finished
            ? "You’ve confirmed the trolley. Choose your delivery slot and place the order in Ocado."
            : stopped
              ? "Aside is stopped. Check the products, quantities and any items already in your trolley, then confirm below."
              : "Aside has the remaining ingredient quantities and will choose suitable products and pack sizes. Follow its shopping task in Aside; you can return here at any time."}
        </p>
        {basket.asideSession && !finished && !stopped && (
          <p role="status">
            {basket.asideSession.status === "idle"
              ? "Aside has finished its current turn. Check its result, then review the trolley."
              : basket.asideSession.status === "running"
                ? "Aside is working on your shop."
                : `Aside status: ${basket.asideSession.status}`}
          </p>
        )}
        {(error || asideReceipt?.error || basket.asideSession?.error) && (
          <p role="alert" className={styles.error}>
            {error || asideReceipt?.error || basket.asideSession?.error}
          </p>
        )}
        {!asideReceipt?.sessionId && basket.receipt != null && (
          <p role="alert">
            The launch needs checking before another task can start. Your
            shopping list is saved.
          </p>
        )}
        <div className={styles.actions}>
          {!basket.receipt && (
            <button
              disabled={locked}
              onClick={() => void action(() => productsApi.aside(basket))}
            >
              {busy ? "Opening Aside…" : "Shop with Aside"}
            </button>
          )}
          {!!asideReceipt?.sessionId && !finished && !stopped && (
            <button
              disabled={disabled || busy}
              onClick={() => void action(() => productsApi.stopAside(basket))}
            >
              {busy ? "Stopping…" : "Stop shopping & review trolley"}
            </button>
          )}
          {(stopped || finished) && (
            <a
              href="https://www.ocado.com/webshop/trolley/trolley.do"
              target="_blank"
              rel="noreferrer"
            >
              {finished
                ? "Open Ocado to place your order ↗"
                : "Open Ocado trolley ↗"}
            </a>
          )}
          {stopped && !finished && (
            <button
              disabled={disabled || busy}
              onClick={() =>
                void action(() => productsApi.completeAside(basket))
              }
            >
              I’ve checked the trolley
            </button>
          )}
          {!finished && (
            <button
              disabled={disabled || busy}
              onClick={() => void action(() => mealsApi.getBasket(basket.id))}
            >
              Refresh task status
            </button>
          )}
        </div>
        {!finished && (
          <p className={styles.hint}>
            Your task and shopping list are saved. Placing the order stays with
            you.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={styles.picker}>
      <h3>Choose what goes in your trolley</h3>
      <p>
        Search Ocado for each ingredient. Review the product and its pack size
        before filling.
      </p>
      {lines.map((line) => (
        <ProductLine
          key={basket.id + line.id}
          line={line}
          disabled={locked}
          onChange={(updated) =>
            setLines((current) =>
              current.map((row) => (row.id === updated.id ? updated : row)),
            )
          }
        />
      ))}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          disabled={
            locked ||
            !lines.every(
              (line) => line.productId && line.packQuantity && line.packUnit,
            )
          }
          onClick={() => void action(() => mealsApi.prepare(basket, lines))}
        >
          {busy ? "Working…" : "Save product choices"}
        </button>
        <button
          disabled={
            locked ||
            basket.status !== "ready" ||
            JSON.stringify(lines) !== JSON.stringify(basket.lines)
          }
          onClick={() => void action(() => productsApi.aside(basket))}
        >
          Use these choices in Aside
        </button>
      </div>
    </div>
  );
}
function ProductLine({
  line,
  disabled,
  onChange,
}: {
  line: BasketManifestLine;
  disabled: boolean;
  onChange: (line: BasketManifestLine) => void;
}) {
  const [query, setQuery] = useState(line.name),
    [products, setProducts] = useState<MealProduct[]>([]),
    [searching, setSearching] = useState(false),
    [error, setError] = useState(""),
    [unknownPack, setUnknownPack] = useState(!line.packQuantity);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function search() {
    const request = ++sequence.current;
    setSearching(true);
    setError("");
    try {
      const result = await productsApi.search(query);
      if (request === sequence.current) {
        setProducts(result.products);
        if (!result.products.length)
          setError("No matching products found. Try a different search.");
      }
    } catch (e) {
      if (request === sequence.current)
        setError(e instanceof Error ? e.message : "Product search failed");
    } finally {
      if (request === sequence.current) setSearching(false);
    }
  }
  function choose(product: MealProduct) {
    setUnknownPack(!product.packQuantity);
    const clean = { ...line };
    delete clean.packs;
    delete clean.baselineQuantity;
    delete clean.packQuantity;
    delete clean.packUnit;
    delete clean.price;
    onChange({
      ...clean,
      productId: product.productId,
      productName: product.name,
      ...(product.price !== null ? { price: product.price } : {}),
      ...(product.packQuantity
        ? { packQuantity: product.packQuantity, packUnit: product.packUnit }
        : {}),
    });
    setProducts([]);
  }
  return (
    <section className={styles.line}>
      <h4>
        {line.name}{" "}
        <span>
          Buy {line.quantity} {line.unit}
        </span>
      </h4>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label={`Search Ocado for ${line.name}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={160}
          disabled={disabled}
          required
        />
        <button disabled={disabled || searching}>
          {searching ? "Searching…" : "Search Ocado"}
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error} <a href="/settings">Open Settings</a>
        </p>
      )}
      <div className={styles.products}>
        {products.map((product) => (
          <article key={product.productId} className={styles.product}>
            {product.imageUrl && (
              <img src={product.imageUrl} alt={product.name} loading="lazy" />
            )}
            <strong>{product.name}</strong>
            <span>
              {product.price === null
                ? "Price unavailable"
                : `£${product.price.toFixed(2)}`}{" "}
              · {product.packLabel || "Pack size needs review"}
            </span>
            <a href={product.productUrl} target="_blank" rel="noreferrer">
              View product ↗
            </a>
            <button disabled={disabled} onClick={() => choose(product)}>
              Choose product
            </button>
          </article>
        ))}
      </div>
      {line.productId && (
        <div className={styles.choice}>
          <strong>{line.productName}</strong>
          {!unknownPack ? (
            <p>
              Pack: {line.packQuantity} {line.packUnit}. Pack count is
              calculated when you save.
            </p>
          ) : (
            <>
              <p>
                Ocado did not provide a clear pack size. Check the product page,
                then confirm the amount in one pack using {line.unit}.
              </p>
              <div className={styles.search}>
                <label>
                  Amount in one pack
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={line.packQuantity ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({
                        ...line,
                        packQuantity: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                        packs: undefined,
                      })
                    }
                  />
                </label>
                <label>
                  Pack unit
                  <input
                    value={line.packUnit ?? ""}
                    placeholder={line.unit}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({
                        ...line,
                        packUnit: e.target.value,
                        packs: undefined,
                      })
                    }
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
