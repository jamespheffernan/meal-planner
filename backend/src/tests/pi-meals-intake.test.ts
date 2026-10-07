import { describe, it, expect } from "vitest";
import {
  extractDraft,
  canonicalSource,
  updateDraft,
} from "../pi-meals/intake.js";
describe("recipe intake evidence", () => {
  it("extracts sourced text without inventing a yield", () => {
    const draft = extractDraft("test", "https://example.com/recipe", [
      {
        source: "page",
        text: "Soup\nIngredients\n200 g tomatoes\n1 onion\nMethod\nChop and simmer.",
      },
    ]);
    expect(draft.ingredients).toHaveLength(2);
    expect(draft.servings).toBeNull();
    expect(draft.status).toBe("draft");
    expect(draft.evidence[0].source).toBe("page");
  });
  it("corroborates duplicate captions/speech/OCR instead of adding amounts", () => {
    const draft = extractDraft("test", "", [
      {
        source: "caption",
        text: "Soup\nServes 2\nIngredients\n200 g tomatoes\nMethod\nSimmer.",
      },
      { source: "ocr", text: "200 g tomatoes" },
      { source: "speech", text: "200 g tomatoes" },
    ]);
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.ingredients[0].quantity).toBe(200);
    expect(draft.status).toBe("ready");
  });
  it("keeps conflicting and ranged quantities unresolved", () => {
    const draft = extractDraft("test", "", [
      {
        source: "caption",
        text: "Soup\nServes 2\nIngredients\n200 g tomatoes\n2-3 onions\nMethod\nSimmer.",
      },
      { source: "ocr", text: "300 g tomatoes" },
    ]);
    expect(draft.ingredients.every((i) => i.quantity === null)).toBe(true);
    expect(draft.gaps.some((g) => g.includes("Conflicting"))).toBe(true);
  });
  it("preserves evidence through user correction and calculates readiness", () => {
    const original = extractDraft("test", "", [
      { source: "user", text: "Soup\nIngredients\nsalt\nMethod\nSimmer." },
    ]);
    const changed = updateDraft(original, {
      name: "My soup",
      servings: 2,
      ingredients: [{ name: "salt", quantity: 1, unit: "g" }],
      instructions: ["Simmer."],
    });
    expect(changed.evidence).toEqual(original.evidence);
    expect(changed.name).toBe("My soup");
    expect(changed.status).toBe("ready");
  });
  it("keeps source warnings when an unchanged name is saved and removes resolved quantity gaps", () => {
    const warnings = [
      "Transcript food name needs review: unusual bean spelling.",
      "Speech transcription may be incomplete.",
    ];
    const original = extractDraft(
      "source-warnings",
      "",
      [
        {
          source: "speech",
          text: "Soup\nServes 2\nIngredients\nbeans\nMethod\nSimmer.",
        },
      ],
      warnings,
    );
    original.evidenceReferences = [
      { field: "ingredients.0.name", evidenceIndexes: [0], quote: "beans" },
    ];
    const unchanged = updateDraft(original, {
      name: original.name,
      ingredients: original.ingredients,
    });
    expect(unchanged.gaps).toEqual(original.gaps);
    expect(unchanged.evidence).toEqual(original.evidence);
    expect(unchanged.evidenceReferences).toEqual(original.evidenceReferences);
    const corrected = updateDraft(unchanged, {
      ingredients: [{ name: "beans", quantity: 200, unit: "g" }],
    });
    expect(corrected.gaps).toEqual(warnings);
    expect(corrected.gaps).not.toContain("Quantity needed for beans.");
    expect(corrected.gaps).not.toContain("Unit needed for beans.");
    expect(corrected.status).toBe("ready");
    expect(corrected.evidenceReferences).toEqual([]);
    expect(updateDraft(corrected, { name: corrected.name }).gaps).toEqual(
      warnings,
    );
  });
  it("canonicalizes tracking URL variants", () =>
    expect(
      canonicalSource("https://www.instagram.com/reel/ABC/?igsh=xxx#x"),
    ).toBe("https://www.instagram.com/reel/ABC/"));
});

describe("Aside accessibility recipe evidence", () => {
  const snapshot = `  - heading "Vegetable stew" [level=1]
  - heading "Ingredients" [level=2]
  - text: "Yield:4 servings"
  - list:
    - listitem: "200 g carrots"
    - listitem:
      - text: "2"
      - text: "onions"
    - listitem: "Salt"
  - button "Add ingredients to Grocery List" [ref=e25]
  - link "Ingredient Substitution Guide" [ref=e26]
  - heading "Preparation" [level=2]
  - list:
    - listitem: "Step  1 Chop the vegetables."
    - listitem: "Step  2 Simmer until soft."`;
  it("reads headings, yields, flat and nested list items without treating controls as recipe content", () => {
    const evidence = [{ source: "page" as const, text: snapshot }];
    const draft = extractDraft("aside", "https://example.com/stew", evidence);
    expect(draft.name).toBe("Vegetable stew");
    expect(draft.servings).toBe(4);
    expect(draft.ingredients.map((i) => i.name)).toEqual([
      "carrots",
      "onions",
      "salt",
    ]);
    expect(draft.instructions).toHaveLength(2);
    expect(draft.ingredients[0].quantity).toBe(200);
    expect(draft.ingredients[1].quantity).toBe(2);
    expect(draft.ingredients[2].quantity).toBeNull();
    expect(draft.evidence).toEqual(evidence);
  });
  it("keeps a ranged source yield unresolved", () => {
    const draft = extractDraft("aside", "", [
      {
        source: "page",
        text: snapshot.replace("Yield:4 servings", "Yield:4 to 6 servings"),
      },
    ]);
    expect(draft.servings).toBeNull();
    expect(draft.gaps).toContain("Uncertain yield: Yield:4 to 6 servings");
  });
});

describe("source amount and ingredient-name preservation", () => {
  it("keeps a stated base amount when more is optional and keeps comma-separated food descriptors", () => {
    const draft = extractDraft("quantities", "", [
      {
        source: "page",
        text: "Stew\nServes 4\nIngredients\n¾ teaspoon paprika, plus more to taste\n1 pound boneless, skinless turkey thighs, cut into pieces\nMethod\nSimmer.",
      },
    ]);
    expect(draft.ingredients[0]).toMatchObject({
      name: "paprika",
      quantity: 0.75,
      unit: "tsp",
    });
    expect(draft.ingredients[1]).toMatchObject({
      name: "boneless skinless turkey thighs",
      quantity: 1,
      unit: "lb",
    });
  });
  it("combines explicitly stated compatible amounts in one ingredient line", () => {
    const draft = extractDraft("quantities", "", [
      {
        source: "page",
        text: "Dressing\nServes 4\nIngredients\n⅓ cup plus 2 tablespoons olive oil\nMethod\nWhisk.",
      },
    ]);
    expect(draft.ingredients[0].name).toBe("olive oil");
    expect(draft.ingredients[0].unit).toBe("cup");
    expect(draft.ingredients[0].quantity).toBeCloseTo(1 / 3 + 1 / 8, 4);
    expect(draft.ingredients[0].raw).toBe("⅓ cup plus 2 tablespoons olive oil");
  });
  it("keeps a combined incompatible amount unresolved", () => {
    const draft = extractDraft("quantities", "", [
      {
        source: "page",
        text: "Dressing\nServes 4\nIngredients\n1 cup plus 2 grams seeds\nMethod\nMix.",
      },
    ]);
    expect(draft.ingredients[0].quantity).toBeNull();
    expect(draft.gaps.some((g) => g.includes("Uncertain quantity"))).toBe(true);
  });
});
