import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { DayOfWeek } from '@prisma/client'

interface UpdatePreferencesBody {
  budgetTargetWeekly?: number
  calorieTargetDaily?: number
  preferredCuisines?: string[]
  dietaryRestrictions?: string[]
  dislikedIngredients?: string[]
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
}

export default async function preferencesRoutes(fastify: FastifyInstance) {
  // Get user preferences
  fastify.get('/', async () => {
    let preferences = await fastify.prisma.userPreferences.findFirst()

    // Create default preferences if none exist
    if (!preferences) {
      preferences = await fastify.prisma.userPreferences.create({
        data: {
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
          ...(priorityWeights && { priorityWeights }),
          ...(body.defaultShoppingDay && { defaultShoppingDay: body.defaultShoppingDay }),
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

    const disliked = preferences.dislikedIngredients.filter(id => id !== ingredientId)

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

    if (!preferences || preferences.dislikedIngredients.length === 0) {
      return []
    }

    const ingredients = await fastify.prisma.ingredient.findMany({
      where: {
        id: { in: preferences.dislikedIngredients },
      },
    })

    return ingredients
  })
}
