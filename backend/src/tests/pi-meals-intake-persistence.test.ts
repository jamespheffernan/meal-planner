import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonical } from "../pi-meals/store.js";
import { extractDraft } from "../pi-meals/intake.js";
import type { PrismaClient } from "@prisma/client";
import {
  createDraft,
  patchDraft,
  saveDraft,
  fetchRecipePage,
} from "../pi-meals/intake.js";
vi.mock("../pi-meals/aside-recipes.js", async (original) => ({
  ...(await original<typeof import("../pi-meals/aside-recipes.js")>()),
  captureAsideRecipe: vi.fn(async () => {
    throw new Error("Sign in to your authorised Aside session and retry.");
  }),
}));
import { captureAsideRecipe } from "../pi-meals/aside-recipes.js";
function memoryStore() {
  const documents = new Map<string, any>();
  const operations = new Map<string, any>();
  const recipes = new Map<string, any>();
  const ingredientRows = new Map<string, any>();
  const client: any = {
    piMealDocument: {
      findMany: vi.fn(async ({ where }: any) =>
        [...documents.values()].filter((row) => row.kind === where.kind),
      ),
      findUnique: vi.fn(
        async ({ where }: any) => documents.get(where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        documents.set(data.id, data);
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = documents.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        documents.set(row.id, { ...row, ...data });
        return { count: 1 };
      }),
    },
    piMealOperation: {
      findUnique: vi.fn(
        async ({ where }: any) => operations.get(where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        if (operations.has(data.id)) throw Error("duplicate");
        operations.set(data.id, data);
        return data;
      }),
    },
    ingredient: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const row = ingredientRows.get(where.name) ?? {
          id: where.name,
          ...create,
        };
        ingredientRows.set(where.name, row);
        return row;
      }),
    },
    recipe: {
      create: vi.fn(async ({ data }: any) => {
        if (recipes.has(data.id)) throw Error("duplicate recipe");
        recipes.set(data.id, data);
        return data;
      }),
    },
  };
  client.$transaction = async (fn: any) => fn(client);
  return {
    prisma: client as PrismaClient,
    client,
    documents,
    recipes,
    operations,
  };
}
const recipe =
  "Soup\nServes 2\nIngredients\n200 g tomatoes\n1 onion\nMethod\nChop and simmer.";
describe("persisted recipe intake", () => {
  it("replays the original import receipt after a correction and rejects actor or payload reuse", async () => {
    const store = memoryStore();
    const input = {
      operationId: "original",
      url: "https://example.com/soup",
      text: recipe,
    };
    const original = await createDraft(store.prisma, "actor", input);
    await patchDraft(store.prisma, "actor", original.id, {
      operationId: "edit",
      expectedRevision: 1,
      draft: { name: "Corrected soup" },
    });
    expect(await createDraft(store.prisma, "actor", input)).toEqual(original);
    await expect(
      createDraft(store.prisma, "other-actor", input),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      createDraft(store.prisma, "actor", { ...input, text: "different" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("records the canonical winner under a fresh receipt after a document creation race", async () => {
    const store = memoryStore();
    const input = {
      operationId: "winner",
      url: "https://example.com/soup",
      text: recipe,
    };
    const winner = await createDraft(store.prisma, "actor", input);
    store.client.piMealDocument.findUnique.mockResolvedValueOnce(null);
    const raced = await createDraft(store.prisma, "actor", {
      ...input,
      operationId: "concurrent",
    });
    expect(raced).toEqual(winner);
    expect(store.operations.has("concurrent")).toBe(true);
    await patchDraft(store.prisma, "actor", winner.id, {
      operationId: "after-race",
      expectedRevision: 1,
      draft: { name: "Changed later" },
    });
    expect(
      await createDraft(store.prisma, "actor", {
        ...input,
        operationId: "concurrent",
      }),
    ).toEqual(winner);
  });
  it("does not swallow a command collision when another request concurrently creates the target draft", async () => {
    const store = memoryStore();
    const input = {
      operationId: "colliding",
      url: "https://example.com/soup",
      text: recipe,
    };
    const winner = await createDraft(store.prisma, "actor", {
      ...input,
      operationId: "winner",
    });
    await createDraft(store.prisma, "actor", {
      operationId: "colliding",
      text: recipe,
    });
    store.client.piMealOperation.findUnique.mockResolvedValueOnce(null);
    store.client.piMealDocument.findUnique.mockResolvedValueOnce(null);
    await expect(
      createDraft(store.prisma, "actor", input),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(store.documents.get(winner.id).revision).toBe(1);
  });

  it("preserves corrections when URL is reimported and rejects command reuse", async () => {
    const store = memoryStore();
    const draft = await createDraft(store.prisma, "actor", {
      operationId: "create",
      url: "https://example.com/soup",
      text: recipe,
    });
    const changed = await patchDraft(store.prisma, "actor", draft.id, {
      operationId: "patch",
      expectedRevision: 1,
      draft: { name: "Corrected soup" },
    });
    const retry = await createDraft(store.prisma, "actor", {
      operationId: "retry",
      url: "https://example.com/soup?utm_source=x",
      text: "wrong text",
    });
    expect(retry.name).toBe("Corrected soup");
    expect(retry.revision).toBe(changed.revision);
    await expect(
      createDraft(store.prisma, "actor", {
        operationId: "retry",
        url: "https://example.com/soup",
        text: "another change",
      }),
    ).rejects.toThrow("command ID");
  });
  it("explicit save creates ingredients, steps and one canonical recipe across retries", async () => {
    const store = memoryStore();
    const draft = await createDraft(store.prisma, "actor", {
      operationId: "create",
      text: recipe,
    });
    const saved = await saveDraft(store.prisma, "actor", draft.id, {
      operationId: "save",
      expectedRevision: 1,
    });
    expect(saved.status).toBe("saved");
    expect(saved.recipeId).toBeTruthy();
    expect(
      store.recipes.get(saved.recipeId!)?.recipeIngredients.create,
    ).toHaveLength(2);
    expect(
      await saveDraft(store.prisma, "actor", draft.id, {
        operationId: "save",
        expectedRevision: 1,
      }),
    ).toEqual(saved);
    expect(
      (
        await saveDraft(store.prisma, "actor", draft.id, {
          operationId: "save-again",
          expectedRevision: 1,
        })
      ).recipeId,
    ).toBe(saved.recipeId);
    expect(store.client.recipe.create).toHaveBeenCalledTimes(1);
  });
  it("incomplete amounts remain persisted but cannot create a canonical recipe", async () => {
    const store = memoryStore();
    const draft = await createDraft(store.prisma, "actor", {
      operationId: "create",
      text: "Soup\nServes 2\nIngredients\ntomatoes\nMethod\nSimmer.",
    });
    expect(store.documents.has(draft.id)).toBe(true);
    await expect(
      saveDraft(store.prisma, "actor", draft.id, {
        operationId: "save",
        expectedRevision: 1,
      }),
    ).rejects.toThrow("Quantity needed");
    expect(store.client.recipe.create).not.toHaveBeenCalled();
  });
  it("captures NYT automatically, persists evidence and deduplicates recipe identity without recapture", async () => {
    vi.mocked(captureAsideRecipe).mockResolvedValueOnce([
      { source: "page", text: recipe },
    ]);
    const store = memoryStore();
    const url = "https://cooking.nytimes.com/recipes/123-soup";
    const input = { operationId: "automatic", url };
    const draft = await createDraft(store.prisma, "actor", input);
    expect(draft.status).toBe("ready");
    expect(draft.source).toBe(url);
    expect(store.documents.get(draft.id).data.evidence).toEqual(draft.evidence);
    expect(await createDraft(store.prisma, "actor", input)).toEqual(draft);
    const calls = vi.mocked(captureAsideRecipe).mock.calls.length;
    expect(
      await createDraft(store.prisma, "actor", {
        operationId: "duplicate-nyt",
        url: "https://cooking.nytimes.com/recipes/123-another-slug?utm_source=test",
      }),
    ).toEqual(draft);
    expect(vi.mocked(captureAsideRecipe).mock.calls.length).toBe(calls);
  });
  it("reuses an edited legacy URL-hash NYT draft for another slug and replays its original receipt", async () => {
    const store = memoryStore();
    const oldUrl =
      "https://cooking.nytimes.com/recipes/123-old-slug?smid=legacy";
    const id = `recipe-draft-${createHash("sha256").update(oldUrl).digest("hex")}`;
    const oldInput = {
      operationId: "legacy-original",
      url: oldUrl,
      text: recipe,
    };
    const original = {
      ...extractDraft(id, oldUrl, [{ source: "user", text: recipe }]),
      revision: 1,
    };
    const corrected = {
      ...original,
      name: "My corrected soup",
      servings: 6,
      revision: 4,
    };
    store.documents.set(id, {
      id,
      kind: "recipe-draft",
      data: corrected,
      revision: 4,
      updatedAt: new Date(),
    });
    store.operations.set(oldInput.operationId, {
      payloadHash: createHash("sha256")
        .update(
          canonical({
            id,
            kind: "recipe-draft",
            actorId: "actor",
            expectedRevision: 0,
            payload: oldInput,
          }),
        )
        .digest("hex"),
      result: { id, kind: "recipe-draft", data: original, revision: 1 },
    });
    const captures = vi.mocked(captureAsideRecipe).mock.calls.length;
    const retryInput = {
      operationId: "legacy-retry",
      url: "https://cooking.nytimes.com/recipes/123-new-slug",
    };
    expect(await createDraft(store.prisma, "actor", retryInput)).toEqual(
      corrected,
    );
    expect(store.documents.size).toBe(1);
    expect(vi.mocked(captureAsideRecipe).mock.calls.length).toBe(captures);
    expect(store.operations.get("legacy-retry").documentId).toBe(id);
    expect(await createDraft(store.prisma, "actor", retryInput)).toEqual(
      corrected,
    );
    expect(await createDraft(store.prisma, "actor", oldInput)).toEqual(
      original,
    );
    await expect(
      createDraft(store.prisma, "other-actor", oldInput),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      createDraft(store.prisma, "actor", {
        ...oldInput,
        url: "https://cooking.nytimes.com/recipes/456-other",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("creates an actionable draft for NYT without network or cookie access", async () => {
    const store = memoryStore();
    const draft = await createDraft(store.prisma, "actor", {
      operationId: "create",
      url: "https://cooking.nytimes.com/recipes/123",
    });
    expect(draft.gaps.join(" ")).toContain("authorised Aside");
    expect(draft.status).toBe("draft");
  });
  it("fills an untouched handoff draft when authorised text arrives without overwriting later corrections", async () => {
    const store = memoryStore();
    const url = "https://cooking.nytimes.com/recipes/123";
    const empty = await createDraft(store.prisma, "actor", {
      operationId: "empty",
      url,
    });
    const filled = await createDraft(store.prisma, "actor", {
      operationId: "fill",
      url,
      text: recipe,
    });
    expect(filled.id).toBe(empty.id);
    expect(filled.status).toBe("ready");
    expect(filled.revision).toBe(2);
    const retry = await createDraft(store.prisma, "actor", {
      operationId: "fill",
      url,
      text: recipe,
    });
    expect(retry).toEqual(filled);
  });
  it("rejects private network and non-HTTPS fetches", async () => {
    await expect(fetchRecipePage("https://127.0.0.1/recipe")).rejects.toThrow(
      "private",
    );
    await expect(fetchRecipePage("http://example.com/recipe")).rejects.toThrow(
      "HTTPS",
    );
  });
});
