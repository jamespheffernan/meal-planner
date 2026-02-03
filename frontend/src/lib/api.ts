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

export interface PantryItem {
  id: string
  ingredientId: string
  quantity: number
  unit: string
  acquiredDate: string
  expirationDate?: string
  status: 'stocked' | 'running_low' | 'depleted'
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
  fromUrl: (url: string, autoApprove = false) => fetchApi<{ success: boolean; recipe: Recipe; scraped: any }>('/import/url', {
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
  useSoon: (limit = 5) => fetchApi<{ expiringItems: any[]; recommendations: any[] }>(`/recommendations/use-soon?limit=${limit}`),
  mealPlanSuggestions: (date: string) => fetchApi<Record<string, any[]>>(`/recommendations/meal-plan-suggestions?date=${date}`),
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
