import { createHash } from "node:crypto";
import type {
  SelectionItem,
  ShoppingLine,
  StockDecision,
} from "./contracts.js";

/** Only aliases with an unambiguous conversion share a line. */
const units: Record<string, { unit: string; factor: number }> = {
  g: { unit: "g", factor: 1 },
  gram: { unit: "g", factor: 1 },
  grams: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  kilogram: { unit: "g", factor: 1000 },
  kilograms: { unit: "g", factor: 1000 },
  oz: { unit: "g", factor: 28.349523125 },
  ounce: { unit: "g", factor: 28.349523125 },
  ounces: { unit: "g", factor: 28.349523125 },
  lb: { unit: "g", factor: 453.59237 },
  lbs: { unit: "g", factor: 453.59237 },
  pound: { unit: "g", factor: 453.59237 },
  pounds: { unit: "g", factor: 453.59237 },
  ml: { unit: "ml", factor: 1 },
  millilitre: { unit: "ml", factor: 1 },
  millilitres: { unit: "ml", factor: 1 },
  milliliter: { unit: "ml", factor: 1 },
  milliliters: { unit: "ml", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  litre: { unit: "ml", factor: 1000 },
  litres: { unit: "ml", factor: 1000 },
  liter: { unit: "ml", factor: 1000 },
  liters: { unit: "ml", factor: 1000 },
  "fl oz": { unit: "fl oz", factor: 1 },
  "fluid oz": { unit: "fl oz", factor: 1 },
  "fluid ounce": { unit: "fl oz", factor: 1 },
  "fluid ounces": { unit: "fl oz", factor: 1 },
  floz: { unit: "fl oz", factor: 1 },
  tbsp: { unit: "ml", factor: 14.78676478125 },
  tablespoon: { unit: "ml", factor: 14.78676478125 },
  tablespoons: { unit: "ml", factor: 14.78676478125 },
  tsp: { unit: "ml", factor: 4.92892159375 },
  teaspoon: { unit: "ml", factor: 4.92892159375 },
  teaspoons: { unit: "ml", factor: 4.92892159375 },
  cup: { unit: "ml", factor: 236.5882365 },
  cups: { unit: "ml", factor: 236.5882365 },
  pieces: { unit: "piece", factor: 1 },
  slices: { unit: "slice", factor: 1 },
  packs: { unit: "pack", factor: 1 },
};
function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
export function canonicalUnit(value: string): { unit: string; factor: number } {
  const key = normalized(value);
  return units[key] ?? { unit: key, factor: 1 };
}
function finite(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw Object.assign(
      new Error("Ingredient quantities must be finite and non-negative."),
      { statusCode: 400 },
    );
  return value;
}
function ingredientKey(ingredient: SelectionItem["ingredients"][number]): {
  key: string;
  id: string;
} {
  const identity = ingredient.id
    ? `id:${ingredient.id}`
    : `name:${normalized(ingredient.name)}`;
  const key = JSON.stringify([identity, canonicalUnit(ingredient.unit).unit]);
  return {
    key,
    id: `line_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
  };
}
export function coverageFingerprint(
  items: SelectionItem[],
  lineId: string,
): string {
  const requirements = items
    .flatMap((item) =>
      item.ingredients.map((ingredient, index) => ({
        item,
        index,
        ingredient,
      })),
    )
    .filter(({ ingredient }) => {
      return ingredientKey(ingredient).id === lineId;
    })
    .map(({ item, index, ingredient }) => [
      item.id,
      ingredient.id ?? index,
      ingredient.quantity,
      ingredient.unit,
      item.baseServings,
      item.servings,
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256")
    .update(JSON.stringify(requirements))
    .digest("hex");
}
export function compileSelectionLines(
  items: SelectionItem[],
  stock: StockDecision[] = [],
): ShoppingLine[] {
  const groups = new Map<string, ShoppingLine>();
  for (const item of items) {
    const scale = item.servings / item.baseServings;
    for (const ingredient of item.ingredients) {
      const conversion = canonicalUnit(ingredient.unit);
      const { key, id } = ingredientKey(ingredient);
      const quantity =
        ingredient.quantity === null
          ? null
          : finite(ingredient.quantity * scale * conversion.factor);
      let line = groups.get(key);
      if (!line) {
        line = {
          id,
          name: ingredient.name.trim(),
          quantity: 0,
          unit: conversion.unit,
          haveQuantity: 0,
          buyQuantity: 0,
          sources: [],
          warnings: [],
        };
        groups.set(key, line);
      }
      line.sources.push({ itemId: item.id, name: item.name, quantity });
      line.quantity =
        line.quantity === null || quantity === null
          ? null
          : finite(line.quantity + quantity);
      if (
        quantity === null &&
        !line.warnings.includes("One or more ingredient amounts are unknown.")
      )
        line.warnings.push("One or more ingredient amounts are unknown.");
    }
  }
  return [...groups.values()].map((line) => {
    const decision = stock.find((s) => s.lineId === line.id);
    if (decision && line.quantity !== null) {
      const conversion = canonicalUnit(decision.unit);
      if (conversion.unit === line.unit)
        line.haveQuantity = Math.min(
          line.quantity,
          finite(decision.quantity * conversion.factor),
        );
    }
    line.buyQuantity =
      line.quantity === null
        ? decision?.coverageFingerprint === coverageFingerprint(items, line.id)
          ? 0
          : null
        : Math.max(0, line.quantity - line.haveQuantity);
    return line;
  });
}
