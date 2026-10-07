"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  mealsApi,
  mealsRequest,
  MealsApiError,
  type RecipeDraft,
  type SelectionItem,
  operationId,
  type RecipeSelection,
} from "@/lib/pi-meals-api";
import {
  weekApi,
  type MealWeek,
  type WeekCommand,
  type WeekAllocation,
} from "@/lib/pi-meals-week-api";
import styles from "./week-workspace.module.css";
import { HouseholdSetup } from "./household-setup";
function CookingDetails({ item }: { item: SelectionItem }) {
  const [method, setMethod] = useState<string[]>([]);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    let active = true;
    setMethod([]);
    setFailure("");
    const read = item.draftId
      ? mealsRequest<RecipeDraft>(
          `/pi-meals/intake/${encodeURIComponent(item.draftId)}`,
        ).then((d) => d.instructions)
      : item.recipeId
        ? mealsApi
            .recipe(item.recipeId)
            .then((r) =>
              (r.recipeInstructions ?? [])
                .sort((a, b) => a.stepNumber - b.stepNumber)
                .map((i) => i.instructionText),
            )
        : Promise.resolve([]);
    read
      .then((steps) => {
        if (active) setMethod(steps);
      })
      .catch((e) => {
        if (active) setFailure(e.message);
      });
    return () => {
      active = false;
    };
  }, [item.draftId, item.recipeId]);
  return (
    <details>
      <summary>Ingredients and method</summary>
      <p>
        Scaled from {item.baseServings} to {item.servings} portions.
      </p>
      <ul>
        {item.ingredients.map((i, index) => (
          <li key={index}>
            {i.quantity === null
              ? "Amount unknown"
              : Number(
                  ((i.quantity * item.servings) / item.baseServings).toFixed(2),
                )}{" "}
            {i.unit} {i.name}
          </li>
        ))}
      </ul>
      {method.length ? (
        <ol>
          {method.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : (
        <p>
          {failure
            ? `Could not load method: ${failure}`
            : "Method unavailable. Check the recipe source before cooking."}
        </p>
      )}
    </details>
  );
}
export function WeekWorkspace() {
  const [weeks, setWeeks] = useState<MealWeek[]>([]),
    [week, setWeek] = useState<MealWeek | null>(null),
    [selections, setSelections] = useState<RecipeSelection[]>([]),
    [selectionId, setSelectionId] = useState(""),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [error, setError] = useState(""),
    [unauthorized, setUnauthorized] = useState(false),
    [busy, setBusy] = useState(false),
    [routine, setRoutine] = useState(""),
    [meal, setMeal] = useState<"breakfast" | "light_dinner">("breakfast");
  async function reload() {
    setBusy(true);
    setError("");
    setUnauthorized(false);
    try {
      const [w, s] = await Promise.all([weekApi.list(), mealsApi.selections()]);
      setWeeks(w);
      setWeek((old) => w.find((v) => v.id === old?.id) ?? w[0] ?? null);
      setSelections(s);
      setSelectionId((old) =>
        s.some((v) => v.id === old) ? old : (s[0]?.id ?? ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
      setUnauthorized(e instanceof MealsApiError && e.status === 401);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  async function run(action: () => Promise<MealWeek>) {
    setBusy(true);
    setError("");
    try {
      const next = await action();
      setWeek(next);
      setWeeks((old) => [next, ...old.filter((w) => w.id !== next.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Change failed.");
      setUnauthorized(e instanceof MealsApiError && e.status === 401);
    } finally {
      setBusy(false);
    }
  }
  function command(c: WeekCommand) {
    if (week) void run(() => weekApi.command(week, c));
  }
  function allocation(index: number, patch: Partial<WeekAllocation>) {
    if (week)
      command({
        type: "set_allocations",
        allocations: week.allocations.map((a, i) =>
          i === index ? { ...a, ...patch } : a,
        ),
      });
  }
  return (
    <main className={styles.main}>
      <header>
        <p className={styles.eyebrow}>PI MEALS · OUR WEEK</p>
        <h1>Two cooks. A week of lunches.</h1>
        {week && (
          <p aria-live="polite">
            {(["planned", "cooked", "away", "uncovered"] as const)
              .map(
                (status) =>
                  `${week.lunches.filter((l) => l.coverage === status).length} ${status}`,
              )
              .join(" · ")}{" "}
            ·{" "}
            {
              week.lunches.filter(
                (l) => !l.away && l.freezeRequired && !l.freezeConfirmed,
              ).length
            }{" "}
            freezer confirmations pending
          </p>
        )}
        <p>
          Link the recipes already chosen for your shop, then give each lunch a
          batch.
        </p>
        <Link href="/shop-recipes">← Shop recipes and grocery list</Link>
      </header>
      {error && (
        <p role="alert" className={styles.alert}>
          {error}{" "}
          {unauthorized && (
            <Link href="/shop-recipes">Sign in to the household</Link>
          )}
          <button disabled={busy} onClick={() => void reload()}>
            Reload saved week
          </button>
        </p>
      )}
      <section className={styles.card}>
        <details open={!week}>
          <summary>Household routine and weekly preparation</summary>
          <HouseholdSetup
            onPrepared={(id) => {
              void run(() => weekApi.get(id));
              void mealsApi.selections().then(setSelections);
            }}
          />
        </details>
        <h2>Start from a recipe selection</h2>
        <div className={styles.row}>
          <label>
            Selection
            <select
              value={selectionId}
              onChange={(e) => setSelectionId(e.target.value)}
            >
              {selections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.items.length} recipes
                </option>
              ))}
            </select>
          </label>
          <label>
            First lunch day
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !selectionId}
            onClick={() => void run(() => weekApi.create(selectionId, date))}
          >
            Create week
          </button>
        </div>
        <p>This links the existing shop. It adds no groceries.</p>
        {week && (
          <button
            disabled={busy}
            onClick={() => void run(() => weekApi.repeat(week.id, date))}
          >
            Same as this week, from {date}
          </button>
        )}
        {week && (
          <p>
            Repeat creates a fresh shop from the saved recipes. Check stock
            again; old purchases and cooked status do not carry over.
          </p>
        )}
        {weeks.length > 0 && (
          <label>
            Open week
            <select
              value={week?.id ?? ""}
              onChange={(e) =>
                setWeek(weeks.find((w) => w.id === e.target.value) ?? null)
              }
            >
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  Week from {w.startDate}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      {week && (
        <>
          <section className={styles.card}>
            <h2>Cook sessions</h2>
            {week.needsRefresh && (
              <div className={styles.alert}>
                <strong>
                  The recipe selection changed. Lunch coverage needs review.
                </strong>
                <p>
                  Update servings in Shop recipes first. Refresh links before
                  relying on this week. Cooked snapshots stay fixed; uncooked
                  batches can refresh.
                </p>
                <button
                  disabled={busy}
                  onClick={() => command({ type: "refresh_selection" })}
                >
                  Refresh from selection
                </button>
              </div>
            )}
            <div className={styles.row}>
              {week.sessions.map((d, i) => (
                <label key={i}>
                  Cook {i + 1}
                  <input
                    disabled={busy}
                    type="date"
                    value={d}
                    onChange={(e) => {
                      const sessions: [string, string] = [...week.sessions];
                      sessions[i] = e.target.value;
                      command({ type: "set_sessions", sessions });
                    }}
                  />
                </label>
              ))}
            </div>
            <div className={styles.batches}>
              {week.batches.map((b) => {
                const summary = week.batchesSummary.find((s) => s.id === b.id)!;
                return (
                  <article key={b.id} className={styles.batch}>
                    {b.snapshot.photoUrl && (
                      <img src={b.snapshot.photoUrl} alt="" />
                    )}
                    <h3>{b.snapshot.name}</h3>
                    <p>
                      {summary.yield} portions · {summary.allocated} allocated ·{" "}
                      {summary.remaining} remaining
                    </p>
                    {b.snapshot.source && (
                      <a
                        href={b.snapshot.source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Recipe source
                      </a>
                    )}
                    <CookingDetails item={b.snapshot} />
                    <p>Feedback for this week only.</p>
                    <div className={styles.row}>
                      {(
                        [
                          ["make_again", "Make again"],
                          ["too_much_effort", "Too much effort"],
                          ["not_this_week", "Not this week"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          aria-pressed={b.feedback === value}
                          disabled={busy}
                          onClick={() =>
                            command({
                              type: "set_feedback",
                              batchId: b.id,
                              feedback: b.feedback === value ? null : value,
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label>
                      Cook session
                      <select
                        disabled={busy}
                        value={b.session}
                        onChange={(e) =>
                          command({
                            type: "set_batch_session",
                            batchId: b.id,
                            session: Number(e.target.value) as 0 | 1,
                          })
                        }
                      >
                        <option value={0}>Cook 1</option>
                        <option value={1}>Cook 2</option>
                      </select>
                    </label>
                    <p>
                      Status: <strong>{b.status}</strong>
                      {b.cookedAt &&
                        ` · ${new Date(b.cookedAt).toLocaleString()}`}
                    </p>
                    <div className={styles.row}>
                      <button
                        disabled={busy}
                        onClick={() =>
                          command({
                            type: "set_status",
                            batchId: b.id,
                            status: "cooked",
                            cookedAt: new Date().toISOString(),
                          })
                        }
                      >
                        Record cooked now
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          command({
                            type: "set_status",
                            batchId: b.id,
                            status: "skipped",
                          })
                        }
                      >
                        Skipped
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          command({
                            type: "set_status",
                            batchId: b.id,
                            status: "planned",
                          })
                        }
                      >
                        Reset planned
                      </button>
                    </div>
                    <label>
                      Already cooked? Record actual time
                      <input
                        disabled={busy}
                        type="datetime-local"
                        onChange={(e) => {
                          if (e.target.value)
                            command({
                              type: "set_status",
                              batchId: b.id,
                              status: "cooked",
                              cookedAt: new Date(e.target.value).toISOString(),
                            });
                        }}
                      />
                    </label>
                  </article>
                );
              })}
            </div>
          </section>
          <section className={styles.card}>
            <h2>Lunch allocations</h2>
            <p>
              Remaining capacity means portions reserved in this plan. It does
              not claim that meals were eaten or deduct pantry stock. Ingredient
              arrival dates show availability only; check raw ingredient
              condition separately.
            </p>
            {week.lunches.map((a, index) => (
              <article key={`${a.date}-${a.member}`} className={styles.lunch}>
                <div>
                  <strong>
                    {a.member} · {a.date}
                  </strong>
                  <span className={styles.badge}>{a.coverage}</span>
                </div>
                <div className={styles.row}>
                  <label>
                    Lunch day
                    <input
                      type="date"
                      disabled={busy}
                      value={a.date}
                      min={week.startDate}
                      onChange={(e) =>
                        allocation(index, {
                          date: e.target.value,
                          freezeConfirmed: false,
                        })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={a.away}
                      onChange={(e) =>
                        allocation(index, { away: e.target.checked })
                      }
                    />{" "}
                    Away
                  </label>
                  <label>
                    Batch
                    <select
                      disabled={busy || a.away}
                      value={a.batchId ?? ""}
                      onChange={(e) =>
                        allocation(index, {
                          batchId: e.target.value || null,
                          freezeConfirmed: false,
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {week.batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.snapshot.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Portions
                    <input
                      type="number"
                      min="0.25"
                      step="0.25"
                      disabled={busy || a.away}
                      value={a.portions}
                      onChange={(e) =>
                        allocation(index, { portions: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                {!a.away && (a.batchId || a.uncoveredReason) && (
                  <p>{a.storageNote}</p>
                )}
                {!a.away && !!a.ingredientWarnings?.length && (
                  <ul className={styles.alert}>
                    {a.ingredientWarnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                )}
                {!a.away && a.freezeRequired && (
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={a.freezeConfirmed}
                      onChange={(e) =>
                        allocation(index, { freezeConfirmed: e.target.checked })
                      }
                    />{" "}
                    I confirm freezer space and the freeze/thaw plan for this
                    portion.
                  </label>
                )}
              </article>
            ))}
          </section>
          <section className={styles.card}>
            <h2>Breakfast and light dinner</h2>
            <p>
              Optional routine notes. These do not add groceries; include any
              extra requirements in Shop recipes yourself.
            </p>
            {week.routines.map((r) => (
              <div key={r.id} className={styles.row}>
                <p>
                  {r.meal === "breakfast" ? "Breakfast" : "Light dinner"}:{" "}
                  {r.note}
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    command({
                      type: "set_routines",
                      routines: week.routines.filter((x) => x.id !== r.id),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div className={styles.row}>
              <select
                aria-label="Meal"
                value={meal}
                onChange={(e) => setMeal(e.target.value as typeof meal)}
              >
                <option value="breakfast">Breakfast</option>
                <option value="light_dinner">Light dinner</option>
              </select>
              <input
                aria-label="Routine requirements"
                placeholder="Your routine and requirements"
                value={routine}
                onChange={(e) => setRoutine(e.target.value)}
              />
              <button
                disabled={busy || !routine.trim()}
                onClick={() => {
                  command({
                    type: "set_routines",
                    routines: [
                      ...week.routines,
                      { id: operationId(), meal, note: routine.trim() },
                    ],
                  });
                  setRoutine("");
                }}
              >
                Add note
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
