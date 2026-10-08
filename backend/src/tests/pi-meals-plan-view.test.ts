import { describe, expect, it } from "vitest";
import { groupRecipes, isRecipeItem, totalRecipeServings, resizeRecipeGroup, removeRecipeGroup } from "../../../frontend/src/lib/pi-meals-plan";
import type { SelectionItem } from "../../../frontend/src/lib/pi-meals-api";
import { compileSelectionLines } from "../pi-meals/compiler.js";
const recipe = (id: string, overrides: Partial<SelectionItem> = {}): SelectionItem => ({
  id, name: "Dinner", baseServings: 4, servings: 4,
  ingredients: [{ id: "rice", name: "Rice", quantity: 400, unit: "g" }, { id: "salt", name: "Salt", quantity: null, unit: "g" }], ...overrides,
});
const selections = () => [
  recipe("library", { recipeId: "local" }),
  recipe("nyt-1", { draftId: "d", source: "https://cooking.nytimes.com/recipes/1021234-dinner", servings: 2 }),
  recipe("nyt-2", { recipeId: "import", source: "https://cooking.nytimes.com/recipes/1021234-new-title?campaign=a", photoUrl: "photo", servings: 6 }),
  recipe("routine:milk", { name: "Milk", servings: 1 }),
];
describe("weekly recipe plan summary", () => {
  it("groups exact NYT identity and excludes staples", () => {
    const items = selections();
    expect(groupRecipes(items)).toHaveLength(2);
    expect(groupRecipes(items)[1]).toMatchObject({ name: "Dinner", photoUrl: "photo", recipeId: "import", servings: 8 });
    expect(totalRecipeServings(items)).toBe(12);
    expect(isRecipeItem(recipe("routine:bake", { recipeId: "bake" }))).toBe(true);
    expect(totalRecipeServings([...items, recipe("routine:bake", { recipeId: "bake" })])).toBe(16);
  });
  it("preserves contributions and compiler scale when resizing and removing", () => {
    const items = selections(), snapshot = structuredClone(items), group = groupRecipes(items)[1];
    const resized = resizeRecipeGroup(items, group, 4);
    expect(resized.map(item => item.servings)).toEqual([4, 1, 3, 1]);
    expect(totalRecipeServings(resized)).toBe(8);
    expect(items).toEqual(snapshot);
    expect(resized[0]).toBe(items[0]);
    expect(resized[3]).toBe(items[3]);
    expect(resized[1].ingredients).toBe(items[1].ingredients);
    expect(resized[1].baseServings).toBe(4);
    const lines = compileSelectionLines(resized.slice(1, 3));
    expect(lines.find(line => line.name === "Rice")?.quantity).toBe(400);
    expect(lines.find(line => line.name === "Salt")?.quantity).toBeNull();
    expect(removeRecipeGroup(items, group)).toEqual([items[0], items[3]]);
  });
  it("does not merge by name or source prefix", () => {
    expect(groupRecipes([recipe("a"), recipe("b"), recipe("c", { source: "https://cooking.nytimes.com/recipes/1021234-a" }), recipe("d", { source: "https://cooking.nytimes.com/recipes/10212345-a" }), recipe("e", { source: "https://example.com/recipes/1021234-a" })])).toHaveLength(5);
  });
  it("joins shared library and draft identities in selection order", () => {
    const items = [recipe("a", { recipeId: "r" }), recipe("b", { draftId: "d" }), recipe("c", { recipeId: "r", draftId: "d" })];
    expect(groupRecipes(items)[0].items).toEqual(items);
  });
  it("keeps conflicting NYT identities separate when an alias-only snapshot bridges them", () => {
    const items = [
      recipe("nyt-a", { recipeId: "shared", source: "https://cooking.nytimes.com/recipes/1-a" }),
      recipe("nyt-b", { recipeId: "shared", source: "https://cooking.nytimes.com/recipes/2-b" }),
      recipe("bridge", { recipeId: "shared" }),
      recipe("bridge-copy", { recipeId: "shared" }),
    ];
    const groups = groupRecipes(items);
    expect(groups.map(group => group.items.map(item => item.id))).toEqual([
      ["nyt-a"], ["nyt-b"], ["bridge", "bridge-copy"],
    ]);
    expect(removeRecipeGroup(items, groups[0])).toEqual(items.slice(1));
    expect(resizeRecipeGroup(items, groups[0], 2).slice(1)).toEqual(items.slice(1));
  });
  it.each([0, -1, NaN, Infinity, 1001])("rejects invalid servings %s", servings => {
    const items = selections();
    expect(() => resizeRecipeGroup(items, groupRecipes(items)[0], servings)).toThrow(RangeError);
  });
});
