// Shared wire contract for the Pi Meals build. Changes are coordinated by the lead.
export interface RecipeIngredientInput {
  id?: string;
  name: string;
  quantity: number | null;
  unit: string;
  raw?: string;
}
export interface SelectionItem {
  id: string;
  recipeId?: string;
  draftId?: string;
  name: string;
  source?: string;
  photoUrl?: string;
  baseServings: number;
  servings: number;
  ingredients: RecipeIngredientInput[];
}
export interface StockDecision {
  lineId: string;
  quantity: number;
  unit: string;
  coverageFingerprint?: string;
}
export interface ShoppingLine {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  haveQuantity: number;
  buyQuantity: number | null;
  sources: Array<{ itemId: string; name: string; quantity: number | null }>;
  warnings: string[];
}
export interface RecipeSelection {
  id: string;
  title: string;
  revision: number;
  items: SelectionItem[];
  stock: StockDecision[];
  lines: ShoppingLine[];
  updatedAt: string;
}
export type SelectionChange =
  | { type: "replace_items"; items: SelectionItem[] }
  | { type: "set_stock"; lineId: string; quantity: number; unit: string }
  | { type: "have_all"; lineId: string }
  | { type: "rename"; title: string };
export interface CommandEnvelope<T> {
  operationId: string;
  expectedRevision: number;
  command: T;
}
export interface EvidenceLine {
  source: "caption" | "speech" | "ocr" | "page" | "user";
  text: string;
}
export interface RecipeDraft {
  id: string;
  revision: number;
  name: string;
  source: string;
  servings: number | null;
  ingredients: RecipeIngredientInput[];
  instructions: string[];
  evidence: EvidenceLine[];
  gaps: string[];
  status: "draft" | "ready" | "saved";
  recipeId?: string;
  evidenceReferences?: Array<{
    field: string;
    evidenceIndexes: number[];
    quote: string;
  }>;
}
export interface BasketManifestLine {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  productId?: string;
  productName?: string;
  packQuantity?: number;
  packUnit?: string;
  packs?: number;
  price?: number;
  baselineQuantity?: number;
}
export interface BasketProposal {
  id: string;
  revision: number;
  selectionId: string;
  selectionRevision: number;
  status: "draft" | "ready" | "running" | "needs_review" | "complete";
  executor: "aside" | "ocado";
  lines: BasketManifestLine[];
  unresolved: string[];
  taskId?: string;
  receipt?: unknown;
}

import type { Recipe } from "./api";
const base =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3001/api"
    : "/api");
export class MealsApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function mealsRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new MealsApiError(
      error.message || error.error || `Request failed (${response.status})`,
      response.status,
    );
  }
  return response.json();
}
export const operationId = () => crypto.randomUUID();
export const mealsApi = {
  drafts: () => mealsRequest<RecipeDraft[]>("/pi-meals/intake"),
  logout: () => mealsRequest("/pi-meals/auth/logout", "POST"),
  session: () =>
    mealsRequest<{ actorId: string; name: string }>("/pi-meals/auth/session"),
  login: (member: string, pin: string) =>
    mealsRequest("/pi-meals/auth/login", "POST", { member, pin }),
  library: async () => {
    const recipes: Recipe[] = [];
    for (let offset = 0; ; offset += 250) {
      const page = await mealsRequest<Recipe[]>(
        `/recipes?limit=250&offset=${offset}`,
      );
      recipes.push(...page);
      if (page.length < 250) return recipes;
    }
  },
  recipe: (id: string) =>
    mealsRequest<Recipe>(`/recipes/${encodeURIComponent(id)}`),
  selections: () => mealsRequest<RecipeSelection[]>("/pi-meals/selections"),
  selection: (id: string) =>
    mealsRequest<RecipeSelection>(
      `/pi-meals/selections/${encodeURIComponent(id)}`,
    ),
  create: (title = "Next shop") =>
    mealsRequest<RecipeSelection>("/pi-meals/selections", "POST", {
      operationId: operationId(),
      title,
      items: [],
    }),
  command: (selection: RecipeSelection, command: SelectionChange) =>
    mealsRequest<RecipeSelection>(
      `/pi-meals/selections/${selection.id}/commands`,
      "POST",
      {
        operationId: operationId(),
        expectedRevision: selection.revision,
        command,
      },
    ),
  intake: (url?: string, text?: string) =>
    mealsRequest<RecipeDraft>("/pi-meals/intake", "POST", {
      operationId: operationId(),
      url,
      text,
    }),
  editDraft: (draft: RecipeDraft) =>
    mealsRequest<RecipeDraft>(`/pi-meals/intake/${draft.id}`, "PATCH", {
      operationId: operationId(),
      expectedRevision: draft.revision,
      draft: {
        name: draft.name,
        servings: draft.servings,
        ingredients: draft.ingredients,
        instructions: draft.instructions,
      },
    }),
  saveDraft: (draft: RecipeDraft) =>
    mealsRequest<RecipeDraft>(`/pi-meals/intake/${draft.id}/save`, "POST", {
      operationId: operationId(),
      expectedRevision: draft.revision,
    }),
  assistantStatus: () =>
    mealsRequest<{ available: boolean; status: string; reason?: string }>(
      "/pi-meals/assistant/status",
    ),
  assistantMessage: (selectionId: string, message: string) =>
    mealsRequest<AssistantResult>("/pi-meals/assistant/messages", "POST", {
      operationId: operationId(),
      selectionId,
      message,
    }),
  assistantResult: (requestId: string) =>
    mealsRequest<AssistantResult>(
      `/pi-meals/assistant/messages/${encodeURIComponent(requestId)}`,
    ),
  handoff: (basketId: string) =>
    mealsRequest<{
      basketId: string;
      revision: number;
      executor: string;
      taskId?: string;
      text: string;
    }>(`/pi-meals/baskets/${encodeURIComponent(basketId)}/handoff`),
  basket: (selectionId: string, executor: "aside" | "ocado") =>
    mealsRequest<BasketProposal>("/pi-meals/baskets", "POST", {
      operationId: operationId(),
      selectionId,
      executor,
    }),
  prepare: (basket: BasketProposal, lines: BasketManifestLine[]) =>
    mealsRequest<BasketProposal>(
      `/pi-meals/baskets/${basket.id}/prepare`,
      "POST",
      { operationId: operationId(), expectedRevision: basket.revision, lines },
    ),
  fill: (basket: BasketProposal, selectionRevision: number) =>
    mealsRequest<BasketProposal>(
      `/pi-meals/baskets/${basket.id}/fill`,
      "POST",
      {
        operationId: operationId(),
        expectedRevision: basket.revision,
        selectionRevision,
      },
    ),
  reconcile: (basket: BasketProposal) =>
    mealsRequest<BasketProposal>(
      `/pi-meals/baskets/${basket.id}/reconcile`,
      "POST",
      { operationId: operationId(), expectedRevision: basket.revision },
    ),
};
export function recipeSnapshot(recipe: Recipe): SelectionItem {
  return {
    id: operationId(),
    recipeId: recipe.id,
    name: recipe.name,
    source: recipe.source || undefined,
    photoUrl: recipe.photoUrl || undefined,
    baseServings: recipe.servings,
    servings: recipe.servings,
    ingredients: (recipe.recipeIngredients || []).map((row) => ({
      id: row.ingredient.id,
      name: row.ingredient.name,
      quantity: row.quantity == null ? null : Number(row.quantity),
      unit: row.unit,
      raw: row.notes || undefined,
    })),
  };
}

export interface AssistantResult {
  requestId: string;
  status: "queued" | "running" | "complete" | "unavailable" | "failed";
  message?: string;
}

export function draftSnapshot(draft: RecipeDraft): SelectionItem {
  if (
    draft.servings === null ||
    !Number.isFinite(draft.servings) ||
    draft.servings <= 0
  )
    throw new Error(
      "Choose a specific base yield before adding this draft to the shop.",
    );
  return {
    id: operationId(),
    draftId: draft.id,
    recipeId: draft.recipeId,
    name: draft.name,
    source: draft.source,
    baseServings: draft.servings,
    servings: draft.servings,
    ingredients: structuredClone(draft.ingredients),
  };
}
