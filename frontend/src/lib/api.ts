const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> }

  // Only set Content-Type for requests with a body
  if (options?.body) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || 'Request failed')
  }

  return res.json()
}

// Helper to build query string, filtering out undefined values
function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  ) as Record<string, string>
  return Object.keys(filtered).length > 0 ? `?${new URLSearchParams(filtered)}` : ''
}

// Recipes
export const recipes = {
  list: (params?: { approvalStatus?: string; mealType?: string }) => {
    const query = buildQuery(params)
    return fetchApi<Recipe[]>(`/recipes${query}`)
  },
  discover: (limit = 10) => fetchApi<Recipe[]>(`/recipes/discover?limit=${limit}`),
  get: (id: string) => fetchApi<Recipe>(`/recipes/${id}`),
  create: (data: CreateRecipeInput) => fetchApi<Recipe>('/recipes', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateApproval: (id: string, status: string) => fetchApi<Recipe>(`/recipes/${id}/approval`, {
    method: 'PATCH',
    body: JSON.stringify({ approvalStatus: status }),
  }),
  update: (id: string, data: Partial<CreateRecipeInput>) => fetchApi<Recipe>(`/recipes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/recipes/${id}`, { method: 'DELETE' }),
  // Photo management
  updatePhoto: (id: string, data: { photoUrl?: string; photoBase64?: string; mimeType?: string }) =>
    fetchApi<Recipe>(`/recipes/${id}/photo`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  findImage: (id: string) => fetchApi<{ photoUrl: string }>(`/recipes/${id}/find-image`, {
    method: 'POST',
  }),
  generateImage: (id: string) => fetchApi<{ photoUrl: string }>(`/recipes/${id}/generate-image`, {
    method: 'POST',
  }),
}

// Ingredients
export const ingredients = {
  list: (params?: { search?: string; category?: string }) => {
    const query = buildQuery(params)
    return fetchApi<Ingredient[]>(`/ingredients${query}`)
  },
  get: (id: string) => fetchApi<Ingredient>(`/ingredients/${id}`),
  create: (data: CreateIngredientInput) => fetchApi<Ingredient>('/ingredients', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<CreateIngredientInput>) => fetchApi<Ingredient>(`/ingredients/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/ingredients/${id}`, { method: 'DELETE' }),
  addBrand: (ingredientId: string, data: CreateBrandInput) => fetchApi<Brand>(`/ingredients/${ingredientId}/brands`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  deleteBrand: (ingredientId: string, brandId: string) =>
    fetchApi<{ success: boolean }>(`/ingredients/${ingredientId}/brands/${brandId}`, { method: 'DELETE' }),
  bulkCreate: (data: BulkCreateIngredientsInput) => fetchApi<{ success: boolean; created: number; errors?: { name: string; error: string }[] }>('/ingredients/bulk', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  refreshOff: (id: string) => fetchApi<{ ingredient: Ingredient; offData: OffLookupResult }>(`/ingredients/${id}/off-refresh`, {
    method: 'POST',
  }),
}

// Meal Plans
export const mealPlans = {
  list: (params?: { fromDate?: string; toDate?: string }) => {
    const query = buildQuery(params)
    return fetchApi<MealPlan[]>(`/meal-plans${query}`)
  },
  get: (id: string) => fetchApi<MealPlan>(`/meal-plans/${id}`),
  create: (data: CreateMealPlanInput) => fetchApi<MealPlan>('/meal-plans', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  createBatch: (data: CreateBatchMealPlanInput) => fetchApi<{ main: MealPlan; leftovers: MealPlan[] }>('/meal-plans/batch', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  bulkAssign: (data: BulkAssignMealPlanInput) => fetchApi<{ success: boolean; count: number; mealPlans: MealPlan[] }>('/meal-plans/bulk-assign', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<CreateMealPlanInput>) => fetchApi<MealPlan>(`/meal-plans/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  markCooked: (id: string, data: MarkCookedInput) => fetchApi<{ mealPlan: MealPlan }>(`/meal-plans/${id}/cooked`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/meal-plans/${id}`, { method: 'DELETE' }),
}

// Shopping Lists
export const shoppingLists = {
  list: (status?: string) => {
    const query = status ? `?status=${status}` : ''
    return fetchApi<ShoppingList[]>(`/shopping-lists${query}`)
  },
  get: (id: string) => fetchApi<ShoppingList>(`/shopping-lists/${id}`),
  generate: (mealPlanIds: string[], shoppingDate?: string) => fetchApi<ShoppingList>('/shopping-lists/generate', {
    method: 'POST',
    body: JSON.stringify({ mealPlanIds, shoppingDate }),
  }),
  updateItem: (listId: string, itemId: string, data: UpdateShoppingItemInput) => fetchApi<ShoppingListItem>(`/shopping-lists/${listId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  complete: (id: string) => fetchApi<ShoppingList>(`/shopping-lists/${id}/complete`, { method: 'POST' }),

  // Online ordering flow
  prepareOrder: (listId: string, provider: StoreProvider = 'ocado', maxResultsPerItem?: number) =>
    fetchApi<PreparedOrder>(`/shopping-lists/${listId}/order/prepare?provider=${provider}`, {
      method: 'POST',
      body: JSON.stringify({ maxResultsPerItem }),
    }),
  confirmMappings: (listId: string, mappings: Array<{ ingredientId: string; storeProductId: string; isDefault?: boolean }>) =>
    fetchApi<{ ok: boolean; mappings: unknown[] }>(`/shopping-lists/${listId}/order/confirm-mappings`, {
      method: 'POST',
      body: JSON.stringify({ mappings }),
    }),
  reviewOrder: (listId: string, provider: StoreProvider = 'ocado', quantityOverrides?: Record<string, number>) =>
    fetchApi<OrderReviewResult>(`/shopping-lists/${listId}/order/review`, {
      method: 'POST',
      body: JSON.stringify({ provider, quantityOverrides }),
    }),
  addToCart: (listId: string, provider: StoreProvider = 'ocado') =>
    fetchApi<AddToCartResult>(`/shopping-lists/${listId}/order/add-to-cart`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
  addToCartWithQuantities: (listId: string, provider: StoreProvider = 'ocado', quantityOverrides?: Record<string, number>) =>
    fetchApi<AddToCartResult>(`/shopping-lists/${listId}/order/add-to-cart`, {
      method: 'POST',
      body: JSON.stringify({ provider, quantityOverrides }),
    }),
  checkoutDryRun: (listId: string, provider: StoreProvider = 'ocado') =>
    fetchApi<{ ok: boolean; slots: Array<{ date: string; time: string; price: string; fullText: string }>; url?: string }>(`/shopping-lists/${listId}/order/checkout/dry-run`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
  placeOrderDryRun: (listId: string, provider: StoreProvider = 'ocado') =>
    fetchApi<{ ok: boolean; message: string; url: string }>(`/shopping-lists/${listId}/order/place-order`, {
      method: 'POST',
      body: JSON.stringify({ provider, dryRun: true }),
    }),
}

// Mappings (Ingredient <-> Store product)
export const mappings = {
  list: (params?: { q?: string; shoppingListId?: string; limit?: number; provider?: StoreProvider }) => {
    const query = buildQuery({
      provider: params?.provider,
      shoppingListId: params?.shoppingListId,
      q: params?.q,
      limit: params?.limit,
    })
    return fetchApi<{ ok: boolean; provider: StoreProvider; items: IngredientMappingRow[] }>(`/mappings${query}`)
  },
  setDefault: (ingredientId: string, storeProductId: string, provider: StoreProvider = 'ocado') =>
    fetchApi<{ ok: boolean }>(`/mappings/default?provider=${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ ingredientId, storeProductId }),
    }),
  clearDefault: (ingredientId: string, provider: StoreProvider = 'ocado') =>
    fetchApi<{ ok: boolean }>(`/mappings/default?provider=${provider}`, {
      method: 'DELETE',
      body: JSON.stringify({ ingredientId }),
    }),
  setOverride: (shoppingListId: string, ingredientId: string, storeProductId: string, provider: StoreProvider = 'ocado') =>
    fetchApi<{ ok: boolean }>(`/mappings/override?provider=${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ shoppingListId, ingredientId, storeProductId }),
    }),
  clearOverride: (shoppingListId: string, ingredientId: string, provider: StoreProvider = 'ocado') =>
    fetchApi<{ ok: boolean }>(`/mappings/override?provider=${provider}`, {
      method: 'DELETE',
      body: JSON.stringify({ shoppingListId, ingredientId }),
    }),
}

// Orders
export const orders = {
  list: (params?: { status?: string; provider?: StoreProvider; limit?: number }) => {
    const query = buildQuery({
      status: params?.status,
      provider: params?.provider,
      limit: params?.limit,
    })
    return fetchApi<{ orders: PurchaseOrder[] }>(`/orders${query}`)
  },
  get: (id: string) => fetchApi<{ order: PurchaseOrder }>(`/orders/${id}`),
  analysis: (id: string) => fetchApi<{ ok: boolean; budget: any; approvals: any }>(`/orders/${id}/analysis`),
  update: (id: string, data: { status?: PurchaseOrder['status']; notes?: string | null; deliverySlot?: string | null }) =>
    fetchApi<{ order: PurchaseOrder }>(`/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

// Pantry
export const pantry = {
  list: (params?: { status?: string; expiringWithinDays?: number }) => {
    const query = buildQuery(params)
    return fetchApi<PantryItem[]>(`/pantry${query}`)
  },
  expiring: (days = 5) => fetchApi<PantryItem[]>(`/pantry/expiring?days=${days}`),
  create: (data: CreatePantryItemInput) => fetchApi<PantryItem>('/pantry', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateStatus: (id: string, status: string) => fetchApi<PantryItem>(`/pantry/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }),
}

// Types
export interface Recipe {
  id: string
  name: string
  description?: string
  source?: string
  servings: number
  cookTimeMinutes: number
  prepTimeMinutes?: number
  totalTimeMinutes?: number
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  cookingStyle: 'quick_weeknight' | 'batch_cook' | 'special_occasion'
  photoUrl?: string
  estimatedCaloriesPerServing?: number
  estimatedCostPerServing?: number
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'archived'
  timesCooked: number
  lastCookedDate?: string
  recipeIngredients?: RecipeIngredient[]
  recipeInstructions?: RecipeInstruction[]
}

export interface RecipeIngredient {
  id: string
  quantity: number
  unit: string
  notes?: string
  optional: boolean
  ingredient: Ingredient
}

export interface RecipeInstruction {
  id: string
  stepNumber: number
  instructionText: string
}

export interface Ingredient {
  id: string
  name: string
  category: string
  typicalUnit: string
  estimatedCaloriesPerUnit?: number
  estimatedCostPerUnit?: number
  imageUrl?: string
  brands?: Brand[]
  recipeIngredients?: IngredientRecipeLink[]
}

export interface Brand {
  id: string
  brandName: string
  preferenceLevel: 'preferred' | 'acceptable' | 'avoid'
  notes?: string
}

export interface IngredientRecipeLink {
  id: string
  quantity: number
  unit: string
  recipe?: { id: string; name: string }
}

export interface MealPlan {
  id: string
  recipeId: string
  plannedDate: string
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  servingsPlanned: number
  isLeftover: boolean
  status: 'planned' | 'cooked' | 'skipped'
  recipe?: Recipe
}

export interface ShoppingList {
  id: string
  createdDate: string
  shoppingDate?: string
  status: 'draft' | 'ready' | 'shopping' | 'completed'
  totalEstimatedCost?: number
  items: ShoppingListItem[]
}

export interface ShoppingListItem {
  id: string
  ingredientId: string
  quantity: number
  unit: string
  assumedHave: boolean
  userOverride?: 'need' | 'have'
  estimatedCost?: number
  purchased: boolean
  ingredient: Ingredient
}

export type StoreProvider = 'ocado'

export interface StoreProductResult {
  provider: StoreProvider
  storeProductId: string
  providerProductId: string
  name: string
  price: number | null
  currency: string
  imageUrl: string | null
  productUrl: string | null
}

export interface PreparedOrderAutoMappedItem {
  itemId: string
  ingredientId: string
  ingredientName: string
  mappingSource?: 'this_list' | 'default'
  storeProduct: {
    id: string
    provider: StoreProvider
    providerProductId: string
    name: string
    imageUrl?: string | null
    productUrl?: string | null
    lastSeenPrice?: number | null
    currency?: string | null
  }
}

export interface PreparedOrderNeedsChoiceItem {
  itemId: string
  ingredientId: string
  ingredientName: string
  query: string
  candidates: Array<{
    storeProductId: string
    providerProductId: string
    name: string
    price: number | null
    currency: string
    imageUrl: string | null
    productUrl: string | null
  }>
}

export interface PreparedOrder {
  provider: StoreProvider
  shoppingListId: string
  autoMapped: PreparedOrderAutoMappedItem[]
  needsChoice: PreparedOrderNeedsChoiceItem[]
}

export interface MappingStoreProductSummary {
  storeProductId: string
  provider: StoreProvider
  providerProductId: string
  name: string
  imageUrl: string | null
  productUrl: string | null
  lastSeenPrice: number | null
  currency: string | null
}

export interface IngredientMappingRow {
  ingredientId: string
  ingredientName: string
  defaultMapping: MappingStoreProductSummary | null
  overrideMapping: MappingStoreProductSummary | null
  effectiveMapping: MappingStoreProductSummary | null
  effectiveSource: 'this_list' | 'default' | null
}

export interface StoreCartSummary {
  currency: string
  total: number | null
  items: Array<{
    name: string
    quantity: number
    price: number | null
    lineTotal: number | null
  }>
}

export interface AddToCartResult {
  ok: boolean
  provider: StoreProvider
  shoppingListId: string
  purchaseOrderId?: string | null
  added: Array<{ ingredientId: string; ingredientName: string; providerProductId: string; quantity?: number }>
  skippedAlreadyInCart?: Array<{ ingredientId: string; ingredientName: string; providerProductId: string; desiredQuantity: number; cartQuantity: number }>
  missingMappings: Array<{ itemId: string; ingredientId: string; ingredientName: string }>
  cart: StoreCartSummary
}

export interface OrderReviewResult {
  ok: boolean
  provider: StoreProvider
  shoppingListId: string
  intendedCount: number
  willAdd: Array<{
    ingredientId: string
    ingredientName: string
    providerProductId: string
    desiredQuantity: number
    cartQuantity: number
    delta: number
  }>
  alreadyInCart: Array<{
    ingredientId: string
    ingredientName: string
    providerProductId: string
    desiredQuantity: number
    cartQuantity: number
  }>
  missingMappings: Array<{ itemId: string; ingredientId: string; ingredientName: string }>
  cart: StoreCartSummary
  minimum: { threshold: number; cartTotal: number; below: boolean } | null
}

export interface PurchaseOrderItem {
  id: string
  ingredientId?: string | null
  storeProductId?: string | null
  rawName: string
  quantity: number
  unit?: string | null
  price: number | string
  lineTotal?: number | string | null
  ingredient?: Ingredient | null
  storeProduct?: {
    id: string
    provider: StoreProvider
    providerProductId: string
    name: string
    imageUrl?: string | null
    productUrl?: string | null
  } | null
}

export interface PurchaseOrder {
  id: string
  provider: StoreProvider
  approvedAt?: string | null
  placedAt?: string | null
  deliveredAt?: string | null
  cancelledAt?: string | null
  total: number | string
  currency: string
  status: 'pending' | 'approved' | 'placed' | 'delivered' | 'cancelled'
  source: string
  shoppingListId?: string | null
  deliverySlot?: string | null
  checkoutUrl?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  items: PurchaseOrderItem[]
  shoppingList?: ShoppingList | null
}

export interface BudgetSummary {
  typicalWeekly: number
  minWeekly: number
  maxWeekly: number
  sampleSize: number
  confidence: 'low' | 'medium' | 'high'
  weeks: Array<{ weekStart: string; total: number }>
}

export interface StapleSuggestion {
  normalizedName: string
  purchaseCount: number
  avgIntervalDays: number
  varianceRatio: number
  confidence: 'high' | 'medium' | 'low'
  reorderAfterDays: number
  lastPurchasedAt: string | null
}

export interface PantryItem {
  id: string
  ingredientId: string
  quantity: number
  unit: string
  acquiredDate: string
  expirationDate?: string
  status: 'stocked' | 'running_low' | 'depleted'
  source?: 'grocery_trip' | 'manual_entry' | 'recipe_deduction' | 'user_checkin'
  ingredient: Ingredient
}

export interface CreateRecipeInput {
  name: string
  description?: string
  source?: string
  servings: number
  cookTimeMinutes: number
  prepTimeMinutes?: number
  mealType: string
  cookingStyle: string
  ingredients?: {
    ingredientId: string
    quantity: number
    unit: string
    notes?: string
    optional?: boolean
  }[]
  instructions?: {
    stepNumber: number
    instructionText: string
  }[]
}

export interface CreateIngredientInput {
  name: string
  category: string
  typicalUnit: string
  estimatedCaloriesPerUnit?: number
  estimatedCostPerUnit?: number
}

export interface CreateBrandInput {
  brandName: string
  preferenceLevel: 'preferred' | 'acceptable' | 'avoid'
  notes?: string
}

export interface BulkCreateIngredientsInput {
  ingredients: CreateIngredientInput[]
}

export interface OffLookupResult {
  productName?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  imageUrl?: string
}

export interface CreateMealPlanInput {
  recipeId: string
  plannedDate: string
  mealType: string
  servingsPlanned: number
}

export interface CreateBatchMealPlanInput {
  recipeId: string
  cookDate: string
  mealType: string
  servingsPlanned: number
  leftoverDates: string[]
}

export interface BulkAssignMealPlanInput {
  assignments: Array<{
    recipeId: string
    mealType: string
    servings: number
    dates: string[]
  }>
}

export interface MarkCookedInput {
  servingsMade?: number
  isBatchCook?: boolean
  rating?: 'thumbs_up' | 'thumbs_down' | 'neutral'
  wouldMakeAgain?: boolean
  notes?: string
}

export interface UpdateShoppingItemInput {
  userOverride?: 'need' | 'have' | null
  quantity?: number
  purchased?: boolean
}

export interface CreatePantryItemInput {
  ingredientId: string
  quantity: number
  unit: string
  expirationDate?: string
}

// Parsed recipe from OCR (before saving)
export interface ParsedRecipe {
  name: string
  description?: string
  servings?: number
  cookTimeMinutes?: number
  prepTimeMinutes?: number
  ingredients: { name: string; quantity?: number; unit?: string; notes?: string }[]
  instructions: string[]
}

// Import API
export const recipeImport = {
  fromUrl: (url: string, autoApprove = false) => fetchApi<{ success: boolean; recipe: Recipe; scraped: unknown }>('/import/url', {
    method: 'POST',
    body: JSON.stringify({ url, autoApprove }),
  }),
  // Preview image OCR without saving
  previewImage: (imageBase64: string, mimeType: string) => fetchApi<{ success: boolean; preview: true; count: number; recipes: ParsedRecipe[] }>('/import/image', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType, previewOnly: true }),
  }),
  // Save corrected recipes from preview
  saveRecipes: (recipes: ParsedRecipe[], autoApprove = false) => fetchApi<{ success: boolean; count: number; recipes: Recipe[] }>('/import/image', {
    method: 'POST',
    body: JSON.stringify({ recipes, autoApprove }),
  }),
  // Direct import (skip preview)
  fromImage: (imageBase64: string, mimeType: string, autoApprove = false) => fetchApi<{ success: boolean; count: number; recipes: Recipe[] }>('/import/image', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType, autoApprove }),
  }),
  fromPaprika: (data: string, autoApprove = false) => fetchApi<{ success: boolean; imported: number; duplicatesSkipped: number }>('/import/paprika', {
    method: 'POST',
    body: JSON.stringify({ data, autoApprove }),
  }),
  parseReceipt: (imageBase64: string, mimeType: string, storeName?: string, applyMatches = true) =>
    fetchApi<ReceiptImportResult>('/import/receipt', {
    method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType, storeName, applyMatches }),
  }),
  applyReceiptMatches: (matches: Array<{ ingredientId: string; price?: number; quantity?: number }>) =>
    fetchApi<{ success: boolean; updated: number; updates: Array<{ ingredientId: string; updatedCostPerUnit: number }> }>('/import/receipt/apply', {
      method: 'POST',
      body: JSON.stringify({ matches }),
    }),
}

// Preferences API
export const preferences = {
  get: () => fetchApi<UserPreferences>('/preferences'),
  update: (data: Partial<UserPreferences>) => fetchApi<UserPreferences>('/preferences', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  addDislike: (ingredientId: string) => fetchApi<UserPreferences>(`/preferences/dislike/${ingredientId}`, {
    method: 'POST',
  }),
  removeDislike: (ingredientId: string) => fetchApi<UserPreferences>(`/preferences/dislike/${ingredientId}`, {
    method: 'DELETE',
  }),
  getDislikedIngredients: () => fetchApi<Ingredient[]>('/preferences/disliked-ingredients'),
  addLike: (ingredientId: string) => fetchApi<UserPreferences>(`/preferences/like/${ingredientId}`, {
    method: 'POST',
  }),
  removeLike: (ingredientId: string) => fetchApi<UserPreferences>(`/preferences/like/${ingredientId}`, {
    method: 'DELETE',
  }),
  getLikedIngredients: () => fetchApi<Ingredient[]>('/preferences/liked-ingredients'),
}

// Recommendations API
export const recommendations = {
  list: (params?: { mealType?: string; limit?: number }) => {
    const query = buildQuery(params)
    return fetchApi<ScoredRecipe[]>(`/recommendations${query}`)
  },
  suggest: (mealType = 'dinner') => fetchApi<{ recipe: Recipe | null; score?: number; reason?: string }>(`/recommendations/suggest?mealType=${mealType}`),
  useSoon: (limit = 5) => fetchApi<{ expiringItems: unknown[]; recommendations: unknown[] }>(`/recommendations/use-soon?limit=${limit}`),
  mealPlanSuggestions: (date: string) => fetchApi<Record<string, unknown[]>>(`/recommendations/meal-plan-suggestions?date=${date}`),
}

// Settings
export const settings = {
  getOpenAIKeyStatus: () => fetchApi<{ hasKey: boolean; source: 'env' | 'db' | 'none'; encryptionReady: boolean }>('/settings/openai-key'),
  setOpenAIKey: (apiKey: string) => fetchApi<{ hasKey: boolean }>('/settings/openai-key', {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  }),
  clearOpenAIKey: () => fetchApi<{ hasKey: boolean }>('/settings/openai-key', {
    method: 'DELETE',
  }),
  verifyOpenAIKey: (apiKey?: string) => fetchApi<{ ok: boolean; model: string | null }>('/settings/openai-key/verify', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  }),
  getRecipeAuthCookie: (hostname: string) => fetchApi<{ hasCookie: boolean; encryptionReady: boolean; hostname?: string }>(`/settings/recipe-auth-cookie?hostname=${encodeURIComponent(hostname)}`),
  setRecipeAuthCookie: (hostname: string, cookie: string) => fetchApi<{ hasCookie: boolean; hostname: string }>('/settings/recipe-auth-cookie', {
    method: 'PUT',
    body: JSON.stringify({ hostname, cookie }),
  }),
  clearRecipeAuthCookie: (hostname: string) => fetchApi<{ hasCookie: boolean; hostname: string }>('/settings/recipe-auth-cookie', {
    method: 'DELETE',
    body: JSON.stringify({ hostname }),
  }),

  // Store sessions (Playwright storageState) - stored encrypted in DB
  getStoreSessionStatus: (provider: StoreProvider = 'ocado') =>
    fetchApi<{ hasSession: boolean; provider: StoreProvider; encryptionReady: boolean }>(`/settings/store-session?provider=${provider}`),
  setStoreSession: (provider: StoreProvider, storageState: unknown) =>
    fetchApi<{ hasSession: boolean; provider: StoreProvider }>('/settings/store-session', {
      method: 'PUT',
      body: JSON.stringify({ provider, storageState }),
    }),
  clearStoreSession: (provider: StoreProvider) =>
    fetchApi<{ hasSession: boolean; provider: StoreProvider }>('/settings/store-session', {
      method: 'DELETE',
      body: JSON.stringify({ provider }),
    }),
}

// Stores API
export const stores = {
  providers: () => fetchApi<{ providers: Array<{ provider: StoreProvider; enabled: boolean; hasSession: boolean }> }>('/stores/providers'),
  ocadoSearch: (query: string, maxResults?: number) =>
    fetchApi<{ results: Array<StoreProductResult> }>('/stores/ocado/search', {
      method: 'POST',
      body: JSON.stringify({ query, maxResults }),
    }),
  ocadoAddToCart: (providerProductId: string, quantity?: number) =>
    fetchApi<{ ok: boolean }>('/stores/ocado/cart/add', {
      method: 'POST',
      body: JSON.stringify({ providerProductId, quantity }),
    }),
  ocadoViewCart: () => fetchApi<StoreCartSummary>('/stores/ocado/cart'),
}

// Budget API
export const budget = {
  summary: (weeks: number = 8) => fetchApi<BudgetSummary>(`/budget/summary?weeks=${weeks}`),
}

// Staples API
export const staples = {
  suggestions: (weeks: number = 12) => fetchApi<{ suggestions: StapleSuggestion[] }>(`/staples/suggestions?weeks=${weeks}`),
  due: (max: number = 50) => fetchApi<{ due: Array<{ id: string; normalizedName?: string | null; reorderAfterDays: number; lastPurchasedAt?: string | null; ingredientId?: string | null; ingredientName?: string | null }> }>(`/staples/due?max=${max}`),
  confirm: (normalizedNames: string[], reorderAfterDays?: number) => fetchApi<{ ok: boolean; rules: unknown[] }>('/staples/confirm', {
    method: 'POST',
    body: JSON.stringify({ normalizedNames, reorderAfterDays }),
  }),
}

// Discovery API
export interface RecipeCandidate {
  id: string
  batchId: string
  sourceUrl: string
  sourceName: string
  name: string
  description?: string
  imageUrl?: string
  servings?: number
  cookTimeMinutes?: number
  prepTimeMinutes?: number
  totalTimeMinutes?: number
  ingredients: string[]
  instructions: string[]
  status: 'pending' | 'approved' | 'rejected' | 'imported' | 'error'
  insights?: {
    ingredientCount: number
    pantryMatchCount: number
    pantryMatchNames: string[]
    unusualIngredients: string[]
    reasons: string[]
  }
}

export const discovery = {
  search: (data: { query: string; limit?: number; mealType?: string; maxTimeMinutes?: number; sources?: string[] }) =>
    fetchApi<{ batchId: string; createdCount: number; skippedDuplicates: number; errors?: Array<{ url: string; error: string }> }>('/discovery/search', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listCandidates: (batchId: string, status: string = 'pending') =>
    fetchApi<{ candidates: RecipeCandidate[] }>(`/discovery/batches/${batchId}/candidates?status=${encodeURIComponent(status)}`),
  updateCandidateStatus: (id: string, status: 'approved' | 'rejected') =>
    fetchApi<{ success: boolean; recipeId?: string }>(`/discovery/candidates/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  bulkUpdate: (ids: string[], status: 'approved' | 'rejected') =>
    fetchApi<{ success: boolean; updated: number; createdRecipes?: number }>('/discovery/candidates/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    }),
  listSources: () => fetchApi<{ sources: DiscoverySource[] }>('/discovery/sources'),
  saveSources: (sources: DiscoverySourceInput[]) => fetchApi<{ success: boolean }>('/discovery/sources', {
    method: 'PUT',
    body: JSON.stringify({ sources }),
  }),
}

export interface DiscoverySource {
  id: string
  host: string
  displayName?: string | null
  enabled: boolean
  sitemapUrls: string[]
  rssUrls: string[]
  weight?: number
  isDefault?: boolean
}

export interface DiscoverySourceInput {
  host: string
  displayName?: string | null
  enabled?: boolean
  sitemapUrls?: string[]
  rssUrls?: string[]
  weight?: number
}

// Additional types
export interface UserPreferences {
  id: string
  budgetTargetWeekly?: number
  calorieTargetDaily?: number
  preferredCuisines: string[]
  dietaryRestrictions: string[]
  dislikedIngredients: string[]
  likedIngredients: string[]
  priorityWeights?: {
    variety?: number
    expiration?: number
    pantry?: number
    budget?: number
    calorie?: number
    time?: number
    rating?: number
  }
  defaultShoppingDay?: string
  measurementSystem?: 'us' | 'metric'
}

export interface ScoredRecipe {
  recipe: Recipe
  score: number
  breakdown?: {
    variety: number
    expiration: number
    pantry: number
    budget: number
    calorie: number
    time: number
    rating: number
  }
}

export interface ReceiptImportResult {
  success: boolean
  receipt: {
    id: string
    storeName: string
    purchaseDate: string
    totalAmount: number
    processingStatus: string
  }
  parsed: {
    storeName?: string
    purchaseDate?: string
    items: Array<{
      name: string
      quantity?: number
      unit?: string
      price?: number
    }>
    total?: number
  }
  matchedItems: Array<{
    receiptItem: string
    matchedIngredient: string
    ingredientId: string
    matchScore?: number
    updatedCostPerUnit?: number | null
    suggestedCostPerUnit?: number | null
    receiptPrice?: number
    receiptQuantity?: number
    applied?: boolean
  }>
  unmatchedCount: number
  unmatchedItems: Array<{
    name: string
    quantity?: number
    unit?: string
    price?: number
  }>
}
