import { describe, it, expect, vi } from "vitest";
const cli = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: cli.execFile }));
import {
  captureAsideRecipe,
  nytRecipePhotoUrl,
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

describe("Aside optional photo capture", () => {
  const tree =
    '- heading "Soup" [level=1]\n- heading "Ingredients" [level=2]\n- list:\n  - listitem: "1 onion"\n- heading "Preparation" [level=2]\n- list:\n  - listitem: "Step 1 Cook."';
  const recipeUrl = "https://cooking.nytimes.com/recipes/123-soup";
  function harness(options: {
    existing?: boolean;
    photo?: unknown;
    photoError?: boolean;
    snapshotError?: boolean;
    url?: string;
  }) {
    const close = vi.fn();
    const evaluate = vi.fn(async () => {
      if (options.photoError) throw new Error("missing metadata");
      return options.photo;
    });
    const target = { url: () => options.url ?? recipeUrl, evaluate };
    cli.execFile.mockImplementation((_binary, args, limits, callback) => {
      expect(limits.timeout).toBe(45_000);
      expect(limits.maxBuffer).toBe(2_000_000);
      const Run = Object.getPrototypeOf(async function () {}).constructor;
      const output: string[] = [];
      const run = new Run(
        "listBrowserTabs",
        "attachBrowserTab",
        "page",
        "openTab",
        "snapshot",
        "closeTab",
        "console",
        args[1],
      );
      void run(
        async () =>
          options.existing ? [{ targetId: "existing", url: recipeUrl }] : [],
        async () => {},
        target,
        async () => target,
        async () => {
          if (options.snapshotError) throw new Error("snapshot failure");
          return { tree };
        },
        close,
        { log: (line: string) => output.push(line) },
      ).then(
        () => callback(null, output.join("\n")),
        (error: Error) => callback(error, ""),
      );
    });
    return { close, evaluate };
  }
  it("validates only observed NYT CDN HTTPS images", () => {
    expect(nytRecipePhotoUrl("https://static01.nyt.com/images/soup.jpg")).toBe(
      "https://static01.nyt.com/images/soup.jpg",
    );
    for (const photo of [
      undefined,
      2,
      "http://static01.nyt.com/a",
      "https://static01.nyt.com.evil.test/a",
      "https://user@static01.nyt.com/a",
      "https://static01.nyt.com:8080/a",
      "data:image/png;base64,a",
    ])
      expect(nytRecipePhotoUrl(photo)).toBeUndefined();
  });
  it("captures a photo and closes an owned tab", async () => {
    const { close } = harness({
      photo: "https://static01.nyt.com/images/soup.jpg",
    });
    const result = await captureAsideRecipe(recipeUrl);
    expect(result.photoUrl).toBe("https://static01.nyt.com/images/soup.jpg");
    expect(result.evidence[0].text).toContain("1 onion");
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    { photo: undefined },
    { photo: "https://evil.test/image.jpg" },
    { photoError: true },
  ])(
    "keeps text when optional photo is absent, unsafe or unreadable: %j",
    async (options) => {
      const { close } = harness({ ...options, existing: true });
      const result = await captureAsideRecipe(recipeUrl);
      expect(result.photoUrl).toBeUndefined();
      expect(result.evidence).toHaveLength(1);
      expect(close).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])("cleans up only owned tabs on read errors (existing=%s)", async existing => {
    const { close } = harness({ snapshotError: true, existing });
    await expect(captureAsideRecipe(recipeUrl)).rejects.toThrow(
      "failed or timed out",
    );
    expect(close).toHaveBeenCalledTimes(existing ? 0 : 1);
  });
  it("rejects wrong recipe identity before reading metadata and closes owned tabs", async () => {
    const { close, evaluate } = harness({
      url: "https://cooking.nytimes.com/recipes/456-other",
    });
    await expect(captureAsideRecipe(recipeUrl)).rejects.toThrow(
      "different recipe",
    );
    expect(evaluate).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
