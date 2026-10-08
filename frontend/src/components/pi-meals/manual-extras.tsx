"use client";
import { useId, useState } from "react";
import {
  operationId,
  type RecipeSelection,
  type SelectionChange,
  type SelectionItem,
} from "@/lib/pi-meals-api";
import styles from "./manual-extras.module.css";

function ingredientAmount(
  item: SelectionItem,
  quantity: number | null,
  unit: string,
) {
  if (quantity === null)
    return unit ? `Amount unknown · ${unit}` : "Amount unknown";
  const scaled = (quantity * item.servings) / item.baseServings;
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(scaled)}${unit ? ` ${unit}` : ""}`;
}

export function ManualExtras({
  selection,
  disabled,
  onChange,
}: {
  selection: RecipeSelection;
  disabled: boolean;
  onChange: (command: SelectionChange) => Promise<void>;
}) {
  const headingId = useId();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = disabled || pending;
  const extras = selection.items.filter(
    (item) => !item.recipeId && !item.draftId && item.id.startsWith("routine:"),
  );

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setName("");
    setAmount("");
    setUnit("");
    setError("");
  }
  function edit(item: SelectionItem) {
    const ingredient = item.ingredients[0];
    setEditingId(item.id);
    setName(ingredient.name);
    setAmount(
      ingredient.quantity === null
        ? ""
        : String((ingredient.quantity * item.servings) / item.baseServings),
    );
    setUnit(ingredient.unit);
    setError("");
    setFormOpen(true);
  }
  async function save() {
    if (busy) return;
    setError("");
    const quantity = amount.trim() ? Number(amount) : null;
    if (
      !name.trim() ||
      (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
    ) {
      setError(
        "Enter a staple name and a positive amount, or leave the amount blank.",
      );
      return;
    }
    setPending(true);
    try {
      const previous = selection.items.find((item) => item.id === editingId);
      const item: SelectionItem = {
        ...previous,
        id: editingId ?? `routine:extra:${operationId()}`,
        name: name.trim(),
        baseServings: 1,
        servings: 1,
        ingredients: [
          {
            ...previous?.ingredients[0],
            name: name.trim(),
            quantity,
            unit: unit.trim(),
          },
        ],
      };
      await onChange({
        type: "replace_items",
        items: editingId
          ? selection.items.map((existing) =>
              existing.id === editingId ? item : existing,
            )
          : [...selection.items, item],
      });
      closeForm();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save this staple. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function remove(id: string) {
    if (busy) return;
    setPending(true);
    setError("");
    try {
      await onChange({
        type: "replace_items",
        items: selection.items.filter((item) => item.id !== id),
      });
      if (editingId === id) closeForm();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not remove this staple. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className={styles.section}
      aria-labelledby={headingId}
      aria-busy={pending}
    >
      <div className={styles.heading}>
        <h2 id={headingId}>Staples &amp; extras</h2>
        {!formOpen && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setFormOpen(true);
              setError("");
            }}
          >
            Add a staple
          </button>
        )}
      </div>
      {extras.length === 0 ? (
        <p className={styles.empty}>
          Milk, fruit, coffee — anything beyond the recipes.
        </p>
      ) : (
        <ul className={styles.list}>
          {extras.map((item) => (
            <li key={item.id} className={styles.row}>
              <div className={styles.details}>
                <h3>{item.name}</h3>
                {item.ingredients.map((ingredient, index) => (
                  <p key={ingredient.id ?? index}>
                    {item.ingredients.length > 1 ||
                    ingredient.name !== item.name
                      ? `${ingredient.name} · `
                      : ""}
                    {ingredientAmount(
                      item,
                      ingredient.quantity,
                      ingredient.unit,
                    )}
                  </p>
                ))}
              </div>
              <div className={styles.actions}>
                {item.id.startsWith("routine:extra:") &&
                  item.ingredients.length === 1 && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Edit ${item.name}`}
                      onClick={() => edit(item)}
                    >
                      Edit
                    </button>
                  )}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${item.name}`}
                  onClick={() => void remove(item.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {formOpen && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className={styles.name}>
            Staple name
            <input
              disabled={busy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Milk, fruit, coffee…"
              required
              autoFocus
            />
          </label>
          <label>
            Amount
            <input
              disabled={busy}
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Unknown"
            />
          </label>
          <label>
            Unit
            <input
              disabled={busy}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="g, ml, pieces…"
            />
          </label>
          <div className={styles.formActions}>
            <button className={styles.save} disabled={busy} type="submit">
              {pending ? "Saving…" : editingId ? "Save staple" : "Add staple"}
            </button>
            <button disabled={busy} type="button" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
