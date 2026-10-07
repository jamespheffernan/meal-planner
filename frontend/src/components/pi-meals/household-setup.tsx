"use client";

import { useEffect, useRef, useState } from "react";
import {
  householdApi,
  type HouseholdProfile,
  type HouseholdDocument,
} from "../../lib/pi-meals-household-api";
import { operationId, type SelectionItem } from "../../lib/pi-meals-api";
import "./household-setup.css";
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const empty: HouseholdProfile = {
  version: 1,
  confirmed: false,
  rotationRecipeIds: [],
  people: [
    { member: "James", homeLunchDays: [], portions: 1 },
    { member: "Manon", homeLunchDays: [], portions: 1 },
  ],
  exclusions: [],
  preferences: [],
  routines: [
    {
      id: "breakfast",
      meal: "breakfast",
      note: "Breakfast supplies",
      weeklyRequirements: [],
    },
    {
      id: "evening",
      meal: "light_dinner",
      note: "Light dinner supplies",
      weeklyRequirements: [],
    },
  ],
};
function lines(p: HouseholdProfile, index: number) {
  return (
    p.routines[index]?.weeklyRequirements
      .map((r) => `${r.name} | ${r.quantity} | ${r.unit}`)
      .join("\n") ?? ""
  );
}
function requirements(value: string) {
  return value
    .split("\n")
    .filter((v) => v.trim())
    .map((v) => {
      const [name, quantity, unit] = v.split("|").map((s) => s.trim());
      if (
        !name ||
        !unit ||
        !Number.isFinite(Number(quantity)) ||
        Number(quantity) <= 0
      )
        throw new Error(
          "Use one supply per line: ingredient | positive amount | unit.",
        );
      return { name, quantity: Number(quantity), unit };
    });
}
export function HouseholdSetup({
  onPrepared,
}: {
  onPrepared: (weekId: string) => void;
}) {
  const pending = useRef(true);
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<HouseholdDocument | null>(null),
    [profile, setProfile] = useState<HouseholdProfile>(empty),
    [cards, setCards] = useState<
      Array<{ recipe: SelectionItem; reason: string }>
    >([]),
    [notes, setNotes] = useState<string[]>([]),
    [gaps, setGaps] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false),
    [search, setSearch] = useState("");
  const [breakfast, setBreakfast] = useState(""),
    [evening, setEvening] = useState(""),
    [exclusions, setExclusions] = useState(""),
    [preferences, setPreferences] = useState("");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10)),
    [temporary, setTemporary] = useState(""),
    [away, setAway] = useState(""),
    [prepareOp, setPrepareOp] = useState<string | null>(null),
    [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    Promise.all([householdApi.read(), householdApi.candidates()])
      .then(([r, c]) => {
        if (!active) return;
        setDoc(r.household);
        setNotes(r.interviewNotes.notes);
        setCards(c.cards);
        setGaps(c.gaps);
        if (r.household) {
          const p = r.household.data.profile;
          setProfile(p);
          setBreakfast(lines(p, 0));
          setEvening(lines(p, 1));
          setExclusions(
            p.exclusions
              .map((v) => `${v.subject} | ${v.ingredient}`)
              .join("\n"),
          );
          setPreferences(
            p.preferences.map((v) => `${v.subject} | ${v.note}`).join("\n"),
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (!active) return;
        pending.current = false;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function browse(all: boolean, query: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const c = await householdApi.candidates({ expanded: all, search: query });
      setCards((previous) => [
        ...previous.filter(
          (old) =>
            (profile.rotationRecipeIds.includes(
              old.recipe.recipeId ?? old.recipe.id,
            ) ||
              profile.routines.some(
                (r) =>
                  r.bakeRecipeId === (old.recipe.recipeId ?? old.recipe.id),
              )) &&
            !c.cards.some((n) => n.recipe.id === old.recipe.id),
        ),
        ...c.cards,
      ]);
      setGaps(c.gaps);
      setExpanded(all);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function change(next: HouseholdProfile) {
    if (pending.current) return;
    setProfile({ ...next, confirmed: false });
    setPrepareOp(null);
  }
  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const parseNotes = (value: string) =>
        value
          .split("\n")
          .filter((v) => v.trim())
          .map((v) => {
            const [subject, note] = v.split("|").map((s) => s.trim());
            if (!["household", "James", "Manon"].includes(subject) || !note)
              throw new Error(
                "Use subject | ingredient or note; subject is household, James or Manon.",
              );
            return {
              subject: subject as "household" | "James" | "Manon",
              note,
            };
          });
      const p: HouseholdProfile = {
        ...profile,
        confirmed: true,
        exclusions: parseNotes(exclusions).map((v) => ({
          subject: v.subject,
          ingredient: v.note,
        })),
        preferences: parseNotes(preferences),
        routines: profile.routines.map((r, i) => ({
          ...r,
          weeklyRequirements: requirements(i === 0 ? breakfast : evening),
        })),
      };
      const saved = await householdApi.save(doc?.revision ?? 0, p);
      setDoc(saved);
      setProfile(saved.data.profile);
      setPrepareOp(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function prepare() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!doc || !profile.confirmed)
        throw new Error("Confirm the corrected household routine first.");
      const rows = away
        .split("\n")
        .filter((v) => v.trim())
        .map((v) => {
          const [date, member] = v.split("|").map((s) => s.trim());
          if (!["James", "Manon"].includes(member))
            throw new Error("Away lunch: YYYY-MM-DD | James or Manon.");
          return { date, member: member as "James" | "Manon" };
        });
      const op = prepareOp ?? operationId();
      setPrepareOp(op);
      const r = await householdApi.prepare(
        doc.revision,
        start,
        rows,
        temporary
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        op,
      );
      setWarnings(r.warnings);
      onPrepared(r.week.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="household-setup" aria-busy={loading || busy}>
      <h2>Prepare our week</h2>
      <p>
        Confirm a small rotation and your recurring meals once. Weekly changes
        stay separate.
      </p>
      <p role="status" aria-live="polite">
        {loading
          ? "Loading your household routine…"
          : busy
            ? "Saving or loading your changes… Editing resumes when this finishes."
            : "Ready to edit your household routine."}
      </p>
      <fieldset
        disabled={loading || busy}
        aria-label="Household routine and this week"
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        {!doc && (
          <details open>
            <summary>January interview · unconfirmed</summary>
            <ul>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p>
              Correct these notes below. Quantities and current exclusions were
              not established.
            </p>
          </details>
        )}
        <h3>Our rotation</h3>
        <p>
          These are library candidates. Tick recipes you want in your regular
          rotation.
        </p>
        <button disabled={busy} onClick={() => browse(!expanded, "")}>
          {expanded ? "Show candidate shortlist" : "Show all eligible recipes"}
        </button>
        <label>
          Find your usual recipe or breakfast cake
          <input
            value={search}
            onChange={(e) => {
              if (!pending.current) setSearch(e.target.value);
            }}
          />
        </label>
        <button disabled={busy} onClick={() => browse(true, search)}>
          Search eligible library
        </button>
        <div className="household-candidates">
          {cards.map(({ recipe: r, reason }) => (
            <label key={r.recipeId ?? r.id} className="household-card">
              {r.photoUrl && <img src={r.photoUrl} alt="" />}
              <span>
                <input
                  type="checkbox"
                  checked={profile.rotationRecipeIds.includes(
                    r.recipeId ?? r.id,
                  )}
                  onChange={(e) =>
                    change({
                      ...profile,
                      rotationRecipeIds: e.target.checked
                        ? [...profile.rotationRecipeIds, r.recipeId ?? r.id]
                        : profile.rotationRecipeIds.filter(
                            (id) => id !== (r.recipeId ?? r.id),
                          ),
                    })
                  }
                />
                {r.name}
              </span>
              <small>{reason}</small>
            </label>
          ))}
        </div>
        {gaps.map((g) => (
          <p key={g}>{g}</p>
        ))}
        <h3>Lunches at home</h3>
        {profile.people.map((p, index) => (
          <fieldset key={p.member}>
            <legend>{p.member}</legend>
            {days.map((day, i) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={p.homeLunchDays.includes(i)}
                  onChange={(e) =>
                    change({
                      ...profile,
                      people: profile.people.map((v, j) =>
                        j === index
                          ? {
                              ...v,
                              homeLunchDays: e.target.checked
                                ? [...v.homeLunchDays, i]
                                : v.homeLunchDays.filter((d) => d !== i),
                            }
                          : v,
                      ),
                    })
                  }
                />
                {day}
              </label>
            ))}
            <label>
              Portions per lunch{" "}
              <input
                type="number"
                min="0.25"
                step="0.25"
                value={p.portions}
                onChange={(e) =>
                  change({
                    ...profile,
                    people: profile.people.map((v, j) =>
                      j === index
                        ? { ...v, portions: Number(e.target.value) }
                        : v,
                    ),
                  })
                }
              />
            </label>
          </fieldset>
        ))}
        <label>
          Hard ingredient exclusions · subject | ingredient
          <textarea
            value={exclusions}
            placeholder="household | peanuts"
            onChange={(e) => {
              if (pending.current) return;
              setExclusions(e.target.value);
              change(profile);
            }}
          />
        </label>
        <label>
          Preferences · subject | note
          <textarea
            value={preferences}
            placeholder="Manon | prefers lighter evenings"
            onChange={(e) => {
              if (pending.current) return;
              setPreferences(e.target.value);
              change(profile);
            }}
          />
        </label>
        <p>
          Ingredient-name checks need a full recipe review for allergies. Until
          you confirm the routine, current exclusions remain unknown. Confirming
          an empty field explicitly records no exclusions.
        </p>
        <label>
          Breakfast weekly supplies · ingredient | amount | unit
          <textarea
            value={breakfast}
            placeholder="yogurt | 1000 | g"
            onChange={(e) => {
              if (pending.current) return;
              setBreakfast(e.target.value);
              change(profile);
            }}
          />
        </label>
        <label>
          Light dinner weekly supplies · ingredient | amount | unit
          <textarea
            value={evening}
            placeholder="bread | 1 | loaf"
            onChange={(e) => {
              if (pending.current) return;
              setEvening(e.target.value);
              change(profile);
            }}
          />
        </label>
        <p>
          Weekly supplies are amounts for the whole household. Add bake
          ingredients through the recipe below; do not repeat those ingredients
          in the supplies.
        </p>
        <label>
          Optional breakfast bake{" "}
          <select
            value={profile.routines[0]?.bakeRecipeId ?? ""}
            onChange={(e) =>
              change({
                ...profile,
                routines: profile.routines.map((r, i) =>
                  i === 0
                    ? {
                        ...r,
                        bakeRecipeId: e.target.value || undefined,
                        bakeServings: e.target.value ? 1 : undefined,
                      }
                    : r,
                ),
              })
            }
          >
            <option value="">No bake selected</option>
            {cards.map((c) => (
              <option
                key={c.recipe.id}
                value={c.recipe.recipeId ?? c.recipe.id}
              >
                {c.recipe.name}
              </option>
            ))}
          </select>
        </label>
        {profile.routines[0]?.bakeRecipeId && (
          <label>
            Bake portions needed this week{" "}
            <input
              type="number"
              min="1"
              value={profile.routines[0].bakeServings}
              onChange={(e) =>
                change({
                  ...profile,
                  routines: profile.routines.map((r, i) =>
                    i === 0
                      ? { ...r, bakeServings: Number(e.target.value) }
                      : r,
                  ),
                })
              }
            />
          </label>
        )}
        <button disabled={busy} onClick={confirm}>
          {profile.confirmed
            ? "Routine confirmed · save corrections"
            : "Confirm corrected routine"}
        </button>
        {doc && (
          <p>
            Last saved by {doc.data.author}. Both people can correct this
            routine.
          </p>
        )}
        <h3>This week</h3>
        <label>
          First cooking day{" "}
          <input
            type="date"
            value={start}
            onChange={(e) => {
              if (pending.current) return;
              setStart(e.target.value);
              setPrepareOp(null);
            }}
          />
        </label>
        <p>Two sessions: the first day and three days later.</p>
        <label>
          Away lunches · YYYY-MM-DD | person
          <textarea
            value={away}
            onChange={(e) => {
              if (pending.current) return;
              setAway(e.target.value);
              setPrepareOp(null);
            }}
          />
        </label>
        <label>
          Temporary shared ingredient exclusions · comma separated
          <input
            value={temporary}
            onChange={(e) => {
              if (pending.current) return;
              setTemporary(e.target.value);
              setPrepareOp(null);
            }}
          />
        </label>
        <button disabled={busy || !profile.confirmed} onClick={prepare}>
          {busy ? "Saving…" : "Prepare our week"}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {warnings.map((w) => (
        <p key={w}>{w}</p>
      ))}
    </section>
  );
}
