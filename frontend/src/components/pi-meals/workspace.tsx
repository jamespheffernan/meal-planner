"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChefHat,
  Plus,
  ShoppingBasket,
  X,
} from "lucide-react";
import type { Recipe } from "@/lib/api";
import {
  mealsApi,
  MealsApiError,
  recipeSnapshot,
  draftSnapshot,
  type RecipeSelection,
  type RecipeDraft,
  type BasketProposal,
  type SelectionChange,
  type AssistantResult,
} from "@/lib/pi-meals-api";
import styles from "./workspace.module.css";
import { ProductPicker } from "./product-picker";
import { ShoppingCycle } from "./shopping-cycle";
import { ManualExtras } from "./manual-extras";
import { saveCachedShopping } from "@/lib/pi-meals-shopping-api";

export function MealsWorkspace() {
  const [libraryLimit, setLibraryLimit] = useState(12);
  const [selection, setSelection] = useState<RecipeSelection | null>(null),
    [saved, setSaved] = useState<RecipeSelection[]>([]),
    [library, setLibrary] = useState<Recipe[]>([]);
  const [drafts, setDrafts] = useState<RecipeDraft[]>([]),
    [basket, setBasket] = useState<BasketProposal | null>(null),
    [links, setLinks] = useState(""),
    [pageText, setPageText] = useState(""),
    [search, setSearch] = useState("");
  const [assistantStatus, setAssistantStatus] = useState<{
      available: boolean;
      status: string;
      reason?: string;
    } | null>(null),
    [assistant, setAssistant] = useState<AssistantResult | null>(null),
    [assistantInput, setAssistantInput] = useState(""),
    [assistantError, setAssistantError] = useState(""),
    [pollEnded, setPollEnded] = useState(false),
    [serverHandoff, setServerHandoff] = useState(""),
    [handoffError, setHandoffError] = useState("");
  const [signedInName, setSignedInName] = useState("");
  const [undoStock, setUndoStock] = useState<{
    selectionId: string;
    revision: number;
    command: SelectionChange;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [login, setLogin] = useState(false),
    [member, setMember] = useState("James"),
    [pin, setPin] = useState(""),
    [notice, setNotice] = useState("");
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (e instanceof MealsApiError && e.status === 401) setLogin(true);
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, []);
  const load = useCallback(async () => {
    const memberSession = await mealsApi.session();
    setSignedInName(memberSession.name);
    setLogin(false);
    void mealsApi
      .assistantStatus()
      .then(setAssistantStatus)
      .catch((e) =>
        setAssistantError(
          e instanceof Error ? e.message : "Assistant status unavailable",
        ),
      );
    const [rows, recipes, pendingDrafts] = await Promise.all([
      mealsApi.selections(),
      mealsApi.library(),
      mealsApi.drafts(),
    ]);
    setSaved(rows);
    setLibrary(recipes);
    setDrafts(pendingDrafts.filter((d) => d.status !== "saved"));
    const remembered = localStorage.getItem("pi-meals-selection");
    const current = rows.find((row) => row.id === remembered) || rows[0];
    setSelection(
      current ? await mealsApi.selection(current.id) : await mealsApi.create(),
    );
  }, []);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const assistantSelectionId = useRef<string | null>(null);
  const basketId = basket?.id,
    basketRevision = basket?.revision;
  const assistantRequestId = assistant?.requestId,
    assistantActive =
      !!assistant && ["queued", "running"].includes(assistant.status),
    selectionId = selection?.id;
  useEffect(() => {
    void run(load);
  }, [run, load]);
  useEffect(() => {
    if (selection) localStorage.setItem("pi-meals-selection", selection.id);
  }, [selection]);
  useEffect(() => {
    setServerHandoff("");
    setHandoffError("");
    if (!basketId) return;
    let cancelled = false;
    void mealsApi
      .handoff(basketId)
      .then((result) => {
        if (
          !cancelled &&
          result.basketId === basketId &&
          result.revision === basketRevision
        )
          setServerHandoff(result.text);
      })
      .catch((e) => {
        if (!cancelled)
          setHandoffError(
            e instanceof Error ? e.message : "Basket handoff unavailable",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [basketId, basketRevision]);
  useEffect(() => {
    if (
      !assistantRequestId ||
      !assistantActive ||
      assistantSelectionId.current !== selectionId
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    setPollEnded(false);
    async function poll() {
      try {
        const result = await mealsApi.assistantResult(assistantRequestId!);
        if (cancelled) return;
        if (result.status === "complete") {
          const refreshed = await mealsApi.selection(selectionId!);
          if (cancelled || selectionRef.current?.id !== selectionId) return;
          setSelection(refreshed);
          setBasket(null);
        }
        setAssistant(result);
        if (!["queued", "running"].includes(result.status)) return;
        if (++attempts >= 40) {
          setPollEnded(true);
          return;
        }
        timer = setTimeout(() => void poll(), 1500);
      } catch (e) {
        if (!cancelled)
          setAssistantError(
            e instanceof Error ? e.message : "Assistant progress check failed",
          );
      }
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assistantRequestId, assistantActive, selectionId]);
  async function askAssistant() {
    if (!selection) return;
    const id = selection.id;
    assistantSelectionId.current = id;
    const result = await mealsApi.assistantMessage(id, assistantInput);
    if (selectionRef.current?.id !== id) return;
    setAssistant(result);
    setAssistantInput("");
    if (result.status === "complete") {
      const refreshed = await mealsApi.selection(id);
      if (selectionRef.current?.id === id) {
        setSelection(refreshed);
        setBasket(null);
      }
    }
  }
  async function checkAssistant() {
    if (!assistant || !selection) return;
    const id = selection.id;
    if (assistantSelectionId.current !== id) return;
    const result = await mealsApi.assistantResult(assistant.requestId);
    if (selectionRef.current?.id !== id) return;
    if (result.status === "complete") {
      const refreshed = await mealsApi.selection(id);
      if (selectionRef.current?.id !== id) return;
      setSelection(refreshed);
      setBasket(null);
    }
    setAssistant(result);
  }

  async function change(command: SelectionChange) {
    if (!selection) return;
    const updated = await mealsApi.command(selection, command);
    if (command.type === "set_stock" || command.type === "have_all") {
      const old = selection.stock.find((row) => row.lineId === command.lineId);
      const line = selection.lines.find((row) => row.id === command.lineId)!;
      setUndoStock({
        selectionId: updated.id,
        revision: updated.revision,
        command: old?.coverageFingerprint
          ? { type: "have_all", lineId: line.id }
          : {
              type: "set_stock",
              lineId: line.id,
              quantity: old?.quantity ?? 0,
              unit: old?.unit ?? line.unit,
            },
      });
    } else setUndoStock(null);
    setSelection(updated);
    setBasket(null);
  }
  async function add(recipe: Recipe) {
    if (!selection) return;
    const full = await mealsApi.recipe(recipe.id);
    await change({
      type: "replace_items",
      items: [...selection.items, recipeSnapshot(full)],
    });
  }
  async function preview() {
    const urls = links.split(/\s+/).filter(Boolean);
    if (!urls.length && !pageText.trim())
      throw new Error("Add a recipe link or paste recipe page text.");
    for (const url of urls) {
      const result = await mealsApi.intake(
        url,
        urls.length === 1 ? pageText || undefined : undefined,
      );
      setDrafts((prev) => [...prev.filter((d) => d.id !== result.id), result]);
    }
    if (!urls.length || (urls.length > 1 && pageText.trim())) {
      const result = await mealsApi.intake(undefined, pageText);
      setDrafts((prev) => [...prev.filter((d) => d.id !== result.id), result]);
    }
    setLinks("");
    setPageText("");
  }
  async function addDraftToShop(draft: RecipeDraft) {
    draftSnapshot(draft);
    const edited = await mealsApi.editDraft(draft);
    setDrafts((prev) =>
      prev.map((row) => (row.id === draft.id ? edited : row)),
    );
    if (selection)
      await change({
        type: "replace_items",
        items: [...selection.items, draftSnapshot(edited)],
      });
  }
  async function saveDraft(draft: RecipeDraft) {
    const edited = await mealsApi.editDraft(draft);
    setDrafts((prev) =>
      prev.map((row) => (row.id === draft.id ? edited : row)),
    );
    const stored = await mealsApi.saveDraft(edited);
    setDrafts((prev) =>
      prev.map((row) => (row.id === draft.id ? stored : row)),
    );
    if (stored.recipeId && selection) {
      const full = await mealsApi.recipe(stored.recipeId);
      await change({
        type: "replace_items",
        items: [...selection.items, recipeSnapshot(full)],
      });
      setLibrary(await mealsApi.library());
    }
  }
  const need =
    selection?.lines.filter(
      (line) => line.buyQuantity === null || line.buyQuantity > 0,
    ) || [];
  const selectionHandoff = selection
    ? `Shop for ${selection.title}. Selection ${selection.id}, revision ${selection.revision}.\n${need.map((line) => `${line.name}: ${line.buyQuantity ?? "quantity needs review"} ${line.unit}`).join("\n")}\nResolve product choices and pack sizes. Fill the Ocado basket, reconcile actual cart quantities, and return a receipt. Keep checkout manual.`
    : "";
  const handoff = basket ? serverHandoff : selectionHandoff;
  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>
            PI MEALS · THE RECIPE COMES FIRST
          </span>
          <h1>
            Good food.
            <br />
            One useful shop.
          </h1>
          <p>
            Pick what you want to cook. Bring the ingredients together.
            <br className={styles.desktop} /> Keep what you have, shop for what
            you need.
          </p>
          <div className={styles.heroLinks}>
            <a href="#recipe-library" className={styles.primary}>
              Shop these recipes <ArrowRight size={17} />
            </a>
            <Link href="/our-week" className={styles.secondary}>
              Our week <ArrowRight size={17} />
            </Link>
          </div>
        </div>
        <div className={styles.heroAside}>
          <ChefHat size={36} />
          <p>What sounds good?</p>
          <span>
            Your recipes, your servings,
            <br />
            your kitchen.
          </span>
        </div>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}{" "}
          <button disabled={busy} onClick={() => void run(load)}>
            Reload saved work
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {login ? (
        <form
          className={styles.panel}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await mealsApi.login(member, pin);
              setPin("");
              await load();
            });
          }}
        >
          <h2>Welcome to your kitchen</h2>
          <label>
            Who is cooking?{" "}
            <select value={member} onChange={(e) => setMember(e.target.value)}>
              <option>James</option>
              <option>Manon</option>
            </select>
          </label>
          <label>
            Household PIN{" "}
            <input
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </label>
          <button className={styles.primary} disabled={busy}>
            Sign in
          </button>
        </form>
      ) : (
        <>
          <div className={styles.toolbar}>
            <span>Signed in as {signedInName}</span>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await saveCachedShopping(null);
                  await mealsApi.logout();
                  setLogin(true);
                  setSelection(null);
                  setBasket(null);
                  setDrafts([]);
                })
              }
            >
              Sign out and clear offline list
            </button>
          </div>
          <div className={styles.selectionBar}>
            <div>
              <span className={styles.eyebrow}>YOUR SAVED SELECTION</span>
              <h2>{selection?.title || "Opening your kitchen…"}</h2>
              <small>Recipes and kitchen stock save as you go.</small>
            </div>
            <div className={styles.toolbar}>
              <select
                aria-label="Resume saved selection"
                disabled={busy}
                value={selection?.id || ""}
                onChange={(e) =>
                  void run(async () => {
                    setAssistant(null);
                    setSelection(await mealsApi.selection(e.target.value));
                    setBasket(null);
                  })
                }
              >
                {selection && !saved.some((row) => row.id === selection.id) && (
                  <option value={selection.id}>{selection.title}</option>
                )}
                {saved.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const created = await mealsApi.create();
                    setAssistant(null);
                    setSelection(created);
                    setSaved(await mealsApi.selections());
                    setBasket(null);
                  })
                }
              >
                <Plus size={16} />
                New selection
              </button>
            </div>
          </div>
          {selection && (
            <form
              className={styles.rename}
              onSubmit={(e) => {
                e.preventDefault();
                const title = new FormData(e.currentTarget).get(
                  "title",
                ) as string;
                void run(async () => {
                  await change({ type: "rename", title });
                  setSaved(await mealsApi.selections());
                });
              }}
            >
              <input
                disabled={busy}
                aria-label="Selection name"
                name="title"
                defaultValue={selection.title}
                key={selection.id + selection.title}
                required
                maxLength={120}
              />
              <button disabled={busy}>Save name</button>
            </form>
          )}
          {selection && (
            <section className={styles.assistant}>
              <div>
                <span className={styles.eyebrow}>
                  OPTIONAL KITCHEN ASSISTANT
                </span>
                <h3>Ask for a hand with this selection</h3>
                <p>
                  Try “we have 200g of rice” or “make the selected recipes serve
                  four”. Your recipe and shopping controls stay here.
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setAssistantError("");
                  void run(askAssistant);
                }}
              >
                <label>
                  Message
                  <input
                    value={assistantInput}
                    maxLength={12000}
                    onChange={(e) => setAssistantInput(e.target.value)}
                    placeholder="What would help with this shop?"
                    required
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    !assistantStatus?.available ||
                    (!!assistant &&
                      ["queued", "running"].includes(assistant.status) &&
                      !pollEnded)
                  }
                >
                  Ask assistant
                </button>
              </form>
              {assistantStatus && !assistantStatus.available && (
                <p role="status">
                  Assistant unavailable:{" "}
                  {assistantStatus.reason || assistantStatus.status}
                </p>
              )}
              {assistantError && (
                <p role="alert" className={styles.warning}>
                  {assistantError}
                </p>
              )}
              {assistant && (
                <div role="status" aria-live="polite">
                  <strong>
                    {assistant.status === "queued"
                      ? "Waiting to start"
                      : assistant.status === "running"
                        ? "Working on your selection"
                        : assistant.status}
                  </strong>
                  {assistant.message && (
                    <p className={styles.assistantMessage}>
                      {assistant.message}
                    </p>
                  )}
                  {pollEnded && (
                    <p>
                      Still working. Automatic checks have paused.{" "}
                      <button onClick={() => void run(checkAssistant)}>
                        Check progress
                      </button>
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
          <div className={styles.steps}>
            <span className={styles.activeStep}>01 · Pick recipes</span>
            <span>02 · Check the kitchen</span>
            <span>03 · Build the basket</span>
          </div>
          {!!selection?.items.length && (
            <section className={styles.panel}>
              <div className={styles.sectionTitle}>
                <h2>
                  On the menu <small>{selection.items.length} recipes</small>
                </h2>
                <a href="#shopping-list">See combined ingredients ↓</a>
              </div>
              <div className={styles.cards}>
                {selection.items.map((item) => (
                  <article className={styles.card} key={item.id}>
                    <RecipePhoto photo={item.photoUrl} name={item.name} />
                    <div className={styles.cardBody}>
                      <div className={styles.cardHeading}>
                        <h3>{item.name}</h3>
                        <button
                          aria-label={`Remove ${item.name}`}
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              change({
                                type: "replace_items",
                                items: selection.items.filter(
                                  (row) => row.id !== item.id,
                                ),
                              }),
                            )
                          }
                        >
                          <X size={16} />
                        </button>
                      </div>
                      {item.source && (
                        <a
                          href={safeSource(item.source)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Recipe source ↗
                        </a>
                      )}
                      <label className={styles.servings}>
                        Servings{" "}
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={item.servings}
                          disabled={busy}
                          onChange={(e) => {
                            const servings = Number(e.target.value);
                            if (servings > 0)
                              void run(() =>
                                change({
                                  type: "replace_items",
                                  items: selection.items.map((row) =>
                                    row.id === item.id
                                      ? { ...row, servings }
                                      : row,
                                  ),
                                }),
                              );
                          }}
                        />
                      </label>
                      {item.recipeId && (
                        <Link href={`/recipes/${item.recipeId}`}>
                          Open recipe & cook →
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <section id="recipe-library" className={styles.panel}>
            <div className={styles.sectionTitle}>
              <div>
                <span className={styles.eyebrow}>
                  START WITH SOMETHING YOU LOVE
                </span>
                <h2>Your recipe library</h2>
              </div>
              <div>
                <Link href="/recipes">All recipes ↗</Link>
                <a href="#recipe-intake">Import a recipe ↓</a>
                <Link href="/discover">Discover something new ↗</Link>
              </div>
            </div>
            <input
              className={styles.search}
              placeholder="Find a recipe…"
              aria-label="Search recipe library"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLibraryLimit(12);
              }}
            />
            <div className={styles.cards}>
              {library
                .filter((recipe) =>
                  recipe.name.toLowerCase().includes(search.toLowerCase()),
                )
                .slice(0, libraryLimit)
                .map((recipe) => (
                  <article className={styles.card} key={recipe.id}>
                    <RecipePhoto photo={recipe.photoUrl} name={recipe.name} />
                    <div className={styles.cardBody}>
                      <h3>{recipe.name}</h3>
                      <p>
                        {recipe.servings} servings · {recipe.cookTimeMinutes}{" "}
                        min
                      </p>
                      <button
                        className={styles.addButton}
                        disabled={
                          busy ||
                          !selection ||
                          selection.items.some(
                            (item) => item.recipeId === recipe.id,
                          )
                        }
                        onClick={() => void run(() => add(recipe))}
                      >
                        {selection?.items.some(
                          (item) => item.recipeId === recipe.id,
                        ) ? (
                          <>
                            <Check size={16} />
                            Selected
                          </>
                        ) : (
                          <>
                            <Plus size={16} />
                            Add to this shop
                          </>
                        )}
                      </button>
                    </div>
                  </article>
                ))}
            </div>
            {library.filter((recipe) =>
              recipe.name.toLowerCase().includes(search.toLowerCase()),
            ).length > libraryLimit && (
              <button onClick={() => setLibraryLimit((count) => count + 12)}>
                Show more recipes
              </button>
            )}
            {!busy && !library.length && (
              <p>
                Your library is ready for its first recipe. Add a link below or{" "}
                <Link href="/recipes/new">write your own</Link>.
              </p>
            )}
          </section>
          <section id="recipe-intake" className={styles.intake}>
            <div>
              <span className={styles.eyebrow}>FOUND A RECIPE ELSEWHERE?</span>
              <h2>Bring it into your kitchen.</h2>
              <p>
                NYT Cooking, Instagram, or a recipe page open in Aside. Preview
                the ingredients before you save.
              </p>
              <Link href="/import">Other import tools ↗</Link>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(preview);
              }}
            >
              <label>
                Recipe links{" "}
                <textarea
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                  placeholder="Paste one link per line. Each becomes its own recipe."
                  rows={3}
                />
              </label>
              <label>
                Recipe page or Instagram evidence{" "}
                <textarea
                  value={pageText}
                  onChange={(e) => setPageText(e.target.value)}
                  placeholder="Paste Aside page text, caption, transcript, or ingredient text…"
                  rows={4}
                />
              </label>
              <button className={styles.primary} disabled={busy}>
                {busy ? "Working…" : "Preview recipes"} <ArrowRight size={16} />
              </button>
            </form>
          </section>
          {drafts.map((draft) => (
            <details key={draft.id} className={styles.panel}>
              <summary>{draft.name} · imported recipe preview</summary>
              <DraftEditor
                draft={draft}
                busy={busy}
                onChange={(value) =>
                  setDrafts((rows) =>
                    rows.map((row) => (row.id === value.id ? value : row)),
                  )
                }
                onSave={() => void run(() => saveDraft(draft))}
                onUse={() => void run(() => addDraftToShop(draft))}
              />
            </details>
          ))}
          <section id="shopping-list" className={styles.panel}>
            <div className={styles.sectionTitle}>
              <div>
                <span className={styles.eyebrow}>CHECK THE KITCHEN</span>
                <h2>One ingredient list</h2>
              </div>
              <span>{need.length} ingredients to shop</span>
            </div>
            {!selection?.lines.length ? (
              <p>Choose a recipe to see its ingredients here.</p>
            ) : (
              selection.lines.map((line) => (
                <div className={styles.ingredient} key={line.id}>
                  <div>
                    <h3>{line.name}</h3>
                    <p>
                      Recipe total: {line.quantity ?? "Check quantity"}{" "}
                      {line.unit} · Have: {line.haveQuantity} {line.unit}
                    </p>
                    <details>
                      <summary>
                        From {line.sources.length} recipe
                        {line.sources.length === 1 ? "" : "s"}
                      </summary>
                      {line.sources.map((source) => (
                        <p key={source.itemId}>
                          {source.name}: {source.quantity ?? "unspecified"}{" "}
                          {line.unit}
                        </p>
                      ))}
                    </details>
                    {line.warnings.map((warning) => (
                      <p className={styles.warning} key={warning}>
                        {warning}
                      </p>
                    ))}
                  </div>
                  <div className={styles.stock}>
                    <strong>
                      {line.buyQuantity === 0
                        ? "Already have it"
                        : `Buy ${line.buyQuantity ?? "—"} ${line.unit}`}
                    </strong>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            change({ type: "have_all", lineId: line.id }),
                          )
                        }
                      >
                        {line.quantity === null ? "Have enough" : "Have all"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            change({
                              type: "set_stock",
                              lineId: line.id,
                              quantity: 0,
                              unit: line.unit,
                            }),
                          )
                        }
                      >
                        Reset
                      </button>
                    </div>
                    <form
                      hidden={line.quantity === null}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const quantity = Number(
                          new FormData(e.currentTarget).get("quantity"),
                        );
                        void run(() =>
                          change({
                            type: "set_stock",
                            lineId: line.id,
                            quantity,
                            unit: line.unit,
                          }),
                        );
                      }}
                    >
                      <input
                        aria-label={`Amount of ${line.name} already at home`}
                        name="quantity"
                        type="number"
                        min="0"
                        step="any"
                        defaultValue={line.haveQuantity}
                        key={line.haveQuantity}
                      />
                      <span>{line.unit}</span>
                      <button disabled={busy}>Have amount</button>
                    </form>
                  </div>
                </div>
              ))
            )}
          </section>
          {selection && (
            <>
              <ManualExtras
                selection={selection}
                disabled={busy}
                onChange={(c) => run(() => change(c))}
              />
              {undoStock &&
                undoStock.selectionId === selection.id &&
                undoStock.revision === selection.revision && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setSelection(
                          await mealsApi.command(selection, undoStock.command),
                        );
                        setUndoStock(null);
                        setBasket(null);
                      })
                    }
                  >
                    Undo last stock change
                  </button>
                )}
              <ShoppingCycle selection={selection} />
            </>
          )}
          <section className={styles.basket}>
            <div>
              <ShoppingBasket size={28} />
              <h2>Ready for the shop?</h2>
              <p>
                Review product choices and pack sizes, then fill your Ocado
                basket. Checkout stays in your hands.
              </p>
              <div className={styles.toolbar}>
                <button
                  className={styles.primary}
                  disabled={busy || !selection || !need.length}
                  onClick={() =>
                    void run(async () => {
                      if (selection)
                        setBasket(await mealsApi.basket(selection.id, "ocado"));
                    })
                  }
                >
                  Prepare Ocado basket
                </button>
                <button
                  disabled={busy || !selection || !need.length}
                  onClick={() =>
                    void run(async () => {
                      if (selection)
                        setBasket(await mealsApi.basket(selection.id, "aside"));
                    })
                  }
                >
                  Use Aside
                </button>
              </div>
            </div>
            {basket && (
              <div className={styles.basketReview}>
                <h3>Basket: {basket.status.replace("_", " ")}</h3>
                {basket.unresolved.map((reason, index) => (
                  <p className={styles.warning} key={index}>
                    {reason}
                  </p>
                ))}
                <ProductPicker
                  basket={basket}
                  key={basket.id}
                  onUpdated={(updated) =>
                    setBasket((current) =>
                      current?.id === updated.id &&
                      current.revision <= updated.revision
                        ? updated
                        : current,
                    )
                  }
                  disabled={busy}
                />
                <div className={styles.toolbar}>
                  <button
                    disabled={
                      busy ||
                      basket.status !== "ready" ||
                      basket.executor !== "ocado"
                    }
                    onClick={() =>
                      void run(async () => {
                        if (selection)
                          setBasket(
                            await mealsApi.fill(basket, selection.revision),
                          );
                      })
                    }
                  >
                    Fill basket
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setBasket(await mealsApi.reconcile(basket)),
                      )
                    }
                  >
                    Check actual cart
                  </button>
                </div>
                <p>
                  {basket.status === "complete"
                    ? typeof basket.receipt === "object" &&
                      basket.receipt !== null &&
                      "verification" in basket.receipt &&
                      basket.receipt.verification === "user"
                      ? "You confirmed the trolley after reviewing it in Aside. Checkout stays manual."
                      : "Cart quantities matched the reviewed products. Checkout stays manual."
                    : "Cart additions are not yet verified. Review unresolved items and check the actual cart."}
                </p>
                {basket.receipt != null && (
                  <details>
                    <summary>Cart receipt</summary>
                    <pre>{JSON.stringify(basket.receipt, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}
            <details>
              <summary>Aside shopping handoff</summary>
              <textarea
                aria-label="Aside shopping handoff"
                readOnly
                value={handoff}
                rows={8}
              />
              {handoffError && (
                <p role="alert" className={styles.warning}>
                  {handoffError}
                </p>
              )}
              {basket && !serverHandoff && !handoffError && (
                <p>Loading exact basket handoff…</p>
              )}
              <button
                disabled={!handoff}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(handoff);
                    setNotice("Shopping handoff copied.");
                  })
                }
              >
                Copy handoff
              </button>
            </details>
          </section>
        </>
      )}
      <div role="status" aria-live="polite" className={styles.loading}>
        {busy ? "Saving or loading your kitchen…" : ""}
      </div>
    </div>
  );
}
function safeSource(source: string) {
  return /^https?:\/\//i.test(source) ? source : undefined;
}
function RecipePhoto({ photo, name }: { photo?: string; name: string }) {
  return (
    <div className={styles.photo}>
      {photo ? (
        <img src={photo} alt={name} loading="lazy" />
      ) : (
        <div className={styles.photoPlaceholder}>
          <ChefHat size={38} />
          <span>From your kitchen</span>
        </div>
      )}
    </div>
  );
}
function DraftEditor({
  draft,
  busy,
  onChange,
  onSave,
  onUse,
}: {
  draft: RecipeDraft;
  busy: boolean;
  onChange: (draft: RecipeDraft) => void;
  onSave: () => void;
  onUse: () => void;
}) {
  return (
    <section className={styles.panel}>
      <fieldset disabled={busy}>
        <span className={styles.eyebrow}>RECIPE PREVIEW · {draft.status}</span>
        <h2>Make this recipe yours</h2>
        {draft.gaps.map((gap, index) => (
          <p className={styles.warning} key={index}>
            {gap}
          </p>
        ))}
        <label>
          Recipe name
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Base yield · choose one number from any source range
          <input
            type="number"
            min="1"
            value={draft.servings ?? ""}
            onChange={(e) =>
              onChange({
                ...draft,
                servings: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        <h3>Ingredients</h3>
        {draft.ingredients.map((ingredient, index) => (
          <div className={styles.draftRow} key={index}>
            <input
              aria-label={`Ingredient ${index + 1} name`}
              value={ingredient.name}
              onChange={(e) =>
                onChange({
                  ...draft,
                  ingredients: draft.ingredients.map((row, i) =>
                    i === index ? { ...row, name: e.target.value } : row,
                  ),
                })
              }
            />
            <input
              aria-label={`Ingredient ${index + 1} quantity`}
              type="number"
              step="any"
              value={ingredient.quantity ?? ""}
              onChange={(e) =>
                onChange({
                  ...draft,
                  ingredients: draft.ingredients.map((row, i) =>
                    i === index
                      ? {
                          ...row,
                          quantity: e.target.value
                            ? Number(e.target.value)
                            : null,
                        }
                      : row,
                  ),
                })
              }
            />
            <input
              aria-label={`Ingredient ${index + 1} unit`}
              value={ingredient.unit}
              onChange={(e) =>
                onChange({
                  ...draft,
                  ingredients: draft.ingredients.map((row, i) =>
                    i === index ? { ...row, unit: e.target.value } : row,
                  ),
                })
              }
            />
            <button
              aria-label={`Remove ingredient ${index + 1}`}
              onClick={() =>
                onChange({
                  ...draft,
                  ingredients: draft.ingredients.filter((_, i) => i !== index),
                })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            onChange({
              ...draft,
              ingredients: [
                ...draft.ingredients,
                { name: "", quantity: null, unit: "" },
              ],
            })
          }
        >
          Add ingredient
        </button>
        <label>
          Instructions · one step per line
          <textarea
            rows={5}
            value={draft.instructions.join("\n")}
            onChange={(e) =>
              onChange({ ...draft, instructions: e.target.value.split("\n") })
            }
          />
        </label>
        <details>
          <summary>Source evidence</summary>
          {draft.evidence.map((line, index) => (
            <p key={index}>
              <strong>{line.source}:</strong> {line.text}
            </p>
          ))}
        </details>
        <button
          className={styles.primary}
          disabled={
            busy ||
            !draft.servings ||
            !draft.ingredients.length ||
            !draft.name.trim()
          }
          onClick={onUse}
        >
          Use this draft in this shop
        </button>
        <button
          disabled={
            busy ||
            draft.status === "saved" ||
            !draft.servings ||
            draft.ingredients.some((row) => row.quantity === null)
          }
          onClick={onSave}
        >
          {draft.status === "saved"
            ? "Saved to your library"
            : "Save to library & add to this shop"}
        </button>
      </fieldset>
    </section>
  );
}
