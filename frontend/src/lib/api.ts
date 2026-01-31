const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || 'Request failed')
  }

  return res.json()
}

// Recipes
export const recipes = {
  list: (params?: { approvalStatus?: string; mealType?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''
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
}

// Ingredients
export const ingredients = {
  list: (params?: { search?: string; category?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''
    return fetchApi<Ingredient[]>(`/ingredients${query}`)
  },
  get: (id: string) => fetchApi<Ingredient>(`/ingredients/${id}`),
  create: (data: CreateIngredientInput) => fetchApi<Ingredient>('/ingredients', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
}

// Meal Plans
export const mealPlans = {
  list: (params?: { fromDate?: string; toDate?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''
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
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''
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
