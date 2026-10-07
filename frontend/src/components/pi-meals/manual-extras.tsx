"use client";
import { useState } from "react";
import {
  operationId,
  type RecipeSelection,
  type SelectionChange,
} from "@/lib/pi-meals-api";
export function ManualExtras({
  selection,
  disabled,
  onChange,
}: {
  selection: RecipeSelection;
  disabled: boolean;
  onChange: (command: SelectionChange) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [amount, setAmount] = useState(""),
    [unit, setUnit] = useState(""),
    [error, setError] = useState("");
  async function add() {
    setError("");
    try {
      const quantity = amount.trim() ? Number(amount) : null;
      if (
        !name.trim() ||
        (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
      )
        throw new Error(
          "Enter an ingredient and a positive amount, or leave the amount unknown.",
        );
      await onChange({
        type: "replace_items",
        items: [
          ...selection.items,
          {
            id: `routine:extra:${operationId()}`,
            name: name.trim(),
            baseServings: 1,
            servings: 1,
            ingredients: [{ name: name.trim(), quantity, unit: unit.trim() }],
          },
        ],
      });
      setName("");
      setAmount("");
      setUnit("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not add the extra ingredient.",
      );
    }
  }
  return (
    <details>
      <summary>Add an extra ingredient to this shop</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}
      >
        <label>
          Ingredient
          <input
            disabled={disabled}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Amount
          <input
            disabled={disabled}
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
            disabled={disabled}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="g, ml, pieces…"
          />
        </label>
        <button disabled={disabled}>Add extra</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
