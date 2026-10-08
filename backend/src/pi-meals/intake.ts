import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type {
  EvidenceLine,
  RecipeDraft,
  RecipeIngredientInput,
} from "./contracts.js";
import { convertQuantity } from "../services/units.js";
import { parseIngredientString } from "../services/ingredient-parser.js";
import {
  MealConflict,
  mutateDocument,
  readDocument,
  canonical,
} from "./store.js";
import { inspectInstagram, instagramUrl } from "./instagram.js";
import {
  captureAsideRecipe,
  nytRecipeIdentity,
  nytRecipeUrl,
} from "./aside-recipes.js";
import { extractEvidenceRecipe } from "./recipe-evidence-model.js";

export class IntakeError extends Error {
  statusCode = 400;
}
const evidenceSchema = z
  .object({
    source: z.enum(["caption", "speech", "ocr", "page", "user"]),
    text: z.string().min(1).max(128_000),
  })
  .strict();
export const intakeSchema = z
  .object({
    operationId: z.string().min(1).max(200),
    url: z.string().max(4000).optional(),
    text: z.string().max(128_000).optional(),
    evidence: z.array(evidenceSchema).max(2000).optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.url || v.text || v.evidence?.length),
    "Provide a URL, recipe text or evidence.",
  );
const ingredientSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1).max(500),
    quantity: z.number().positive().finite().nullable(),
    unit: z.string().trim().max(50),
    raw: z.string().max(2000).optional(),
  })
  .strict();
export const patchSchema = z
  .object({
    operationId: z.string().min(1).max(200),
    expectedRevision: z.number().int().nonnegative(),
    draft: z
      .object({
        name: z.string().trim().min(1).max(500).optional(),
        servings: z.number().int().positive().nullable().optional(),
        ingredients: z.array(ingredientSchema).max(500).optional(),
        instructions: z
          .array(z.string().trim().min(1).max(10_000))
          .max(500)
          .optional(),
      })
      .strict(),
  })
  .strict();
export const saveSchema = z
  .object({
    operationId: z.string().min(1).max(200),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export function canonicalSource(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IntakeError("Use a valid HTTPS recipe URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new IntakeError(
      "Use an HTTPS recipe URL without credentials or a custom port.",
    );
  if (["instagram.com", "www.instagram.com"].includes(url.hostname))
    return instagramUrl(value);
  if (url.hostname === "cooking.nytimes.com") return nytRecipeUrl(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid|gclid|igsh)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function recipeGaps(
  draft: Pick<
    RecipeDraft,
    "name" | "servings" | "ingredients" | "instructions"
  >,
): string[] {
  const gaps: string[] = [];
  if (!draft.name || draft.name === "Untitled recipe")
    gaps.push("Recipe name is missing.");
  if (!draft.servings) gaps.push("Confirm a single base serving yield.");
  if (!draft.ingredients.length) gaps.push("Ingredients are missing.");
  for (const line of draft.ingredients) {
    if (line.quantity === null) gaps.push(`Quantity needed for ${line.name}.`);
    if (!line.unit) gaps.push(`Unit needed for ${line.name}.`);
  }
  if (!draft.instructions.length) gaps.push("Instructions are missing.");
  return gaps;
}
// Keeping a recipe and calculating an exact shopping amount are separate decisions.
// Unspecified ingredient amounts stay null, with their source text and warnings intact.
function librarySaveGaps(draft: RecipeDraft): string[] {
  const gaps: string[] = [];
  if (!draft.name.trim() || draft.name === "Untitled recipe")
    gaps.push("Add a recipe name.");
  if (!draft.servings) gaps.push("Choose a base serving yield.");
  if (!draft.ingredients.length) gaps.push("Add at least one ingredient.");
  if (!draft.instructions.some((step) => step.trim()))
    gaps.push("Add the cooking instructions.");
  return gaps;
}
/** Aside accessibility snapshots contain role wrappers, not literal recipe prose.
 * Normalize only the documented text/heading/list-item nodes; preserve the source in evidence.
 */
export function normalizeRecipeEvidence(text: string): string[] {
  const raw = text.split(/\n+/);
  if (
    !raw.some((line) => /^\s*-\s*(?:heading\s+"|text:\s*|listitem:)/.test(line))
  )
    return raw;
  const output: string[] = [];
  let pending: { indent: number; parts: string[]; label: boolean } | undefined;
  const flush = () => {
    if (pending?.parts.length) output.push(pending.parts.join(" "));
    pending = undefined;
  };
  const label = (value: string): string => {
    const quoted = value.match(/^("(?:\\.|[^"\\])*")/);
    if (quoted) {
      try {
        return JSON.parse(quoted[1]) as string;
      } catch {
        return quoted[1].slice(1, -1);
      }
    }
    return value.trim();
  };
  for (const line of raw) {
    const node = line.match(
      /^(\s*)-\s*(heading|text|listitem|link|button|list|generic)(?::\s*|\s+|$)(.*)$/,
    );
    if (!node) {
      flush();
      if (line.trim() && !/^\s*-\s/.test(line)) output.push(line.trim());
      continue;
    }
    const [, space, role, value] = node;
    const indent = space.length;
    if (role === "listitem") {
      flush();
      const content = label(value);
      pending = {
        indent,
        parts: content ? [content] : [],
        label: Boolean(content),
      };
      continue;
    }
    if (pending && indent > pending.indent) {
      if (!pending.label && (role === "text" || role === "link")) {
        const content = label(value);
        if (content) pending.parts.push(content);
      }
      continue;
    }
    flush();
    if (role === "heading" || role === "text") {
      const content = label(value);
      if (content) output.push(content);
    }
  }
  flush();
  return output;
}
function parseEvidenceIngredient(text: string) {
  // Only the primary amount is uncertain: alternate weights and cutting dimensions are notes.
  const primary = text.replace(/\([^)]*\)/g, "").split(/[,;]/)[0];
  const uncertainPrimary =
    /^(?:about|approximately|roughly)\b|^[\d¼½¾⅓⅔⅛⅜⅝⅞][\d\s¼½¾⅓⅔⅛⅜⅝⅞./]*\s*(?:[-–—]|to)\s*[\d¼½¾⅓⅔⅛⅜⅝⅞]|^[\d¼½¾⅓⅔⅛⅜⅝⅞][\d\s¼½¾⅓⅔⅛⅜⅝⅞./]*\s*(?:about|approximately|roughly)\b/i.test(primary.trim());
  const packaged = text.match(
    /^(\d+(?:\.\d+)?)\s*\((\d+(?:\.\d+)?)[-\s]*(ounces?|oz|pounds?|lbs?|grams?|g|kilograms?|kg)\)\s*(?:packages?|packs?|cans?|tins?|bags?)\s+(.*)$/i,
  );
  if (packaged) {
    const parsed = parseIngredientString(`${packaged[2]} ${packaged[3]} ${packaged[4]}`);
    return {
      ...parsed,
      quantity: parsed.quantity === null ? null : Number(packaged[1]) * parsed.quantity,
      uncertain: uncertainPrimary,
    };
  }
  // A quantified base ingredient can also invite an unquantified garnish; do not erase its base amount.
  let base = text.replace(/,\s*plus more\b.*$/i, "");
  // Adjectives can be comma-separated before the food name. Only preparation clauses end the name.
  base = base.replace(
    /,(?!\s*(?:florets|stems|cut|chopped|finely|thinly|diced|cored|seeded|trimmed|rinsed|drained|undrained|divided|plus|for|to|patted|halved|coarsely|grated|sliced|minced|crushed|peeled|optional)\b)\s*/gi,
    " ",
  );
  const combined = base.split(/\s+plus\s+(?=[\d¼½¾⅓⅔⅛⅜⅝⅞])/i);
  if (combined.length === 2) {
    const first = parseIngredientString(combined[0]);
    const second = parseIngredientString(combined[1]);
    const extra =
      first.unit && second.unit && second.quantity !== null
        ? convertQuantity(second.quantity, second.unit, first.unit)
        : null;
    return {
      ...second,
      quantity:
        first.quantity !== null && extra !== null
          ? first.quantity + extra
          : null,
      unit: first.unit ?? second.unit,
      uncertain: uncertainPrimary || extra === null,
    };
  }
  return { ...parseIngredientString(base), uncertain: uncertainPrimary || combined.length > 2 };
}
export function extractDraft(
  id: string,
  source: string,
  evidence: EvidenceLine[],
  initialGaps: string[] = [],
): RecipeDraft {
  const lines = evidence
    .flatMap((line, group) =>
      normalizeRecipeEvidence(line.text).map((text) => ({
        ...line,
        group,
        text: text.trim().replace(/^[-•]\s*/, ""),
      })),
    )
    .filter((line) => line.text);
  let name = "Untitled recipe";
  const yields = new Set<number>();
  let section = "";
  const ingredients: RecipeIngredientInput[] = [];
  const instructions: string[] = [];
  const gaps = [...initialGaps];
  let evidenceSource = "";
  for (const line of lines) {
    if (line.source !== evidenceSource) {
      evidenceSource = line.source;
      section = "";
    }
    const text = line.text;
    if (/^(ingredients?|what you(?:’|')?ll need)\s*:?$/i.test(text)) {
      section = "ingredients";
      continue;
    }
    if (/^(method|instructions?|directions?|preparation)\s*:?$/i.test(text)) {
      section = "method";
      continue;
    }
    const servings = text.match(
      /^(?:serves?|servings?|yield|makes)\s*:?\s*(\d+)\s*(?:servings?|people|portions?)?\s*$/i,
    );
    if (servings) {
      yields.add(Number(servings[1]));
      continue;
    }
    if (/^(?:serves?|servings?|yield|makes)\b/i.test(text)) {
      gaps.push(`Uncertain yield: ${text}`);
      continue;
    }
    if (
      /^(?:\d+(?:\.\d+)?\s*(?:mins?|minutes?|hours?)|(?:prep|cook|total)\s*time\b)/i.test(
        text,
      )
    )
      continue;
    const amount = /^[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(text);
    if (
      section === "method" ||
      /^(?:step\s*\d+|(?:\d+[.)]\s*)?(?:mix|add|heat|cook|bake|simmer|stir|chop|slice|combine|whisk|serve|bring|pour|roast|fry|boil|drain|season|blend|preheat)\b)/i.test(
        text,
      )
    ) {
      if (!instructions.includes(text))
        instructions.push(text.replace(/^(?:step\s*\d+\s*|\d+[.)]\s*)/i, ""));
      continue;
    }
    // Amount lines outside an explicit method section are useful across caption/OCR/speech.
    if (section === "ingredients" || (amount && section !== "method")) {
      const parsed = parseEvidenceIngredient(text);
      const uncertain = parsed.uncertain;
      const quantity = uncertain ? null : parsed.quantity;
      const unit = parsed.unit ?? "";
      const existing = ingredients.find((i) => i.name === parsed.name);
      if (existing) {
        if (existing.quantity !== quantity || existing.unit !== unit) {
          existing.quantity = null;
          gaps.push(
            `Conflicting amounts for ${parsed.name}: ${existing.raw}; ${text}`,
          );
        }
        continue;
      }
      if (parsed.name)
        ingredients.push({ name: parsed.name, quantity, unit, raw: text });
      if (uncertain) gaps.push(`Uncertain quantity: ${text}`);
      continue;
    }
    if (
      name === "Untitled recipe" &&
      text.length <= 120 &&
      !/^https?:|^#/.test(text)
    )
      name = text.replace(/^#+\s*/, "");
  }
  const servings = yields.size === 1 ? [...yields][0] : null;
  if (yields.size > 1)
    gaps.push("Conflicting serving yields. Enter the correct yield.");
  const draft: RecipeDraft = {
    id,
    revision: 0,
    name,
    source,
    servings,
    ingredients,
    instructions,
    evidence,
    gaps: [],
    status: "draft",
  };
  draft.gaps = [...new Set([...gaps, ...recipeGaps(draft)])];
  draft.status = recipeGaps(draft).length ? "draft" : "ready";
  return draft;
}
export function updateDraft(
  current: RecipeDraft,
  patch: z.infer<typeof patchSchema>["draft"],
): RecipeDraft {
  if (current.status === "saved")
    throw new MealConflict(
      "This draft is already saved. Edit the saved recipe instead.",
    );
  const checked = patchSchema.shape.draft.parse(patch);
  const draft = { ...current, ...checked, revision: current.revision + 1 };
  const changedFields = Object.keys(checked).filter(
    (field) =>
      canonical(current[field as keyof RecipeDraft]) !==
      canonical(checked[field as keyof typeof checked]),
  );
  if (current.evidenceReferences) {
    draft.evidenceReferences = current.evidenceReferences.filter(
      (reference) =>
        !changedFields.some(
          (field) =>
            reference.field === field ||
            reference.field.startsWith(`${field}.`),
        ),
    );
  }
  // Editing recipe fields does not confirm the source transcript or other evidence warnings.
  const previousMissing = new Set(recipeGaps(current));
  const sourceWarnings = current.gaps.filter(
    (gap) => !previousMissing.has(gap),
  );
  const missing = recipeGaps(draft);
  draft.gaps = [...new Set([...sourceWarnings, ...missing])];
  draft.status = missing.length ? "draft" : "ready";
  return draft;
}

function recipeEvidenceFromHtml(html: string): EvidenceLine[] {
  const $ = cheerio.load(html);
  let recipe: Record<string, unknown> | undefined;
  function find(value: unknown): void {
    if (recipe) return;
    if (Array.isArray(value)) {
      value.forEach(find);
      return;
    }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      const type = row["@type"];
      if (
        type === "Recipe" ||
        (Array.isArray(type) && type.includes("Recipe"))
      ) {
        recipe = row;
        return;
      }
      if (row["@graph"]) find(row["@graph"]);
    }
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      find(JSON.parse($(el).text()));
    } catch {
      /* another script may contain the recipe */
    }
  });
  if (recipe) {
    const row = recipe as Record<string, unknown>;
    const yields = Array.isArray(row.recipeYield)
      ? row.recipeYield.join(" ")
      : String(row.recipeYield ?? "");
    const yieldText = /^\d+$/.test(yields)
      ? `Serves ${yields}`
      : `Yield: ${yields}`;
    const steps = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap(steps)
        : typeof value === "string"
          ? [value]
          : value && typeof value === "object"
            ? steps(
                (value as Record<string, unknown>).itemListElement ??
                  (value as Record<string, unknown>).text,
              )
            : [];
    return [
      {
        source: "page",
        text: [
          String(row.name ?? "Untitled recipe"),
          ...(yields ? [yieldText] : []),
          "Ingredients",
          ...(Array.isArray(row.recipeIngredient)
            ? row.recipeIngredient.map(String)
            : []),
          "Method",
          ...steps(row.recipeInstructions),
        ].join("\n"),
      },
    ];
  }
  const title = $("h1").first().text().trim();
  const ingredients = $(
    '[itemprop="recipeIngredient"], .ingredients li, .recipe-ingredients li',
  )
    .map((_, el) => $(el).text().trim())
    .get();
  const methods = $(
    '[itemprop="recipeInstructions"], .instructions li, .directions li',
  )
    .map((_, el) => $(el).text().trim())
    .get();
  const yieldText = $('[itemprop="recipeYield"]').first().text().trim();
  return [
    {
      source: "page",
      text: [
        title,
        ...(yieldText ? [`Yield: ${yieldText}`] : []),
        "Ingredients",
        ...ingredients,
        "Method",
        ...methods,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}
function publicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    isIP(address) === 6 &&
    /^[23]/.test(address) &&
    !address.toLowerCase().startsWith("2001:db8:")
  );
}
/** Pin the checked DNS address; redirects are independently checked and cookies are never read. */
export async function fetchRecipePage(
  source: string,
  redirects = 0,
): Promise<string> {
  const url = new URL(canonicalSource(source));
  if (url.hostname === "nytimes.com" || url.hostname.endsWith(".nytimes.com"))
    throw new IntakeError(
      "Open this recipe in your authorised Aside session, then send its page text or evidence.",
    );
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
    throw new IntakeError(
      "Recipe URL resolves to a private or unsupported network address.",
    );
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "PiMeals/1.0",
        },
        lookup: ((
          _host: unknown,
          options: { all?: boolean },
          callback: (...args: unknown[]) => void,
        ) =>
          options.all
            ? callback(null, [pinned])
            : callback(null, pinned.address, pinned.family)) as never,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400
        ) {
          clearTimeout(deadline);
          response.resume();
          if (!response.headers.location || redirects >= 3) {
            reject(
              new IntakeError(
                "Recipe redirect limit reached. Paste the page text.",
              ),
            );
            return;
          }
          fetchRecipePage(
            new URL(response.headers.location, url).toString(),
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          clearTimeout(deadline);
          response.resume();
          reject(
            new IntakeError(
              `Recipe access failed (${response.statusCode}). Open it in Aside and paste authorised page text.`,
            ),
          );
          return;
        }
        let bytes = 0;
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => {
          bytes += part.length;
          if (bytes > 1_048_576) {
            clearTimeout(deadline);
            response.destroy();
            reject(
              new IntakeError("Recipe page too large. Paste its recipe text."),
            );
          } else parts.push(part);
        });
        response.on("end", () => {
          clearTimeout(deadline);
          resolve(Buffer.concat(parts).toString("utf8"));
        });
        response.on("error", (error) => {
          clearTimeout(deadline);
          reject(error);
        });
      },
    );
    const deadline = setTimeout(
      () =>
        request.destroy(
          new IntakeError(
            "Recipe access timed out. Paste authorised page text.",
          ),
        ),
      15_000,
    );
    request.setTimeout(15_000, () =>
      request.destroy(
        new IntakeError("Recipe access timed out. Paste authorised page text."),
      ),
    );
    request.on("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end();
  });
}
export async function createDraft(
  prisma: PrismaClient,
  actorId: string,
  input: z.infer<typeof intakeSchema>,
): Promise<RecipeDraft> {
  const source = input.url ? canonicalSource(input.url) : "";
  const supplied = [
    ...(input.text ? [{ source: "user" as const, text: input.text }] : []),
    ...(input.evidence ?? []),
  ];
  if (supplied.reduce((size, line) => size + line.text.length, 0) > 128_000)
    throw new IntakeError("Recipe evidence exceeds 128 KB.");
  const identity =
    (source && new URL(source).hostname === "cooking.nytimes.com"
      ? `nyt-recipe:${nytRecipeIdentity(source)}`
      : source) ||
    supplied
      .flatMap((line) => line.text.split(/\n+/))
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .join("\n");
  let id = `recipe-draft-${hash(identity)}`;
  const nytIdentity =
    source && new URL(source).hostname === "cooking.nytimes.com"
      ? nytRecipeIdentity(source)
      : undefined;
  const matchesNyt = (draft: RecipeDraft): boolean => {
    try {
      return (
        nytIdentity !== undefined &&
        nytRecipeIdentity(draft.source) === nytIdentity
      );
    } catch {
      return false;
    }
  };
  // Receipts retain the document ID under which the original operation was recorded.
  const payloadHashFor = (documentId: string, expectedRevision = 0) =>
    hash(
      canonical({
        id: documentId,
        kind: "recipe-draft",
        actorId,
        expectedRevision,
        payload: input,
      }),
    );
  let payloadHash = payloadHashFor(id);
  const replay = (prior: {
    payloadHash: string;
    result: unknown;
  }): RecipeDraft => {
    const result = prior.result as {
      id: string;
      kind: string;
      data: RecipeDraft;
      revision: number;
    };
    // Older URL-based and evidence-fill receipts remain valid after identity migration.
    const validIdentity =
      result.id === id ||
      (nytIdentity !== undefined && matchesNyt(result.data));
    if (
      !validIdentity ||
      result.kind !== "recipe-draft" ||
      (prior.payloadHash !== payloadHashFor(result.id) &&
        prior.payloadHash !== payloadHashFor(result.id, 1))
    )
      throw new MealConflict(
        "This command ID was already used for a different change.",
      );
    return { ...result.data, revision: result.revision };
  };
  const receipt = async () => {
    const prior = await prisma.piMealOperation.findUnique({
      where: { id: input.operationId },
    });
    return prior ? replay(prior) : null;
  };
  const previous = await receipt();
  if (previous) return previous;
  if (nytIdentity !== undefined) {
    // Pre-ID imports were keyed by their complete URL, including its historical slug.
    // Prefer those documents so existing corrections and saves keep their identity.
    const candidates = await prisma.piMealDocument.findMany({
      where: { kind: "recipe-draft" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, data: true },
    });
    const matching = candidates.filter((row) =>
      matchesNyt(row.data as unknown as RecipeDraft),
    );
    const prior = matching.find((row) => row.id !== id) ?? matching[0];
    if (prior) {
      id = prior.id;
      payloadHash = payloadHashFor(id);
    }
  }
  const existing = await readDocument<RecipeDraft>(prisma, id, "recipe-draft");
  const untouchedPartial = (draft: RecipeDraft) => {
    if (draft.status !== "draft" || draft.ingredients.length) return false;
    const original = extractDraft(id, source, draft.evidence);
    return (
      draft.name === original.name &&
      draft.servings === original.servings &&
      canonical(draft.instructions) === canonical(original.instructions)
    );
  };
  const refresh = !existing || untouchedPartial(existing.data);
  let extracted: RecipeDraft | undefined;
  if (refresh) {
    let evidence = supplied;
    let photoUrl: string | undefined;
    const gaps: string[] = [];
    if (!evidence.length && source) {
      if (
        ["instagram.com", "www.instagram.com"].includes(
          new URL(source).hostname,
        )
      ) {
        const result = await inspectInstagram(source);
        evidence = result.evidence;
        gaps.push(...result.gaps);
      } else {
        try {
          if (new URL(source).hostname === "cooking.nytimes.com") {
            const captured = await captureAsideRecipe(source);
            evidence = captured.evidence;
            photoUrl = captured.photoUrl;
          } else {
            evidence = recipeEvidenceFromHtml(await fetchRecipePage(source));
          }
        } catch (error) {
          gaps.push(
            error instanceof Error
              ? error.message
              : "Recipe access failed. Paste authorised page text.",
          );
        }
      }
    }
    extracted = extractDraft(id, source, evidence, gaps);
    if (photoUrl || existing?.data.photoUrl)
      extracted.photoUrl = photoUrl ?? existing?.data.photoUrl;
    if (
      !extracted.ingredients.length &&
      evidence.some((line) =>
        ["caption", "speech", "ocr"].includes(line.source),
      )
    ) {
      const interpreted = await extractEvidenceRecipe(evidence);
      if (interpreted.ingredients.length) {
        extracted = {
          ...extracted,
          name: interpreted.name ?? extracted.name,
          servings: interpreted.servings ?? extracted.servings,
          ingredients: interpreted.ingredients,
          instructions: interpreted.instructions.length
            ? interpreted.instructions
            : extracted.instructions,
          evidenceReferences: interpreted.evidenceReferences.map(
            (reference) => ({
              ...reference,
              evidenceIndexes: reference.evidenceIndexes.map(
                (index) => index + (existing?.data.evidence.length ?? 0),
              ),
            }),
          ),
        };
        const missing = recipeGaps(extracted);
        extracted.gaps = [
          ...new Set([...gaps, ...interpreted.gaps, ...missing]),
        ];
        extracted.status = missing.length ? "draft" : "ready";
      } else
        extracted.gaps = [...new Set([...extracted.gaps, ...interpreted.gaps])];
    }
    if (existing) extracted.evidence = [...existing.data.evidence, ...evidence];
  }
  const commit = async (candidate: RecipeDraft | undefined) =>
    prisma.$transaction(async (tx) => {
      const prior = await tx.piMealOperation.findUnique({
        where: { id: input.operationId },
      });
      if (prior) return replay(prior);
      const row = await tx.piMealDocument.findUnique({ where: { id } });
      if (row && row.kind !== "recipe-draft") throw new MealConflict();
      let revision = row?.revision ?? 0;
      let data = row?.data as unknown as RecipeDraft | undefined;
      const updatedAt = new Date();
      if (candidate) {
        if (revision !== (existing?.revision ?? 0)) throw new MealConflict();
        revision += 1;
        data = { ...candidate, revision };
        if (row) {
          const changed = await tx.piMealDocument.updateMany({
            where: { id, revision: row.revision },
            data: {
              revision,
              data: data as unknown as Prisma.InputJsonValue,
              updatedAt,
            },
          });
          if (changed.count !== 1) throw new MealConflict();
        } else
          await tx.piMealDocument.create({
            data: {
              id,
              kind: "recipe-draft",
              revision,
              data: data as unknown as Prisma.InputJsonValue,
              updatedAt,
            },
          });
      }
      if (!data) throw new MealConflict();
      const result = {
        id,
        kind: "recipe-draft",
        revision,
        data,
        updatedAt: (row && !candidate
          ? row.updatedAt
          : updatedAt
        ).toISOString(),
      };
      await tx.piMealOperation.create({
        data: {
          id: input.operationId,
          documentId: id,
          actorId,
          payloadHash,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return { ...data, revision };
    });
  try {
    return await commit(extracted);
  } catch (error) {
    // A command collision takes precedence over a concurrent canonical-document winner.
    const committed = await receipt();
    if (committed) return committed;
    const concurrency =
      error instanceof MealConflict ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code));
    if (!concurrency) throw error;
    const winner = await readDocument<RecipeDraft>(prisma, id, "recipe-draft");
    if (!winner) throw error;
    return commit(undefined);
  }
}
export async function patchDraft(
  prisma: PrismaClient,
  actorId: string,
  id: string,
  input: z.infer<typeof patchSchema>,
): Promise<RecipeDraft> {
  const row = await mutateDocument<RecipeDraft>(prisma, {
    id,
    kind: "recipe-draft",
    operationId: input.operationId,
    actorId,
    expectedRevision: input.expectedRevision,
    payload: input,
    reduce: (current) => {
      if (!current) throw new IntakeError("Recipe draft not found.");
      return updateDraft(current, input.draft);
    },
  });
  return { ...row.data, revision: row.revision };
}
export async function saveDraft(
  prisma: PrismaClient,
  actorId: string,
  id: string,
  input: z.infer<typeof saveSchema>,
): Promise<RecipeDraft> {
  const payloadHash = hash(
    canonical({
      id,
      kind: "recipe-draft",
      actorId,
      expectedRevision: input.expectedRevision,
      payload: input,
    }),
  );
  const receipt = async () => {
    const prior = await prisma.piMealOperation.findUnique({
      where: { id: input.operationId },
    });
    if (!prior) return null;
    if (prior.payloadHash !== payloadHash)
      throw new MealConflict(
        "This command ID was already used for a different change.",
      );
    const result = prior.result as unknown as {
      data: RecipeDraft;
      revision: number;
    };
    return { ...result.data, revision: result.revision };
  };
  const prior = await receipt();
  if (prior) return prior;
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.piMealDocument.findUnique({ where: { id } });
      if (!row || row.kind !== "recipe-draft")
        throw new IntakeError("Recipe draft not found.");
      const draft = row.data as unknown as RecipeDraft;
      if (draft.status === "saved") {
        const saved = { ...draft, revision: row.revision };
        const result = {
          id,
          kind: "recipe-draft",
          revision: row.revision,
          data: saved,
          updatedAt: row.updatedAt.toISOString(),
        };
        await tx.piMealOperation.create({
          data: {
            id: input.operationId,
            documentId: id,
            actorId,
            payloadHash,
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
        return saved;
      }
      if (row.revision !== input.expectedRevision) throw new MealConflict();
      const gaps = librarySaveGaps(draft);
      if (gaps.length)
        throw new IntakeError(
          `Complete this recipe before saving: ${gaps.join(" ")}`,
        );
      const recipeId = `pi-meals-${hash(id)}`;
      const ingredients = [];
      for (const line of draft.ingredients) {
        const ingredient = await tx.ingredient.upsert({
          where: { name: line.name.toLowerCase().trim() },
          create: {
            name: line.name.toLowerCase().trim(),
            category: "pantry",
            typicalUnit: line.unit,
          },
          update: {},
        });
        ingredients.push({
          ingredientId: ingredient.id,
          quantity: line.quantity,
          unit: line.unit,
          notes: line.raw,
        });
      }
      await tx.recipe.create({
        data: {
          id: recipeId,
          name: draft.name,
          source: draft.source || null,
          photoUrl: draft.photoUrl || null,
          servings: draft.servings!,
          cookTimeMinutes: 0,
          mealType: "lunch",
          cookingStyle: "quick_weeknight",
          approvalStatus: "approved",
          recipeIngredients: { create: ingredients },
          recipeInstructions: {
            create: draft.instructions.map((instructionText, index) => ({
              stepNumber: index + 1,
              instructionText,
            })),
          },
        },
      });
      const revision = row.revision + 1;
      const updatedAt = new Date();
      const saved: RecipeDraft = {
        ...draft,
        revision,
        status: "saved",
        recipeId,
        gaps: [
          ...draft.gaps,
          "Cooking time not supplied. Lunch and quick weeknight are default categories.",
        ],
      };
      const changed = await tx.piMealDocument.updateMany({
        where: { id, revision: row.revision },
        data: {
          revision,
          data: saved as unknown as Prisma.InputJsonValue,
          updatedAt,
        },
      });
      if (changed.count !== 1) throw new MealConflict();
      const result = {
        id,
        kind: "recipe-draft",
        revision,
        data: saved,
        updatedAt: updatedAt.toISOString(),
      };
      await tx.piMealOperation.create({
        data: {
          id: input.operationId,
          documentId: id,
          actorId,
          payloadHash,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return saved;
    });
  } catch (error) {
    const committed = await receipt();
    if (committed) return committed;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    )
      throw new MealConflict();
    throw error;
  }
}
