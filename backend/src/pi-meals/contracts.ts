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
  photoUrl?: string;
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
