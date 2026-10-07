import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
const fixtures = vi.hoisted(() => ({
  responses: [] as Array<{
    status: number;
    location?: string;
    body?: string;
    error?: string;
  }>,
  requests: [] as string[],
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [
    {
      address: host === "127.0.0.1" ? "127.0.0.1" : "93.184.216.34",
      family: 4,
    },
  ]),
}));
vi.mock("node:https", () => ({
  request: (
    url: URL,
    _options: unknown,
    callback: (response: unknown) => void,
  ) => {
    fixtures.requests.push(url.toString());
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.destroy = (error: Error) => request.emit("error", error);
    request.end = () =>
      queueMicrotask(() => {
        const fixture = fixtures.responses.shift()!;
        if (fixture.error) {
          request.emit("error", new Error(fixture.error));
          return;
        }
        const response = new EventEmitter() as any;
        response.statusCode = fixture.status;
        response.headers = { location: fixture.location };
        response.resume = () => {};
        response.destroy = () => {};
        callback(response);
        queueMicrotask(() => {
          if (fixture.body) response.emit("data", Buffer.from(fixture.body));
          response.emit("end");
        });
      });
    return request;
  },
}));
vi.mock("../pi-meals/aside-recipes.js", async (original) => ({
  ...(await original<typeof import("../pi-meals/aside-recipes.js")>()),
  captureAsideRecipe: vi.fn(async () => {
    throw new Error("Sign in to your authorised Aside session and retry.");
  }),
}));
import { fetchRecipePage, createDraft } from "../pi-meals/intake.js";
describe("bounded recipe fetch", () => {
  beforeEach(() => {
    fixtures.responses = [];
    fixtures.requests = [];
  });
  it("rejects a redirect into the private network before sending that request", async () => {
    fixtures.responses = [
      { status: 302, location: "https://127.0.0.1/recipe" },
    ];
    await expect(fetchRecipePage("https://example.com/recipe")).rejects.toThrow(
      "private",
    );
    expect(fixtures.requests).toHaveLength(1);
  });
  it("reports inaccessible status and unreachable network as draft gaps", async () => {
    const documents = new Map<string, any>();
    const operations = new Map<string, any>();
    const prisma: any = {
      piMealDocument: {
        findMany: async ({where}: any) => [...documents.values()].filter(row => row.kind === where.kind),
        findUnique: async ({ where }: any) => documents.get(where.id),
        create: async ({ data }: any) => documents.set(data.id, data),
      },
      piMealOperation: {
        findUnique: async ({ where }: any) => operations.get(where.id),
        create: async ({ data }: any) => operations.set(data.id, data),
      },
    };
    prisma.$transaction = async (fn: any) => fn(prisma);
    fixtures.responses = [{ status: 403 }];
    const inaccessible = await createDraft(prisma, "actor", {
      operationId: "a",
      url: "https://example.com/private",
    });
    expect(inaccessible.gaps.join(" ")).toContain("(403)");
    fixtures.responses = [{ status: 0, error: "Connection refused" }];
    const unreachable = await createDraft(prisma, "actor", {
      operationId: "b",
      url: "https://example.com/unreachable",
    });
    expect(unreachable.gaps.join(" ")).toContain("Connection refused");
  });
  it("extracts structured recipe evidence from a public page", async () => {
    const documents = new Map<string, any>();
    const operations = new Map<string, any>();
    const prisma: any = {
      piMealDocument: {
        findMany: async ({where}: any) => [...documents.values()].filter(row => row.kind === where.kind),
        findUnique: async ({ where }: any) => documents.get(where.id),
        create: async ({ data }: any) => documents.set(data.id, data),
      },
      piMealOperation: {
        findUnique: async ({ where }: any) => operations.get(where.id),
        create: async ({ data }: any) => operations.set(data.id, data),
      },
    };
    prisma.$transaction = async (fn: any) => fn(prisma);
    fixtures.responses = [
      {
        status: 200,
        body:
          '<script type="application/ld+json">' +
          JSON.stringify({
            "@type": "Recipe",
            name: "Soup",
            recipeYield: "2 servings",
            recipeIngredient: ["200 g tomatoes"],
            recipeInstructions: [{ "@type": "HowToStep", text: "Simmer." }],
          }) +
          "</script>",
      },
    ];
    const draft = await createDraft(prisma, "actor", {
      operationId: "a",
      url: "https://example.com/recipe",
    });
    expect(draft.name).toBe("Soup");
    expect(draft.servings).toBe(2);
    expect(draft.ingredients[0].quantity).toBe(200);
    expect(draft.status).toBe("ready");
    expect(draft.evidence[0].source).toBe("page");
  });
  it("retries failed URL extraction only for a fresh operation and leaves corrected drafts unchanged", async () => {
    const documents = new Map<string, any>();
    const operations = new Map<string, any>();
    const prisma: any = {
      piMealDocument: {
        findMany: async ({where}: any) => [...documents.values()].filter(row => row.kind === where.kind),
        findUnique: async ({ where }: any) => documents.get(where.id),
        create: async ({ data }: any) => documents.set(data.id, data),
        updateMany: async ({ where, data }: any) => {
          const row = documents.get(where.id);
          if (!row || row.revision !== where.revision) return { count: 0 };
          documents.set(row.id, { ...row, ...data });
          return { count: 1 };
        },
      },
      piMealOperation: {
        findUnique: async ({ where }: any) => operations.get(where.id),
        create: async ({ data }: any) => operations.set(data.id, data),
      },
    };
    prisma.$transaction = async (fn: any) => fn(prisma);
    const url = "https://example.com/retry";
    fixtures.responses = [
      { status: 403 },
      {
        status: 200,
        body:
          '<script type="application/ld+json">' +
          JSON.stringify({
            "@type": "Recipe",
            name: "Recovered soup",
            recipeYield: "2 servings",
            recipeIngredient: ["200 g tomatoes"],
            recipeInstructions: ["Simmer."],
          }) +
          "</script>",
      },
    ];
    const failed = await createDraft(prisma, "actor", {
      operationId: "first",
      url,
    });
    expect(
      await createDraft(prisma, "actor", { operationId: "first", url }),
    ).toEqual(failed);
    expect(fixtures.requests).toHaveLength(1);
    const recovered = await createDraft(prisma, "actor", {
      operationId: "fresh",
      url,
    });
    expect(recovered.name).toBe("Recovered soup");
    expect(recovered.status).toBe("ready");
    expect(fixtures.requests).toHaveLength(2);
    expect(
      await createDraft(prisma, "actor", { operationId: "first", url }),
    ).toEqual(failed);
    await createDraft(prisma, "actor", { operationId: "duplicate", url });
    expect(fixtures.requests).toHaveLength(2);
    const empty = await createDraft(prisma, "actor", {
      operationId: "empty",
      url: "https://cooking.nytimes.com/recipes/123",
    });
    const { patchDraft } = await import("../pi-meals/intake.js");
    const corrected = await patchDraft(prisma, "actor", empty.id, {
      operationId: "correct",
      expectedRevision: 1,
      draft: { name: "My corrected name", servings: 3 },
    });
    expect(
      await createDraft(prisma, "actor", {
        operationId: "new",
        url: "https://cooking.nytimes.com/recipes/123",
      }),
    ).toEqual(corrected);
    expect(fixtures.requests).toHaveLength(2);
  });
});
