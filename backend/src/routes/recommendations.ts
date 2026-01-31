import type { FastifyInstance, FastifyRequest } from 'fastify'
import { RecommendationEngine } from '../services/recommendation-engine.js'

interface RecommendationQuery {
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  limit?: number
  excludeIds?: string
}

export default async function recommendationRoutes(fastify: FastifyInstance) {
  const engine = new RecommendationEngine(fastify.prisma)

  // Get recipe recommendations
  fastify.get('/', async (request: FastifyRequest<{ Querystring: RecommendationQuery }>) => {
    const { mealType, limit = 10, excludeIds } = request.query
    const dayOfWeek = new Date().getDay()

    const excludeRecipeIds = excludeIds ? excludeIds.split(',') : []

    const recommendations = await engine.getRecommendations({
      mealType,
      dayOfWeek,
      limit,
      excludeRecipeIds,
    })

    return recommendations.map(r => ({
      recipe: r.recipe,
      score: Math.round(r.totalScore * 100) / 100,
      breakdown: {
        variety: Math.round(r.scores.variety),
        expiration: Math.round(r.scores.expiration),
        pantry: Math.round(r.scores.pantry),
        budget: Math.round(r.scores.budget),
        calorie: Math.round(r.scores.calorie),
        time: Math.round(r.scores.time),
        rating: Math.round(r.scores.rating),
      },
    }))
  })

  // Get single suggestion ("What should I cook tonight?")
  fastify.get('/suggest', async (request: FastifyRequest<{ Querystring: { mealType?: string } }>) => {
    const mealType = (request.query.mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack') || 'dinner'
    const dayOfWeek = new Date().getDay()

    const suggestion = await engine.suggestRecipe({
      mealType,
      dayOfWeek,
    })

    if (!suggestion) {
      return { recipe: null, message: 'No approved recipes found' }
    }

    return {
      recipe: suggestion.recipe,
      score: Math.round(suggestion.totalScore * 100) / 100,
      reason: getRecommendationReason(suggestion.scores),
    }
  })

  // Get recipes prioritized by expiring ingredients
  fastify.get('/use-soon', async (request: FastifyRequest<{ Querystring: { limit?: number } }>) => {
    const limit = request.query.limit || 5

    // Get expiring ingredients first
    const expirationThreshold = new Date()
    expirationThreshold.setDate(expirationThreshold.getDate() + 5)

    const expiringItems = await fastify.prisma.pantryInventory.findMany({
      where: {
        expirationDate: {
          lte: expirationThreshold,
          gte: new Date(),
        },
        status: { not: 'depleted' },
      },
      include: { ingredient: true },
      orderBy: { expirationDate: 'asc' },
    })

    if (expiringItems.length === 0) {
      return {
        expiringItems: [],
        recommendations: [],
        message: 'No items expiring soon',
      }
    }

    const recommendations = await engine.getExpirationPrioritizedRecipes(limit)

    return {
      expiringItems: expiringItems.map(item => ({
        ingredient: item.ingredient.name,
        expirationDate: item.expirationDate,
        daysLeft: item.expirationDate
          ? Math.ceil((new Date(item.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null,
      })),
      recommendations: recommendations.map(r => ({
        recipe: r.recipe,
        expirationScore: Math.round(r.scores.expiration),
      })),
    }
  })

  // Get recommendations for auto-filling meal plan
  fastify.get('/meal-plan-suggestions', async (request: FastifyRequest<{
    Querystring: {
      date: string
      mealTypes?: string
    }
  }>) => {
    const { date, mealTypes } = request.query
    const dayOfWeek = new Date(date).getDay()

    const types = mealTypes?.split(',') as ('breakfast' | 'lunch' | 'dinner' | 'snack')[] ||
      ['breakfast', 'lunch', 'dinner']

    const suggestions: Record<string, any> = {}

    for (const mealType of types) {
      const recs = await engine.getRecommendations({
        mealType,
        dayOfWeek,
        limit: 3,
      })

      suggestions[mealType] = recs.map(r => ({
        recipe: {
          id: r.recipe.id,
          name: r.recipe.name,
          cookTimeMinutes: r.recipe.cookTimeMinutes,
          servings: r.recipe.servings,
        },
        score: Math.round(r.totalScore * 100) / 100,
      }))
    }

    return suggestions
  })
}

function getRecommendationReason(scores: Record<string, number>): string {
  const reasons: string[] = []

  if (scores.expiration >= 70) {
    reasons.push('Uses ingredients expiring soon')
  }
  if (scores.pantry >= 70) {
    reasons.push('Uses many pantry items')
  }
  if (scores.variety >= 80) {
    reasons.push("Haven't made this in a while")
  }
  if (scores.rating >= 70) {
    reasons.push('Previously rated highly')
  }
  if (scores.time >= 80) {
    reasons.push('Good cooking time for today')
  }

  if (reasons.length === 0) {
    return 'Good match for your preferences'
  }

  return reasons.join('. ')
}
