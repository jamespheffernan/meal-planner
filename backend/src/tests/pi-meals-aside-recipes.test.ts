import { describe, it, expect } from "vitest";
import {
  nytRecipeUrl,
  nytRecipeIdentity,
  parseAsideOutput,
  recipeSnapshotEvidence,
} from "../pi-meals/aside-recipes.js";
import { extractDraft } from "../pi-meals/intake.js";
describe("Aside recipe boundary", () => {
  it("allows only recipe URLs and identifies the numeric recipe", () => {
    expect(
      nytRecipeUrl(
        "https://cooking.nytimes.com/recipes/123-soup/?utm_source=x#step",
      ),
    ).toBe("https://cooking.nytimes.com/recipes/123-soup");
    expect(
      nytRecipeIdentity("https://cooking.nytimes.com/recipes/123-soup"),
    ).toBe("123");
    for (const url of [
      "http://cooking.nytimes.com/recipes/123",
      "https://cooking.nytimes.com.evil.test/recipes/123",
      "https://user@cooking.nytimes.com/recipes/123",
      "https://cooking.nytimes.com:8080/recipes/123",
      "https://cooking.nytimes.com/search?q=soup",
      "https://cooking.nytimes.com/recipes/123/other",
    ])
      expect(() => nytRecipeUrl(url)).toThrow();
  });
  it("extracts a marked JSON result through CLI noise", () => {
    expect(
      parseAsideOutput(
        'opened tab\nMARK:{"tree":"text with \\n and quotes"}\n[ok]',
        "MARK:",
      ),
    ).toEqual({ tree: "text with \n and quotes" });
    expect(() => parseAsideOutput("MARK:invalid", "MARK:")).toThrow(
      "unreadable",
    );
    expect(() => parseAsideOutput("other:{}", "MARK:")).toThrow(
      "no recipe result",
    );
  });
  it("preserves recipe evidence and excludes comments and recommendations", () => {
    const tree =
      '- title: "Page"\n- main:\n  - heading "Synthetic soup" [level=1]\n  - heading "Ingredients" [level=2]\n  - text: "Yield:2 servings"\n  - list:\n    - listitem: "200 g tomatoes"\n    - listitem: "1 onion"\n  - button "Add to Grocery List" [ref=e1]\n  - heading "Preparation" [level=2]\n  - list:\n    - listitem: "Step  1 Simmer the ingredients."\n  - complementary:\n    - heading "Similar Recipes" [level=3]\n    - listitem: "999 g unrelated food"\n  - heading "Comments" [level=2]\n  - text: "Wrong recipe"';
    const evidence = recipeSnapshotEvidence(tree);
    const draft = extractDraft(
      "id",
      "https://cooking.nytimes.com/recipes/123",
      evidence,
    );
    expect(draft.name).toBe("Synthetic soup");
    expect(draft.servings).toBe(2);
    expect(draft.ingredients).toHaveLength(2);
    expect(draft.instructions).toEqual(["Simmer the ingredients."]);
    expect(draft.status).toBe("ready");
    expect(evidence[0].text).not.toContain("unrelated");
    expect(evidence[0].text).not.toContain("Comments");
    expect(() =>
      recipeSnapshotEvidence('- heading "Sign in" [level=1]'),
    ).toThrow("not visible");
  });
});
