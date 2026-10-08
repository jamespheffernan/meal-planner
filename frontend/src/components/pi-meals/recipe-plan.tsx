"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Minus, Plus, X } from "lucide-react";
import type { RecipeSelection, SelectionChange } from "@/lib/pi-meals-api";
import {
  groupRecipes,
  removeRecipeGroup,
  resizeRecipeGroup,
  totalRecipeServings,
  type RecipeGroup,
} from "@/lib/pi-meals-plan";
import styles from "./recipe-plan.module.css";

const number = (value: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
function sourceName(source?: string) {
  if (!source) return "Saved recipe";
  try {
    const host = new URL(source).hostname.replace(/^www\./, "");
    if (host === "cooking.nytimes.com") return "NYT Cooking";
    if (host.endsWith("instagram.com")) return "Instagram";
    return host.replace(/\.com$/, "");
  } catch {
    return "Saved recipe";
  }
}

export function RecipePlan({
  selection,
  disabled,
  onChange,
}: {
  selection: RecipeSelection;
  disabled: boolean;
  onChange: (command: SelectionChange) => Promise<void>;
}) {
  const groups = groupRecipes(selection.items);
  return (
    <section className={styles.plan} aria-label="Selected recipes">
      <div className={styles.heading}>
        <h2>
          Recipes for the week <span>{groups.length}</span>
        </h2>
        <span>Servings</span>
      </div>
      {groups.length ? (
        <ul className={styles.list}>
          {groups.map((group) => (
            <RecipeRow
              key={`${selection.id}:${group.key}`}
              group={group}
              disabled={disabled}
              onResize={(servings) =>
                onChange({
                  type: "replace_items",
                  items: resizeRecipeGroup(selection.items, group, servings),
                })
              }
              onRemove={() =>
                onChange({
                  type: "replace_items",
                  items: removeRecipeGroup(selection.items, group),
                })
              }
            />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>
          Add the recipes you want to cook. Set the servings here and we’ll work
          out the ingredients.
        </p>
      )}
      <div className={styles.total} aria-live="polite">
        <span>Total for the week</span>
        <strong>
          {number(totalRecipeServings(selection.items))}{" "}
          <span>recipe servings</span>
        </strong>
      </div>
    </section>
  );
}

function RecipeRow({
  group,
  disabled,
  onResize,
  onRemove,
}: {
  group: RecipeGroup;
  disabled: boolean;
  onResize: (servings: number) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [input, setInput] = useState({
    servings: group.servings,
    text: String(group.servings),
  });
  const value =
    input.servings === group.servings ? input.text : String(group.servings);
  const setValue = (text: string) =>
    setInput({ servings: group.servings, text });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const busy = disabled || pending;
  const href = group.recipeId
    ? `/recipes/${group.recipeId}`
    : group.source && /^https?:\/\//i.test(group.source)
      ? group.source
      : undefined;
  async function save(next: string) {
    if (busy || inFlight.current) return;
    const servings = Number(next);
    if (
      !next.trim() ||
      !Number.isFinite(servings) ||
      servings <= 0 ||
      servings > 1000
    ) {
      setError("Enter more than zero and up to 1,000 servings.");
      return;
    }
    setError("");
    if (servings === group.servings) return;
    inFlight.current = true;
    setPending(true);
    try {
      await onResize(servings);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save these servings.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <li className={styles.row} aria-busy={pending}>
      <div className={styles.photo}>
        {group.photoUrl ? (
          <img src={group.photoUrl} alt="" loading="lazy" />
        ) : (
          <BookOpen size={24} aria-hidden="true" />
        )}
      </div>
      <div className={styles.recipe}>
        <h3>
          {href ? (
            <Link
              href={href}
              target={group.recipeId ? undefined : "_blank"}
              rel={group.recipeId ? undefined : "noreferrer"}
            >
              {group.name}
            </Link>
          ) : (
            group.name
          )}
        </h3>
        <p>{sourceName(group.source)}</p>
      </div>
      <div className={styles.portions}>
        <button
          type="button"
          aria-label={`Fewer servings of ${group.name}`}
          disabled={busy || Number(value) <= 1}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            const next = String(Math.max(1, Number(value) - 1));
            setValue(next);
            void save(next);
          }}
        >
          <Minus size={14} />
        </button>
        <input
          aria-label={`Servings of ${group.name}`}
          type="number"
          min="0.01"
          max="1000"
          step="any"
          value={value}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          onBlur={() => void save(value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save(value);
            }
            if (e.key === "Escape") {
              setValue(String(group.servings));
              setError("");
            }
          }}
        />
        <button
          type="button"
          aria-label={`More servings of ${group.name}`}
          disabled={busy || Number(value) >= 1000}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            const next = String(Number(value) + 1);
            setValue(next);
            void save(next);
          }}
        >
          <Plus size={14} />
        </button>
        <span className={styles.mobilePortionLabel}>servings</span>
      </div>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Remove ${group.name}`}
        disabled={busy}
        onPointerDown={(e) => e.preventDefault()}
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          setPending(true);
          try {
            await onRemove();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not remove this recipe.",
            );
          } finally {
            inFlight.current = false;
            setPending(false);
          }
        }}
      >
        <X size={16} />
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function PlanSummary({
  selection,
  onEdit,
}: {
  selection: RecipeSelection;
  onEdit: () => void;
}) {
  const groups = groupRecipes(selection.items);
  const extras = selection.items.filter(
    (item) => !item.recipeId && !item.draftId && item.id.startsWith("routine:"),
  );
  return (
    <details className={styles.summary}>
      <summary>
        <strong>
          This week: {groups.length}{" "}
          {groups.length === 1 ? "recipe" : "recipes"} ·{" "}
          {number(totalRecipeServings(selection.items))} servings
        </strong>
        <span>
          {extras.length}{" "}
          {extras.length === 1 ? "staple or extra" : "staples & extras"} · View
          plan
        </span>
      </summary>
      <div className={styles.summaryBody}>
        <div>
          <h3>Recipes</h3>
          <ul>
            {groups.map((group) => (
              <li key={group.key}>
                <span>{group.name}</span>
                <strong>{number(group.servings)} servings</strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Staples &amp; extras</h3>
          {extras.length ? (
            <ul>
              {extras.map((item) => (
                <li key={item.id}>{item.name}</li>
              ))}
            </ul>
          ) : (
            <p>None added.</p>
          )}
          <button type="button" onClick={onEdit}>
            Edit this week’s plan
          </button>
        </div>
      </div>
    </details>
  );
}
