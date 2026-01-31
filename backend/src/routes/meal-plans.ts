import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { MealType, MealPlanStatus, CookingRating } from '@prisma/client'

interface MealPlanParams {
  id: string
}

interface MealPlanQuery {
  fromDate?: string
  toDate?: string
  mealType?: MealType
  status?: MealPlanStatus
}

interface CreateMealPlanBody {
  recipeId: string
  plannedDate: string
  mealType: MealType
  servingsPlanned: number
  isLeftover?: boolean
  parentCookingEventId?: string
}

interface MarkCookedBody {
  servingsMade?: number
  isBatchCook?: boolean
  intendedMealCount?: number
  rating?: CookingRating
  wouldMakeAgain?: boolean
  notes?: string
}

export default async function mealPlanRoutes(fastify: FastifyInstance) {
  // List meal plans with date range
  fastify.get('/', async (request: FastifyRequest<{ Querystring: MealPlanQuery }>) => {
    const { fromDate, toDate, mealType, status } = request.query

    // Default to current week if no dates provided
    const startDate = fromDate ? new Date(fromDate) : new Date()
    const endDate = toDate ? new Date(toDate) : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000)

    const mealPlans = await fastify.prisma.mealPlan.findMany({
      where: {
        plannedDate: {
          gte: startDate,
          lte: endDate,
        },
        ...(mealType && { mealType }),
        ...(status && { status }),
      },
      include: {
        recipe: {
          include: {
            recipeIngredients: {
              include: { ingredient: true },
            },
          },
        },
        parentCookingEvent: true,
      },
      orderBy: [{ plannedDate: 'asc' }, { mealType: 'asc' }],
    })

    return mealPlans
  })

  // Get single meal plan
  fastify.get('/:id', async (request: FastifyRequest<{ Params: MealPlanParams }>, reply) => {
    const mealPlan = await fastify.prisma.mealPlan.findUnique({
      where: { id: request.params.id },
      include: {
        recipe: {
          include: {
            recipeIngredients: { include: { ingredient: true } },
            recipeInstructions: { orderBy: { stepNumber: 'asc' } },
          },
        },
        parentCookingEvent: true,
      },
    })

    if (!mealPlan) {
      return reply.notFound('Meal plan not found')
    }

    return mealPlan
  })

  // Create meal plan
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateMealPlanBody }>) => {
    const mealPlan = await fastify.prisma.mealPlan.create({
      data: {
        recipeId: request.body.recipeId,
        plannedDate: new Date(request.body.plannedDate),
        mealType: request.body.mealType,
        servingsPlanned: request.body.servingsPlanned,
        isLeftover: request.body.isLeftover || false,
        parentCookingEventId: request.body.parentCookingEventId,
      },
      include: {
        recipe: true,
      },
    })

    return mealPlan
  })

  // Create batch meal plan (one cooking event, multiple meals)
  fastify.post('/batch', async (request: FastifyRequest<{
    Body: {
      recipeId: string
      cookDate: string
      mealType: MealType
      servingsPlanned: number
      leftoverDates: string[]
    }
  }>) => {
    const { recipeId, cookDate, mealType, servingsPlanned, leftoverDates } = request.body

    const result = await fastify.prisma.$transaction(async (tx) => {
      // Create main meal plan
      const mainMealPlan = await tx.mealPlan.create({
        data: {
          recipeId,
          plannedDate: new Date(cookDate),
          mealType,
          servingsPlanned,
          isLeftover: false,
        },
      })

      // Create leftover meal plans
      const leftoverMealPlans = await Promise.all(
        leftoverDates.map(date =>
          tx.mealPlan.create({
            data: {
              recipeId,
              plannedDate: new Date(date),
              mealType,
              servingsPlanned,
              isLeftover: true,
            },
          })
        )
      )

      return { main: mainMealPlan, leftovers: leftoverMealPlans }
    })

    return result
  })

  // Update meal plan
  fastify.put('/:id', async (
    request: FastifyRequest<{ Params: MealPlanParams; Body: Partial<CreateMealPlanBody> & { status?: MealPlanStatus } }>,
    reply
  ) => {
    const { id } = request.params
    const { plannedDate, ...rest } = request.body

    try {
      const mealPlan = await fastify.prisma.mealPlan.update({
        where: { id },
        data: {
          ...rest,
          ...(plannedDate && { plannedDate: new Date(plannedDate) }),
        },
        include: { recipe: true },
      })
      return mealPlan
    } catch {
      return reply.notFound('Meal plan not found')
    }
  })

  // Mark as cooked (creates cooking history)
  fastify.post('/:id/cooked', async (
    request: FastifyRequest<{ Params: MealPlanParams; Body: MarkCookedBody }>,
    reply
  ) => {
    const { id } = request.params
    const body = request.body

    const mealPlan = await fastify.prisma.mealPlan.findUnique({
      where: { id },
      include: { recipe: true },
    })

    if (!mealPlan) {
      return reply.notFound('Meal plan not found')
    }

    const result = await fastify.prisma.$transaction(async (tx) => {
      // Create cooking history
      const cookingHistory = await tx.cookingHistory.create({
        data: {
          recipeId: mealPlan.recipeId,
          cookedDate: mealPlan.plannedDate,
          servingsMade: body.servingsMade || mealPlan.servingsPlanned,
          isBatchCook: body.isBatchCook || false,
          intendedMealCount: body.intendedMealCount || 1,
          rating: body.rating,
          wouldMakeAgain: body.wouldMakeAgain,
          notes: body.notes,
        },
      })

      // Update meal plan status
      const updatedMealPlan = await tx.mealPlan.update({
        where: { id },
        data: {
          status: 'cooked',
          parentCookingEventId: cookingHistory.id,
        },
      })

      // Update recipe stats
      await tx.recipe.update({
        where: { id: mealPlan.recipeId },
        data: {
          timesCooked: { increment: 1 },
          lastCookedDate: mealPlan.plannedDate,
        },
      })

      return { mealPlan: updatedMealPlan, cookingHistory }
    })

    return result
  })

  // Delete meal plan
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: MealPlanParams }>, reply) => {
    try {
      await fastify.prisma.mealPlan.delete({ where: { id: request.params.id } })
      return { success: true }
    } catch {
      return reply.notFound('Meal plan not found')
    }
  })
}
