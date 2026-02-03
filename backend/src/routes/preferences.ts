import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { DayOfWeek } from '@prisma/client'

interface UpdatePreferencesBody {
  budgetTargetWeekly?: number
  calorieTargetDaily?: number
  preferredCuisines?: string[]
  dietaryRestrictions?: string[]
  dislikedIngredients?: string[]
  likedIngredients?: string[]
  priorityWeights?: {
    variety?: number
    expiration?: number
    pantry?: number
    budget?: number
    calorie?: number
    time?: number
    rating?: number
  }
  defaultShoppingDay?: DayOfWeek
  measurementSystem?: 'us' | 'metric'
}

export default async function preferencesRoutes(fastify: FastifyInstance) {
  // Get user preferences
  fastify.get('/', async () => {
    let preferences = await fastify.prisma.userPreferences.findFirst()

    // Create default preferences if none exist
    if (!preferences) {
      preferences = await fastify.prisma.userPreferences.create({
        data: {
          dislikedIngredients: [],
          likedIngredients: [],
          priorityWeights: {
            variety: 0.2,
            expiration: 0.25,
            pantry: 0.15,
            budget: 0.1,
            calorie: 0.1,
            time: 0.1,
            rating: 0.1,
          },
        },
      })
    }

    return preferences
  })

  // Update user preferences
  fastify.put('/', async (request: FastifyRequest<{ Body: UpdatePreferencesBody }>) => {
    const body = request.body

    // Get existing or create new
    let existing = await fastify.prisma.userPreferences.findFirst()

    if (existing) {
      // Merge priority weights if provided
      let priorityWeights = existing.priorityWeights as Record<string, number> | null
      if (body.priorityWeights) {
        priorityWeights = {
          ...(priorityWeights || {}),
          ...body.priorityWeights,
        }
      }

      return fastify.prisma.userPreferences.update({
        where: { id: existing.id },
        data: {
          ...(body.budgetTargetWeekly !== undefined && { budgetTargetWeekly: body.budgetTargetWeekly }),
          ...(body.calorieTargetDaily !== undefined && { calorieTargetDaily: body.calorieTargetDaily }),
          ...(body.preferredCuisines && { preferredCuisines: body.preferredCuisines }),
          ...(body.dietaryRestrictions && { dietaryRestrictions: body.dietaryRestrictions }),
          ...(body.dislikedIngredients && { dislikedIngredients: body.dislikedIngredients }),
          ...(body.likedIngredients && { likedIngredients: body.likedIngredients }),
          ...(priorityWeights && { priorityWeights }),
          ...(body.defaultShoppingDay && { defaultShoppingDay: body.defaultShoppingDay }),
          ...(body.measurementSystem && { measurementSystem: body.measurementSystem }),
        },
      })
    } else {
      return fastify.prisma.userPreferences.create({
        data: {
          budgetTargetWeekly: body.budgetTargetWeekly,
          calorieTargetDaily: body.calorieTargetDaily,
          preferredCuisines: body.preferredCuisines || [],
          dietaryRestrictions: body.dietaryRestrictions || [],
          dislikedIngredients: body.dislikedIngredients || [],
          likedIngredients: body.likedIngredients || [],
          priorityWeights: body.priorityWeights || {
            variety: 0.2,
            expiration: 0.25,
            pantry: 0.15,
            budget: 0.1,
            calorie: 0.1,
            time: 0.1,
            rating: 0.1,
          },
          defaultShoppingDay: body.defaultShoppingDay,
          measurementSystem: body.measurementSystem || 'us',
        },
      })
    }
  })

  // Add disliked ingredient
  fastify.post('/dislike/:ingredientId', async (request: FastifyRequest<{ Params: { ingredientId: string } }>, reply) => {
    const { ingredientId } = request.params

    // Verify ingredient exists
    const ingredient = await fastify.prisma.ingredient.findUnique({
      where: { id: ingredientId },
    })

    if (!ingredient) {
      return reply.notFound('Ingredient not found')
    }

    let preferences = await fastify.prisma.userPreferences.findFirst()

    if (!preferences) {
      preferences = await fastify.prisma.userPreferences.create({
        data: {
          dislikedIngredients: [ingredientId],
          likedIngredients: [],
        },
      })
    } else {
      const disliked = new Set(preferences.dislikedIngredients)
      disliked.add(ingredientId)

      preferences = await fastify.prisma.userPreferences.update({
        where: { id: preferences.id },
        data: {
          dislikedIngredients: Array.from(disliked),
        },
      })
    }

    return preferences
  })

  // Remove disliked ingredient
  fastify.delete('/dislike/:ingredientId', async (request: FastifyRequest<{ Params: { ingredientId: string } }>) => {
    const { ingredientId } = request.params

    const preferences = await fastify.prisma.userPreferences.findFirst()

    if (!preferences) {
      return { success: true }
    }

    const disliked = (preferences.dislikedIngredients || []).filter(id => id !== ingredientId)

    return fastify.prisma.userPreferences.update({
      where: { id: preferences.id },
      data: {
        dislikedIngredients: disliked,
      },
    })
  })

  // Get disliked ingredients with details
  fastify.get('/disliked-ingredients', async () => {
    const preferences = await fastify.prisma.userPreferences.findFirst()
    const dislikedIds = preferences?.dislikedIngredients || []

    if (!preferences || dislikedIds.length === 0) {
      return []
    }

    const ingredients = await fastify.prisma.ingredient.findMany({
      where: {
        id: { in: dislikedIds },
      },
    })

    return ingredients
  })

  // Add liked ingredient
  fastify.post('/like/:ingredientId', async (request: FastifyRequest<{ Params: { ingredientId: string } }>, reply) => {
    const { ingredientId } = request.params

    const ingredient = await fastify.prisma.ingredient.findUnique({
      where: { id: ingredientId },
    })

    if (!ingredient) {
      return reply.notFound('Ingredient not found')
    }

    let preferences = await fastify.prisma.userPreferences.findFirst()

    if (!preferences) {
      preferences = await fastify.prisma.userPreferences.create({
        data: {
          likedIngredients: [ingredientId],
          dislikedIngredients: [],
        },
      })
    } else {
      const liked = new Set(preferences.likedIngredients)
      liked.add(ingredientId)

      preferences = await fastify.prisma.userPreferences.update({
        where: { id: preferences.id },
        data: {
          likedIngredients: Array.from(liked),
        },
      })
    }

    return preferences
  })

  // Remove liked ingredient
  fastify.delete('/like/:ingredientId', async (request: FastifyRequest<{ Params: { ingredientId: string } }>) => {
    const { ingredientId } = request.params

    const preferences = await fastify.prisma.userPreferences.findFirst()

    if (!preferences) {
      return { success: true }
    }

    const liked = (preferences.likedIngredients || []).filter(id => id !== ingredientId)

    return fastify.prisma.userPreferences.update({
      where: { id: preferences.id },
      data: {
        likedIngredients: liked,
      },
    })
  })

  // Get liked ingredients with details
  fastify.get('/liked-ingredients', async () => {
    const preferences = await fastify.prisma.userPreferences.findFirst()
    const likedIds = preferences?.likedIngredients || []

    if (!preferences || likedIds.length === 0) {
      return []
    }

    const ingredients = await fastify.prisma.ingredient.findMany({
      where: {
        id: { in: likedIds },
      },
    })

    return ingredients
  })
}
