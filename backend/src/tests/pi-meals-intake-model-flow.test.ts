import { describe, it, expect, vi, afterEach } from "vitest";
const source = vi.hoisted(() => ({
  text: "Add some courgettes and garlic to a pan.",
}));
const calls = vi.hoisted(() => ({
  complete: vi.fn(async () => ({
    stopReason: "stop",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          name: null,
          servings: null,
          ingredients: [
            {
              name: "courgettes",
              quantity: null,
              unit: "",
              quantityQuote: null,
              evidenceIndexes: [0],
              quote: source.text,
              uncertainty: null,
            },
            {
              name: "garlic",
              quantity: null,
              unit: "",
              quantityQuote: null,
              evidenceIndexes: [0],
              quote: source.text,
              uncertainty: null,
            },
          ],
          instructions: [
            { text: source.text, evidenceIndexes: [0], quote: source.text },
          ],
        }),
      },
    ],
  })),
}));
vi.mock("../pi-meals/instagram.js", () => ({
  instagramUrl: (url: string) => url,
  inspectInstagram: async () => ({
    evidence: [{ source: "speech", text: source.text }],
    gaps: ["On-screen text was unclear."],
  }),
}));
vi.mock("../pi-meals/provider.js", () => ({
  sharedPiMealModels: async () => ({
    getModel: () => ({ id: "test" }),
    completeSimple: calls.complete,
  }),
}));
import { createDraft, patchDraft } from "../pi-meals/intake.js";
describe("Instagram spoken evidence intake", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    calls.complete.mockClear();
  });
  it("persists editable foods, verbatim method and source references, while keeping quantities/yield unresolved", async () => {
    vi.stubEnv("PI_MEALS_MODEL_PROVIDER", "test");
    vi.stubEnv("PI_MEALS_MODEL_ID", "test");
    const documents = new Map<string, any>();
    const operations = new Map<string, any>();
    const prisma: any = {
      piMealDocument: {
        findUnique: async ({ where }: any) => documents.get(where.id),
        create: async ({ data }: any) => documents.set(data.id, data),
      },
      piMealOperation: {
        findUnique: async ({ where }: any) => operations.get(where.id),
        create: async ({ data }: any) => operations.set(data.id, data),
      },
    };
    prisma.$transaction = async (fn: any) => fn(prisma);
    const input = {
      operationId: "instagram",
      url: "https://instagram.com/reel/generic/",
    };
    const draft = await createDraft(prisma, "actor", input);
    expect(draft.ingredients.map((i) => i.name)).toEqual([
      "courgettes",
      "garlic",
    ]);
    expect(draft.ingredients.every((i) => i.quantity === null)).toBe(true);
    expect(draft.servings).toBeNull();
    expect(draft.instructions).toEqual([source.text]);
    expect(draft.evidenceReferences).toHaveLength(3);
    expect(draft.evidence[0].text).toBe(source.text);
    expect(draft.gaps.join(" ")).toContain("On-screen text was unclear.");
    expect(await createDraft(prisma, "actor", input)).toEqual(draft);
    expect(calls.complete).toHaveBeenCalledTimes(1);
  });
  it("retries an untouched partial method import but preserves each corrected field", async () => {
    const documents = new Map<string, any>();
    const operations = new Map<string, any>();
    const prisma: any = {
      piMealDocument: {
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
    vi.stubEnv("PI_MEALS_MODEL_PROVIDER", "");
    vi.stubEnv("PI_MEALS_MODEL_ID", "");
    const url = "https://instagram.com/reel/partial/";
    const initial = await createDraft(prisma, "actor", {
      operationId: "partial-first",
      url,
    });
    expect(initial.ingredients).toHaveLength(0);
    expect(initial.instructions).toHaveLength(1);
    vi.stubEnv("PI_MEALS_MODEL_PROVIDER", "test");
    vi.stubEnv("PI_MEALS_MODEL_ID", "test");
    const fresh = await createDraft(prisma, "actor", {
      operationId: "partial-fresh",
      url,
    });
    expect(fresh.ingredients).toHaveLength(2);
    expect(fresh.revision).toBe(2);
    expect(calls.complete).toHaveBeenCalledTimes(1);
    expect(
      await createDraft(prisma, "actor", { operationId: "partial-first", url }),
    ).toEqual(initial);
    for (const [index, patch] of [
      { name: "Edited name" },
      { servings: 3 },
      { instructions: ["Edited preparation."] },
      {
        ingredients: [{ name: "Edited ingredient", quantity: null, unit: "" }],
      },
    ].entries()) {
      vi.stubEnv("PI_MEALS_MODEL_PROVIDER", "");
      const correctedUrl = `https://instagram.com/reel/corrected${index}/`;
      const empty = await createDraft(prisma, "actor", {
        operationId: `uncorrected-${index}`,
        url: correctedUrl,
      });
      const corrected = await patchDraft(prisma, "actor", empty.id, {
        operationId: `edit-${index}`,
        expectedRevision: 1,
        draft: patch,
      });
      vi.stubEnv("PI_MEALS_MODEL_PROVIDER", "test");
      expect(
        await createDraft(prisma, "actor", {
          operationId: `retry-${index}`,
          url: correctedUrl,
        }),
      ).toEqual(corrected);
    }
    expect(calls.complete).toHaveBeenCalledTimes(1);
  });
});
