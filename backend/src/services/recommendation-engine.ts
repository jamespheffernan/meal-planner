import { PrismaClient } from '@prisma/client'
import type { Recipe, CookingHistory, PantryInventory, UserPreferences } from '@prisma/client'

interface RecipeWithRelations extends Recipe {
  recipeIngredients: { ingredientId: string }[]
  cookingHistory: CookingHistory[]
}

interface ScoredRecipe {
  recipe: Recipe
  totalScore: number
  scores: {
    variety: number
    expiration: number
    pantry: number
    budget: number
    calorie: number
    time: number
    rating: number
  }
}

interface RecommendationOptions {
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  dayOfWeek?: number // 0 = Sunday, 1 = Monday, etc.
  limit?: number
  excludeRecipeIds?: string[]
}

const DEFAULT_WEIGHTS = {
  variety: 0.2,
  expiration: 0.25,
  pantry: 0.15,
  budget: 0.1,
  calorie: 0.1,
  time: 0.1,
  rating: 0.1,
}

/**
 * Recommendation engine that scores recipes based on multiple factors
 * Implements the algorithm from the spec
 */
export class RecommendationEngine {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get recommended recipes for the user
   */
  async getRecommendations(options: RecommendationOptions = {}): Promise<ScoredRecipe[]> {
    const { mealType, dayOfWeek, limit = 10, excludeRecipeIds = [] } = options

    // Fetch user preferences
    const preferences = await this.prisma.userPreferences.findFirst()
    const weights = (preferences?.priorityWeights as Record<string, number>) || DEFAULT_WEIGHTS

    // Fetch approved recipes with cooking history
    const recipes = await this.prisma.recipe.findMany({
      where: {
        approvalStatus: 'approved',
        ...(mealType && { mealType }),
        ...(excludeRecipeIds.length > 0 && {
          id: { notIn: excludeRecipeIds },
        }),
      },
      include: {
        recipeIngredients: {
          select: { ingredientId: true },
        },
        cookingHistory: {
          orderBy: { cookedDate: 'desc' },
          take: 10,
        },
      },
    })

    if (recipes.length === 0) {
      return []
    }

    // Fetch pantry data for ingredient matching
    const pantryItems = await this.prisma.pantryInventory.findMany({
      where: { status: { not: 'depleted' } },
    })
    const pantryIngredientIds = new Set(pantryItems.map(p => p.ingredientId))

    // Fetch expiring items (within 5 days)
    const expirationThreshold = new Date()
    expirationThreshold.setDate(expirationThreshold.getDate() + 5)
    const expiringItems = pantryItems.filter(
      p => p.expirationDate && new Date(p.expirationDate) <= expirationThreshold
    )
    const expiringIngredientIds = new Set(expiringItems.map(p => p.ingredientId))

    // Score each recipe
    const scoredRecipes = recipes.map(recipe => {
      const scores = {
        variety: this.calculateVarietyScore(recipe),
        expiration: this.calculateExpirationScore(recipe, expiringIngredientIds),
        pantry: this.calculatePantryScore(recipe, pantryIngredientIds),
        budget: this.calculateBudgetScore(recipe, preferences),
        calorie: this.calculateCalorieScore(recipe, preferences),
        time: this.calculateTimeScore(recipe, dayOfWeek),
        rating: this.calculateRatingScore(recipe),
      }

      const totalScore =
        (weights.variety || DEFAULT_WEIGHTS.variety) * scores.variety +
        (weights.expiration || DEFAULT_WEIGHTS.expiration) * scores.expiration +
        (weights.pantry || DEFAULT_WEIGHTS.pantry) * scores.pantry +
        (weights.budget || DEFAULT_WEIGHTS.budget) * scores.budget +
        (weights.calorie || DEFAULT_WEIGHTS.calorie) * scores.calorie +
        (weights.time || DEFAULT_WEIGHTS.time) * scores.time +
        (weights.rating || DEFAULT_WEIGHTS.rating) * scores.rating

      return {
        recipe,
        totalScore,
        scores,
      }
    })

    // Sort by total score descending
    scoredRecipes.sort((a, b) => b.totalScore - a.totalScore)

    return scoredRecipes.slice(0, limit)
  }

  /**
   * Get a single recipe suggestion for "What should I cook tonight?"
   */
  async suggestRecipe(options: RecommendationOptions = {}): Promise<ScoredRecipe | null> {
    const recommendations = await this.getRecommendations({ ...options, limit: 1 })
    return recommendations[0] || null
  }

  /**
   * Get recipes that use expiring ingredients
   */
  async getExpirationPrioritizedRecipes(limit = 10): Promise<ScoredRecipe[]> {
    return this.getRecommendations({
      limit,
      // This will naturally prioritize expiring items due to the expiration score
    })
  }

  /**
   * Variety score: penalize recently cooked recipes
   * Higher score = more variety (hasn't been cooked recently)
   */
  private calculateVarietyScore(recipe: RecipeWithRelations): number {
    if (!recipe.lastCookedDate) {
      return 100 // Never cooked, maximum variety
    }

    const daysSinceCooked = Math.floor(
      (Date.now() - new Date(recipe.lastCookedDate).getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysSinceCooked >= 30) return 100
    if (daysSinceCooked >= 14) return 80
    if (daysSinceCooked >= 7) return 50
    if (daysSinceCooked >= 3) return 20
    return 0 // Cooked in last 3 days
  }

  /**
   * Expiration score: prioritize recipes using soon-to-expire ingredients
   */
  private calculateExpirationScore(
    recipe: RecipeWithRelations,
    expiringIngredientIds: Set<string>
  ): number {
    if (expiringIngredientIds.size === 0) return 50 // Neutral if nothing expiring

    const recipeIngredientIds = recipe.recipeIngredients.map(ri => ri.ingredientId)
    const matchingExpiring = recipeIngredientIds.filter(id => expiringIngredientIds.has(id))

    if (matchingExpiring.length === 0) return 30 // Doesn't use expiring items
    if (matchingExpiring.length === 1) return 70
    if (matchingExpiring.length === 2) return 85
    return 100 // Uses 3+ expiring ingredients
  }

  /**
   * Pantry score: prefer recipes that use ingredients we already have
   */
  private calculatePantryScore(
    recipe: RecipeWithRelations,
    pantryIngredientIds: Set<string>
  ): number {
    const recipeIngredientIds = recipe.recipeIngredients.map(ri => ri.ingredientId)
    if (recipeIngredientIds.length === 0) return 50

    const matchingCount = recipeIngredientIds.filter(id => pantryIngredientIds.has(id)).length
    const matchRatio = matchingCount / recipeIngredientIds.length

    return Math.round(matchRatio * 100)
  }

  /**
   * Budget score: prefer recipes within budget
   */
  private calculateBudgetScore(
    recipe: Recipe,
    preferences: UserPreferences | null
  ): number {
    if (!preferences?.budgetTargetWeekly || !recipe.estimatedCostPerServing) {
      return 50 // Neutral if no budget set or no cost estimate
    }

    // Assume 21 meals per week (3 per day)
    const targetPerMeal = Number(preferences.budgetTargetWeekly) / 21
    const cost = Number(recipe.estimatedCostPerServing)

    if (cost <= targetPerMeal * 0.5) return 100 // Very cheap
    if (cost <= targetPerMeal) return 80 // Within budget
    if (cost <= targetPerMeal * 1.5) return 50 // Slightly over
    if (cost <= targetPerMeal * 2) return 25 // Over budget
    return 0 // Way over budget
  }

  /**
   * Calorie score: prefer recipes that fit daily calorie target
   */
  private calculateCalorieScore(
    recipe: Recipe,
    preferences: UserPreferences | null
  ): number {
    if (!preferences?.calorieTargetDaily || !recipe.estimatedCaloriesPerServing) {
      return 50 // Neutral if no target or no estimate
    }

    // Assume 3 meals per day, distribute calories roughly evenly
    const targetPerMeal = preferences.calorieTargetDaily / 3
    const calories = recipe.estimatedCaloriesPerServing

    const ratio = calories / targetPerMeal
    if (ratio >= 0.8 && ratio <= 1.2) return 100 // Perfect fit
    if (ratio >= 0.6 && ratio <= 1.4) return 75 // Good fit
    if (ratio >= 0.4 && ratio <= 1.6) return 50 // Acceptable
    return 25 // Poor fit
  }

  /**
   * Time score: prefer quick recipes on weekdays, allow longer on weekends
   */
  private calculateTimeScore(recipe: Recipe, dayOfWeek?: number): number {
    const totalTime = recipe.totalTimeMinutes || recipe.cookTimeMinutes

    // Default to weekday behavior if day not specified
    const isWeekend = dayOfWeek !== undefined && (dayOfWeek === 0 || dayOfWeek === 6)

    if (isWeekend) {
      // On weekends, all cooking times are acceptable
      if (recipe.cookingStyle === 'batch_cook') return 100 // Prefer batch cooking on weekends
      if (totalTime && totalTime <= 60) return 80
      return 60
    } else {
      // On weekdays, prefer quick meals
      if (recipe.cookingStyle === 'quick_weeknight') return 100
      if (totalTime && totalTime <= 30) return 100
      if (totalTime && totalTime <= 45) return 75
      if (totalTime && totalTime <= 60) return 50
      return 25 // Long cooking time on weekday
    }
  }

  /**
   * Rating score: prefer recipes with positive feedback
   */
  private calculateRatingScore(recipe: RecipeWithRelations): number {
    const history = recipe.cookingHistory

    if (history.length === 0) return 50 // No history, neutral

    let score = 50

    // Count ratings
    const thumbsUp = history.filter(h => h.rating === 'thumbs_up').length
    const thumbsDown = history.filter(h => h.rating === 'thumbs_down').length
    const wouldMakeAgain = history.filter(h => h.wouldMakeAgain === true).length
    const wouldNotMakeAgain = history.filter(h => h.wouldMakeAgain === false).length

    // Adjust score based on ratings
    score += thumbsUp * 15
    score -= thumbsDown * 25
    score += wouldMakeAgain * 10
    score -= wouldNotMakeAgain * 20

    return Math.max(0, Math.min(100, score))
  }
}

/**
 * Get personalized recipe recommendations for the swipe feed
 * Orders by composite score for discovery
 */
export async function getSwipeFeedRecipes(
  prisma: PrismaClient,
  limit = 20
): Promise<Recipe[]> {
  const engine = new RecommendationEngine(prisma)

  // Get pending recipes first (haven't been reviewed yet)
  const pendingRecipes = await prisma.recipe.findMany({
    where: { approvalStatus: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  if (pendingRecipes.length >= limit) {
    return pendingRecipes
  }

  // If not enough pending, could add logic to re-surface rejected recipes
  // that might be worth reconsidering (not implemented for MVP)

  return pendingRecipes
}

export type { ScoredRecipe, RecommendationOptions }
