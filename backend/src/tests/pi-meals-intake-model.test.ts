import { describe, it, expect, vi } from "vitest";
import type { Models } from "@earendil-works/pi-ai/models";
import {
  extractEvidenceRecipe,
  validateEvidenceRecipe,
} from "../pi-meals/recipe-evidence-model.js";
const evidence = [
  {
    source: "speech" as const,
    text: "Take some courgettes and garlic and put them in a pan.",
  },
  {
    source: "speech" as const,
    text: "Boil the noodles and stir in the sauce.",
  },
  { source: "caption" as const, text: "200 g noodles" },
];
const proposal = {
  name: null,
  servings: null,
  ingredients: [
    {
      name: "courgettes",
      quantity: null,
      unit: "",
      quantityQuote: null,
      evidenceIndexes: [0],
      quote: evidence[0].text,
      uncertainty: null,
    },
    {
      name: "noodles",
      quantity: 200,
      unit: "g",
      quantityQuote: "200 g noodles",
      evidenceIndexes: [2],
      quote: evidence[2].text,
      uncertainty: null,
    },
  ],
  instructions: [
    { text: evidence[0].text, evidenceIndexes: [0], quote: evidence[0].text },
    { text: evidence[1].text, evidenceIndexes: [1], quote: evidence[1].text },
  ],
};
describe("grounded spoken recipe interpretation", () => {
  it("extracts quoted foods/actions with evidence references and preserves unknown amounts", () => {
    const result = validateEvidenceRecipe(proposal, evidence);
    expect(result.ingredients).toMatchObject([
      { name: "courgettes", quantity: null },
      { name: "noodles", quantity: 200, unit: "g" },
    ]);
    expect(result.instructions).toHaveLength(2);
    expect(result.evidenceReferences).toHaveLength(4);
    expect(result.gaps.join(" ")).toContain("transcription");
  });
  it("rejects unseen food names/actions and converts unquoted quantities to visible gaps", () => {
    const result = validateEvidenceRecipe(
      {
        ...proposal,
        ingredients: [
          { ...proposal.ingredients[0], name: "rice" },
          {
            ...proposal.ingredients[0],
            quantity: 2,
            unit: "piece",
            quantityQuote: "two courgettes",
          },
        ],
        instructions: [
          {
            text: "Bake for 20 minutes.",
            evidenceIndexes: [0],
            quote: evidence[0].text,
          },
        ],
      },
      evidence,
    );
    expect(result.ingredients).toHaveLength(1);
    expect(result.ingredients[0].quantity).toBeNull();
    expect(result.instructions).toHaveLength(0);
    expect(result.gaps.join(" ")).toContain("Unsupported ingredient");
    expect(result.gaps.join(" ")).toContain("Unverified proposed amount");
  });
  it("does not silently repair an unclear transcript food", () => {
    const garbled = [{ source: "speech" as const, text: "Add sulking tofu." }];
    const result = validateEvidenceRecipe(
      {
        ...proposal,
        ingredients: [
          {
            ...proposal.ingredients[0],
            name: "silken tofu",
            quote: garbled[0].text,
          },
        ],
        instructions: [],
      },
      garbled,
    );
    expect(result.ingredients).toHaveLength(0);
  });
  it("makes one bounded Pi call without retries or tools", async () => {
    const completeSimple = vi.fn(async () => ({
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify(proposal) }],
    }));
    const models = {
      getModel: () => ({ id: "gpt-6.1-sol" }),
      completeSimple,
    } as unknown as Models;
    const result = await extractEvidenceRecipe(evidence, {
      models,
      provider: "openai-codex",
      modelId: "gpt-6.1-sol",
    });
    expect(result.ingredients).toHaveLength(2);
    expect(completeSimple).toHaveBeenCalledTimes(1);
    const [, _context, options] = completeSimple.mock.calls[0] as unknown as [
      unknown,
      unknown,
      any,
    ];
    expect(options).toMatchObject({
      timeoutMs: 45000,
      maxRetries: 0,
      maxTokens: 4000,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("returns an actionable gap when the provider is unavailable or times out", async () => {
    const absent = await extractEvidenceRecipe(evidence, {
      provider: "",
      modelId: "",
    });
    expect(absent.gaps.join(" ")).toContain("authorised Pi");
    const models = {
      getModel: () => ({ id: "test" }),
      completeSimple: () => new Promise(() => {}),
    } as unknown as Models;
    const timeout = await extractEvidenceRecipe(evidence, {
      models,
      provider: "test",
      modelId: "test",
      timeoutMs: 5,
    });
    expect(timeout.ingredients).toHaveLength(0);
    expect(timeout.gaps.join(" ")).toContain("timed out");
  });
});
