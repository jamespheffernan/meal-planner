"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  BookOpen,
  Link2,
  Search,
  ChevronRight,
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
  type AsideRecipeTab,
} from "@/lib/pi-meals-api";
import styles from "./workspace.module.css";
import { formatQuantity } from "@/lib/pi-meals-format";
import { ProductPicker } from "./product-picker";
import { productsApi } from "@/lib/pi-meals-products-api";
import { ShoppingCycle } from "./shopping-cycle";
import { ManualExtras } from "./manual-extras";
import { saveCachedShopping } from "@/lib/pi-meals-shopping-api";

function keepActiveBasket(current: BasketProposal | null) {
  return current?.receipt && current.status !== "complete" ? current : null;
}

export function MealsWorkspace() {
  const [libraryLimit, setLibraryLimit] = useState(12);
  const [view, setView] = useState<"recipes" | "kitchen" | "shop">("recipes");
  const [importOpen, setImportOpen] = useState(false);
  const [selectionExpanded, setSelectionExpanded] = useState(false);
  const [latestDraftId, setLatestDraftId] = useState<string | null>(null);
  const [asideTabs, setAsideTabs] = useState<AsideRecipeTab[] | null>(null);
  const [chosenAsideUrls, setChosenAsideUrls] = useState<string[]>([]);
  const [dirtyDrafts, setDirtyDrafts] = useState<Set<string>>(new Set());
  const [basketLoading, setBasketLoading] = useState(false);
  const [stockFilter, setStockFilter] = useState<"all" | "needed" | "covered">(
    "all",
  );
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
  const [requiresLogin, setRequiresLogin] = useState(true);
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
  const actionInFlight = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (e instanceof MealsApiError && e.status === 401) setLogin(true);
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  }, []);
  const load = useCallback(async () => {
    const memberSession = await mealsApi.session();
    setSignedInName(memberSession.name);
    setRequiresLogin(memberSession.requiresLogin !== false);
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
    if (!dirtyDrafts.size) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyDrafts]);
  useEffect(() => {
    if (!selectionId) return;
    let cancelled = false;
    setBasketLoading(true);
    void mealsApi
      .baskets(selectionId)
      .then((rows) => {
        if (!cancelled)
          setBasket(
            rows.find((row) => !!row.receipt && row.status !== "complete") ||
              rows[0] ||
              null,
          );
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Could not load your saved trolley task.",
          );
      })
      .finally(() => {
        if (!cancelled) setBasketLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectionId]);
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
          setBasket(keepActiveBasket);
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
  function openView(next: "recipes" | "kitchen" | "shop") {
    setView(next);
    requestAnimationFrame(() =>
      document
        .getElementById("shop-navigation")
        ?.scrollIntoView({ block: "start" }),
    );
  }
  function showImports() {
    setImportOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById("recipe-intake")
        ?.scrollIntoView({ block: "start" }),
    );
  }
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
        setBasket(keepActiveBasket);
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
      setBasket(keepActiveBasket);
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
    setBasket(keepActiveBasket);
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
      setDrafts((prev) =>
        dirtyDrafts.has(result.id)
          ? prev
          : [...prev.filter((d) => d.id !== result.id), result],
      );
      setLatestDraftId(result.id);
    }
    if (!urls.length || (urls.length > 1 && pageText.trim())) {
      const result = await mealsApi.intake(undefined, pageText);
      setDrafts((prev) =>
        dirtyDrafts.has(result.id)
          ? prev
          : [...prev.filter((d) => d.id !== result.id), result],
      );
      setLatestDraftId(result.id);
    }
    setLinks("");
    setPageText("");
    setNotice(
      "Recipes saved as drafts. You can close this page and return later.",
    );
  }
  async function findAsideTabs() {
    const { tabs } = await mealsApi.asideTabs();
    setAsideTabs(tabs);
    setChosenAsideUrls(tabs.slice(0, 20).map((tab) => tab.url));
  }
  async function importAsideTabs() {
    const result = await mealsApi.importAside(chosenAsideUrls);
    setDrafts((previous) => [
      ...previous.filter(
        (draft) => !result.drafts.some((row) => row.id === draft.id),
      ),
      ...result.drafts.map((draft) =>
        dirtyDrafts.has(draft.id)
          ? previous.find((row) => row.id === draft.id) || draft
          : draft,
      ),
    ]);
    setLatestDraftId(result.drafts.at(-1)?.id ?? null);
    setNotice(
      `${result.drafts.length} recipe${result.drafts.length === 1 ? "" : "s"} saved as drafts.`,
    );
    if (result.failures.length)
      throw new Error(
        result.failures.map((failure) => failure.message).join(" "),
      );
    setAsideTabs(null);
    setChosenAsideUrls([]);
  }
  async function persistDraft(draft: RecipeDraft) {
    const edited = await mealsApi.editDraft(draft);
    setDrafts((rows) =>
      rows.map((row) => (row.id === draft.id ? edited : row)),
    );
    setDirtyDrafts((current) => {
      const next = new Set(current);
      next.delete(draft.id);
      return next;
    });
    return edited;
  }
  async function addDraftToShop(draft: RecipeDraft) {
    draftSnapshot(draft);
    const edited = await persistDraft(draft);
    if (selection)
      await change({
        type: "replace_items",
        items: [...selection.items, draftSnapshot(edited)],
      });
  }
  async function saveDraft(draft: RecipeDraft) {
    const edited = await persistDraft(draft);
    const stored = await mealsApi.saveDraft(edited);
    setDrafts((prev) =>
      prev.map((row) => (row.id === draft.id ? stored : row)),
    );
    if (stored.recipeId) {
      setLibrary(await mealsApi.library());
      setNotice(`${stored.name} saved to your recipe library.`);
    }
  }
  async function startAsideShop() {
    if (!selection) return;
    const previous = await mealsApi.baskets(selection.id);
    const existing = previous.find(
      (row) =>
        row.executor === "aside" && !!row.receipt && row.status !== "complete",
    );
    if (existing) {
      setBasket(existing);
      setNotice("Your existing Aside shopping task is below.");
      return;
    }
    const prepared = await mealsApi.basket(selection.id, "aside");
    setBasket(prepared);
    try {
      const launched = await productsApi.aside(prepared);
      setBasket(launched);
      const receipt = launched.receipt as
        { sessionId?: string; error?: string } | undefined;
      if (receipt?.error) throw new Error(receipt.error);
      if (!receipt?.sessionId)
        throw new Error(
          "Aside has not confirmed its task identity. Refresh this task’s status before continuing.",
        );
      setNotice(
        "Aside has your shopping list. Follow the task in Aside, then review your trolley here.",
      );
    } catch (error) {
      // A lost HTTP reply must recover the recorded launch, never start another task.
      setBasket(await mealsApi.getBasket(prepared.id).catch(() => prepared));
      throw error;
    }
  }
  const need =
    selection?.lines.filter(
      (line) => line.buyQuantity === null || line.buyQuantity > 0,
    ) || [];
  const recipes =
    selection?.items.filter(
      (item) =>
        item.recipeId || item.draftId || !item.id.startsWith("routine:"),
    ) || [];
  const extras =
    selection?.items.filter(
      (item) =>
        !item.recipeId && !item.draftId && item.id.startsWith("routine:"),
    ) || [];
  const covered =
    selection?.lines.filter((line) => line.buyQuantity === 0).length || 0;
  const visibleLines =
    selection?.lines.filter(
      (line) =>
        stockFilter === "all" ||
        (stockFilter === "covered"
          ? line.buyQuantity === 0
          : line.buyQuantity !== 0),
    ) || [];
  const selectionHandoff = selection
    ? `Shop for ${selection.title}. Selection ${selection.id}, revision ${selection.revision}.\n${need.map((line) => `${line.name}: ${line.buyQuantity ?? "quantity needs review"} ${line.unit}`).join("\n")}\nResolve product choices and pack sizes. Fill the Ocado basket, reconcile actual cart quantities, and return a receipt. Keep checkout manual.`
    : "";
  const handoff = basket ? serverHandoff : selectionHandoff;
  return (
    <div className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div>
          <h1>
            {login
              ? "Your kitchen"
              : selection?.title || "Opening your kitchen…"}
          </h1>
          <p>
            {login
              ? "Sign in to your shared recipes and shopping list."
              : `${recipes.length} recipes · ${need.length} ingredients to shop · Saved as you go`}
          </p>
        </div>
        {!login && (
          <details className={styles.manage}>
            <summary>
              Saved shops <ChevronRight size={15} />
            </summary>
            <div className={styles.manageContent}>
              <label>
                Open a saved shop
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
                  {selection &&
                    !saved.some((row) => row.id === selection.id) && (
                      <option value={selection.id}>{selection.title}</option>
                    )}
                  {saved.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.title}
                    </option>
                  ))}
                </select>
              </label>
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
                  <label>
                    Shop name
                    <input
                      disabled={busy}
                      name="title"
                      defaultValue={selection.title}
                      key={selection.id + selection.title}
                      required
                      maxLength={120}
                    />
                  </label>
                  <button disabled={busy}>Rename</button>
                </form>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const created = await mealsApi.create();
                    setAssistant(null);
                    setSelection(created);
                    setSaved(await mealsApi.selections());
                    setBasket(null);
                    openView("recipes");
                  })
                }
              >
                <Plus size={16} />
                New shop
              </button>
              <div className={styles.account}>
                <span>
                  {requiresLogin
                    ? `Signed in as ${signedInName}`
                    : "Shared kitchen"}
                </span>
                {requiresLogin && (
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
                    Sign out & clear offline list
                  </button>
                )}
              </div>
            </div>
          </details>
        )}
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
            Household member{" "}
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
          <nav
            id="shop-navigation"
            className={styles.views}
            aria-label="Plan this shop"
          >
            <button
              aria-pressed={view === "recipes"}
              aria-controls="recipes-view"
              onClick={() => openView("recipes")}
            >
              <BookOpen size={17} />
              Recipes <span>{recipes.length}</span>
            </button>
            <button
              aria-pressed={view === "kitchen"}
              aria-controls="kitchen-view"
              onClick={() => openView("kitchen")}
            >
              <Check size={17} />
              Check the kitchen{" "}
              <span>
                {covered}/{selection?.lines.length || 0}
              </span>
            </button>
            <button
              aria-pressed={view === "shop"}
              aria-controls="shop-view"
              onClick={() => openView("shop")}
            >
              <ShoppingBasket size={17} />
              Shop <span>{need.length}</span>
            </button>
          </nav>
          {selection && (
            <section className={styles.assistant}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setAssistantError("");
                  void run(askAssistant);
                }}
              >
                <label>
                  <span className={styles.srOnly}>
                    Ask the kitchen assistant
                  </span>
                  <input
                    value={assistantInput}
                    maxLength={12000}
                    onChange={(e) => setAssistantInput(e.target.value)}
                    placeholder="Try “we have 200g of rice” or “make these serve four”…"
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
                  Ask
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

          <div id="recipes-view" hidden={view !== "recipes"}>
            <section
              id="recipe-intake"
              className={styles.intake}
              hidden={!importOpen}
            >
              <div>
                <div className={styles.sectionTitle}>
                  <h2>Import recipes</h2>
                  <button
                    onClick={() => setImportOpen(false)}
                    aria-label="Close recipe import"
                  >
                    <X size={16} />
                  </button>
                </div>
                <p>
                  Paste an NYT or Instagram link, or bring in the NYT recipes
                  you already have open in Aside. Every import is saved as a
                  draft.
                </p>
                <button disabled={busy} onClick={() => void run(findAsideTabs)}>
                  Find recipes open in Aside
                </button>
                {asideTabs !== null && (
                  <div className={styles.asideTabs}>
                    {asideTabs.length === 0 ? (
                      <p>
                        No NYT recipe tabs are open in Aside. Paste a link here
                        and we’ll open and read it for you.
                      </p>
                    ) : (
                      <>
                        {asideTabs.length > 20 && (
                          <p>
                            Select up to 20 recipes at a time. The first 20 are
                            selected.
                          </p>
                        )}
                        {asideTabs.map((tab) => (
                          <label key={tab.targetId}>
                            <input
                              type="checkbox"
                              checked={chosenAsideUrls.includes(tab.url)}
                              disabled={
                                busy ||
                                (!chosenAsideUrls.includes(tab.url) &&
                                  chosenAsideUrls.length >= 20)
                              }
                              onChange={(event) =>
                                setChosenAsideUrls((urls) =>
                                  event.target.checked
                                    ? [...urls, tab.url]
                                    : urls.filter((url) => url !== tab.url),
                                )
                              }
                            />
                            <span>{tab.title}</span>
                          </label>
                        ))}
                        <button
                          className={styles.primary}
                          disabled={busy || !chosenAsideUrls.length}
                          onClick={() => void run(importAsideTabs)}
                        >
                          Import {chosenAsideUrls.length} recipe
                          {chosenAsideUrls.length === 1 ? "" : "s"}
                        </button>
                      </>
                    )}
                  </div>
                )}
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
                <details className={styles.sourceText}>
                  <summary>Add your own recipe text or extra details</summary>
                  <label>
                    Recipe text{" "}
                    <textarea
                      value={pageText}
                      onChange={(e) => setPageText(e.target.value)}
                      placeholder="Paste Aside page text, caption, transcript, or ingredient text…"
                      rows={4}
                    />
                  </label>
                </details>
                <button className={styles.primary} disabled={busy}>
                  {busy ? "Importing…" : "Import & save drafts"}{" "}
                  <ArrowRight size={16} />
                </button>
              </form>
              {drafts.length > 0 && (
                <div className={styles.draftList}>
                  <h3>Imported drafts · {drafts.length}</h3>
                  <p>
                    Saved in your shared kitchen, including incomplete recipes.
                    Move finished recipes to your library whenever you’re ready.
                  </p>
                  {drafts.map((draft) => (
                    <details
                      key={draft.id}
                      className={styles.draft}
                      open={latestDraftId === draft.id}
                      onToggle={(event) => {
                        if (event.currentTarget.open)
                          setLatestDraftId(draft.id);
                        else if (latestDraftId === draft.id)
                          setLatestDraftId(null);
                      }}
                    >
                      <summary>{draft.name}</summary>
                      <DraftEditor
                        draft={draft}
                        busy={busy}
                        dirty={dirtyDrafts.has(draft.id)}
                        onChange={(value) => {
                          setDirtyDrafts((current) =>
                            new Set(current).add(value.id),
                          );
                          setDrafts((rows) =>
                            rows.map((row) =>
                              row.id === value.id ? value : row,
                            ),
                          );
                        }}
                        onSaveChanges={() =>
                          void run(async () => {
                            await persistDraft(draft);
                            setNotice("Draft changes saved.");
                          })
                        }
                        onSave={() => void run(() => saveDraft(draft))}
                        onUse={() => void run(() => addDraftToShop(draft))}
                      />
                    </details>
                  ))}
                </div>
              )}
            </section>

            <div className={styles.recipeWorkspace}>
              <section id="recipe-library" className={styles.library}>
                <div className={styles.sectionTitle}>
                  <div>
                    <h2>What looks good?</h2>
                    <p>Choose from your recipes, or bring in a new one.</p>
                  </div>
                  <button
                    aria-expanded={importOpen}
                    aria-controls="recipe-intake"
                    onClick={() =>
                      importOpen ? setImportOpen(false) : showImports()
                    }
                  >
                    <Link2 size={16} /> Import a recipe
                  </button>
                </div>
                <div className={styles.searchBar}>
                  <Search size={18} aria-hidden="true" />
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
                </div>
                <div className={styles.libraryMeta}>
                  <span>
                    {
                      library.filter((recipe) =>
                        recipe.name
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      ).length
                    }{" "}
                    recipes
                  </span>
                  <Link href="/discover">
                    Find something new <ArrowRight size={14} />
                  </Link>
                </div>
                <div className={styles.cards}>
                  {library
                    .filter((recipe) =>
                      recipe.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .slice(0, libraryLimit)
                    .map((recipe) => (
                      <article className={styles.card} key={recipe.id}>
                        <RecipePhoto
                          photo={recipe.photoUrl}
                          name={recipe.name}
                        />
                        <div className={styles.cardBody}>
                          <h3>{recipe.name}</h3>
                          <p>
                            {recipe.servings} servings ·{" "}
                            {recipe.cookTimeMinutes} min
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
                                Add
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
                  <button
                    onClick={() => setLibraryLimit((count) => count + 12)}
                  >
                    Show more recipes
                  </button>
                )}
                {!busy &&
                  library.length > 0 &&
                  !library.some((recipe) =>
                    recipe.name.toLowerCase().includes(search.toLowerCase()),
                  ) && (
                    <p className={styles.empty}>
                      No recipes match “{search}”. Try another name or import a
                      recipe.
                    </p>
                  )}
                {!busy && !library.length && (
                  <p>
                    Your library is ready for its first recipe. Import a link or{" "}
                    <Link href="/recipes/new">write your own</Link>.
                  </p>
                )}
              </section>

              <aside className={styles.selectionRail}>
                <div className={styles.sectionTitle}>
                  <h2>This shop</h2>
                  <span className={styles.desktopCount}>
                    {recipes.length} recipes
                  </span>
                  <button
                    className={styles.mobileSelectionToggle}
                    aria-expanded={selectionExpanded}
                    aria-controls="chosen-recipes"
                    onClick={() => setSelectionExpanded(!selectionExpanded)}
                  >
                    {selectionExpanded
                      ? "Hide meals"
                      : `Show ${recipes.length} meals`}
                    <ChevronRight size={15} />
                  </button>
                </div>
                {!recipes.length && (
                  <p className={styles.empty}>
                    Pick a few meals you fancy. Their ingredients will come
                    together in one list.
                  </p>
                )}
                <button
                  className={styles.primary}
                  disabled={!selection?.lines.length}
                  onClick={() => openView("kitchen")}
                >
                  Check the kitchen <ArrowRight size={16} />
                </button>
                <p className={styles.railHint}>
                  {selection?.lines.length || 0} combined ingredients. Cross off
                  what you have.
                </p>
                <div
                  id="chosen-recipes"
                  className={`${styles.selectionDetails} ${selectionExpanded ? styles.selectionExpanded : ""}`}
                >
                  <div className={styles.chosenRecipes}>
                    {recipes.map((item) => (
                      <article className={styles.chosenRecipe} key={item.id}>
                        <div className={styles.chosenHeading}>
                          {item.photoUrl && (
                            <img
                              className={styles.chosenPhoto}
                              src={item.photoUrl}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <div>
                            <h3>{item.name}</h3>
                            {item.source && (
                              <a
                                href={safeSource(item.source)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {sourceLabel(item.source)} ↗
                              </a>
                            )}
                          </div>
                          <button
                            aria-label={`Remove ${item.name}`}
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                change({
                                  type: "replace_items",
                                  items: selection!.items.filter(
                                    (row) => row.id !== item.id,
                                  ),
                                }),
                              )
                            }
                          >
                            <X size={15} />
                          </button>
                        </div>
                        <div className={styles.chosenFooter}>
                          <label className={styles.servings}>
                            Servings
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
                                      items: selection!.items.map((row) =>
                                        row.id === item.id
                                          ? { ...row, servings }
                                          : row,
                                      ),
                                    }),
                                  );
                              }}
                            />
                          </label>
                          {item.recipeId ? (
                            <Link href={`/recipes/${item.recipeId}`}>
                              Cook recipe <ArrowRight size={13} />
                            </Link>
                          ) : (
                            <span>{item.ingredients.length} ingredients</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {extras.length > 0 && (
                    <details>
                      <summary>
                        {extras.length} shopping extra
                        {extras.length === 1 ? "" : "s"}
                      </summary>
                      {extras.map((item) => (
                        <div className={styles.extra} key={item.id}>
                          <span>{item.name}</span>
                          <button
                            disabled={busy}
                            aria-label={`Remove ${item.name}`}
                            onClick={() =>
                              void run(() =>
                                change({
                                  type: "replace_items",
                                  items: selection!.items.filter(
                                    (row) => row.id !== item.id,
                                  ),
                                }),
                              )
                            }
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </details>
                  )}
                </div>
                {drafts.length > 0 && (
                  <button
                    className={styles.textButton}
                    onClick={() => {
                      showImports();
                    }}
                  >
                    Review {drafts.length} imported drafts
                  </button>
                )}
              </aside>
            </div>
          </div>
          <section
            id="kitchen-view"
            className={styles.kitchen}
            hidden={view !== "kitchen"}
          >
            <div className={styles.sectionTitle}>
              <div>
                <h2>What do you already have?</h2>
                <p>
                  All your recipes, combined. Tick anything you have enough of.
                </p>
              </div>
              <button
                className={styles.primary}
                disabled={!selection?.lines.length}
                onClick={() => openView("shop")}
              >
                Shop {need.length} ingredients <ArrowRight size={16} />
              </button>
            </div>
            <div className={styles.listTools}>
              <div className={styles.filters} aria-label="Filter ingredients">
                <button
                  aria-pressed={stockFilter === "all"}
                  onClick={() => setStockFilter("all")}
                >
                  All {selection?.lines.length || 0}
                </button>
                <button
                  aria-pressed={stockFilter === "needed"}
                  onClick={() => setStockFilter("needed")}
                >
                  To buy {need.length}
                </button>
                <button
                  aria-pressed={stockFilter === "covered"}
                  onClick={() => setStockFilter("covered")}
                >
                  Have it {covered}
                </button>
              </div>
              {undoStock &&
                selection &&
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
                        setBasket(keepActiveBasket);
                      })
                    }
                  >
                    Undo last change
                  </button>
                )}
            </div>
            {!selection?.lines.length ? (
              <p className={styles.empty}>
                Choose a recipe to see its ingredients here.
              </p>
            ) : !visibleLines.length ? (
              <p className={styles.empty}>
                {stockFilter === "covered"
                  ? "Nothing ticked off yet."
                  : "Everything on this list is covered."}
              </p>
            ) : (
              <div className={styles.ingredientList}>
                {visibleLines.map((line) => (
                  <div
                    className={`${styles.ingredient} ${line.buyQuantity === 0 ? styles.covered : ""}`}
                    key={line.id}
                  >
                    <div className={styles.ingredientMain}>
                      <button
                        className={styles.haveButton}
                        aria-label={`${line.buyQuantity === 0 ? "Put back on shopping list" : "Have enough"}: ${line.name}`}
                        aria-pressed={line.buyQuantity === 0}
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            change(
                              line.buyQuantity === 0
                                ? {
                                    type: "set_stock",
                                    lineId: line.id,
                                    quantity: 0,
                                    unit: line.unit,
                                  }
                                : { type: "have_all", lineId: line.id },
                            ),
                          )
                        }
                      >
                        <Check size={17} />
                      </button>
                      <div>
                        <h3>{line.name}</h3>
                        <span>
                          {formatQuantity(line.quantity, line.unit)} in your
                          recipes
                        </span>
                      </div>
                      <strong>
                        {line.buyQuantity === 0
                          ? "Have it"
                          : line.buyQuantity === null
                            ? "Check amount"
                            : `Buy ${formatQuantity(line.buyQuantity, line.unit)}`}
                      </strong>
                    </div>
                    <details className={styles.ingredientDetails}>
                      <summary>
                        {line.haveQuantity > 0 && line.buyQuantity !== 0
                          ? `Have ${formatQuantity(line.haveQuantity, line.unit)} · change amount`
                          : "Have some, or check recipes"}
                      </summary>
                      <div className={styles.ingredientDetailBody}>
                        <div>
                          {line.sources.map((source) => (
                            <p key={source.itemId}>
                              {source.name}:{" "}
                              {formatQuantity(source.quantity, line.unit)}
                            </p>
                          ))}
                          {line.quantity === null && (
                            <p>
                              Check the amount in the recipe, or tick this item
                              if you have enough.
                            </p>
                          )}
                        </div>
                        {line.quantity !== null && (
                          <form
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
                            <label>
                              Already have ({line.unit || "amount"})
                              <input
                                name="quantity"
                                aria-label={`Amount of ${line.name} already at home`}
                                type="number"
                                min="0"
                                step="any"
                                defaultValue={line.haveQuantity}
                                key={line.haveQuantity}
                                disabled={busy}
                                required
                              />
                            </label>
                            <button disabled={busy}>Save amount</button>
                          </form>
                        )}
                      </div>
                    </details>
                    {line.warnings.map((warning) => (
                      <p className={styles.warning} key={warning}>
                        {warning}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
          <div id="shop-view" hidden={view !== "shop"}>
            <section className={styles.basket}>
              <div>
                <h2>Send the list to Ocado</h2>
                <p>
                  Aside chooses products and pack sizes, then adds what you need
                  to your Ocado trolley. Review it before placing your order.
                </p>
                <div className={styles.toolbar}>
                  <button
                    className={styles.primary}
                    disabled={
                      busy ||
                      basketLoading ||
                      !selection ||
                      !need.length ||
                      (!!basket?.receipt && basket.status !== "complete")
                    }
                    onClick={() => void run(startAsideShop)}
                  >
                    Shop with Aside <ArrowRight size={16} />
                  </button>
                  <button
                    disabled={
                      busy ||
                      basketLoading ||
                      !selection ||
                      !need.length ||
                      (!!basket?.receipt && basket.status !== "complete")
                    }
                    onClick={() =>
                      void run(async () => {
                        if (selection)
                          setBasket(
                            await mealsApi.basket(selection.id, "ocado"),
                          );
                      })
                    }
                  >
                    Choose products myself
                  </button>
                </div>
              </div>
              {basket && (
                <div className={styles.basketReview}>
                  {!!basket.receipt &&
                    basket.status !== "complete" &&
                    basket.selectionRevision !== selection?.revision && (
                      <p className={styles.warning}>
                        This shopping task uses an earlier version of your list.
                        Stop it and review the trolley before starting an
                        updated shop.
                      </p>
                    )}
                  {basket.executor !== "aside" && (
                    <h3>Basket: {basket.status.replace("_", " ")}</h3>
                  )}
                  {basket.executor !== "aside" &&
                    basket.unresolved.map((reason, index) => (
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
                  {basket.executor !== "aside" && (
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
                  )}
                  {basket.executor !== "aside" && (
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
                  )}
                  {basket.receipt != null && (
                    <details>
                      <summary>Cart receipt</summary>
                      <pre>{JSON.stringify(basket.receipt, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
              <details>
                <summary>View the shopping instructions sent to Aside</summary>
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
              </details>
            </section>
            {selection && (
              <div className={styles.shopList}>
                <ShoppingCycle selection={selection} />
                <ManualExtras
                  selection={selection}
                  disabled={busy}
                  onChange={(c) => run(() => change(c))}
                />
              </div>
            )}
          </div>
        </>
      )}
      <div role="status" aria-live="polite" className={styles.loading}>
        {busy ? "Working…" : ""}
      </div>
    </div>
  );
}
function safeSource(source: string) {
  return /^https?:\/\//i.test(source) ? source : undefined;
}
function sourceLabel(source: string) {
  try {
    const host = new URL(source).hostname.replace(/^www\./, "");
    if (host.endsWith("nytimes.com")) return "NYT Cooking";
    if (host.endsWith("instagram.com")) return "Instagram";
    return host.replace(/\.com$/, "");
  } catch {
    return "Recipe source";
  }
}
function RecipePhoto({ photo, name }: { photo?: string; name: string }) {
  return (
    <div className={styles.photo}>
      {photo ? (
        <img src={photo} alt={name} loading="lazy" />
      ) : (
        <div className={styles.photoPlaceholder}>
          <BookOpen size={28} />
          <span>{name}</span>
        </div>
      )}
    </div>
  );
}
function DraftEditor({
  draft,
  busy,
  dirty,
  onChange,
  onSave,
  onSaveChanges,
  onUse,
}: {
  draft: RecipeDraft;
  busy: boolean;
  dirty: boolean;
  onChange: (draft: RecipeDraft) => void;
  onSave: () => void;
  onSaveChanges: () => void;
  onUse: () => void;
}) {
  return (
    <section className={styles.draftEditor}>
      <fieldset disabled={busy}>
        <p role="status">
          {dirty
            ? "Changes not saved yet"
            : draft.status === "saved"
              ? "Saved in your recipe library"
              : "Draft saved in your shared kitchen"}
        </p>
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
        <button disabled={busy || !dirty} onClick={onSaveChanges}>
          Save draft changes
        </button>
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
            : "Save to recipe library"}
        </button>
      </fieldset>
    </section>
  );
}
