import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApprovalStatus, MealType, CookingStyle } from '@prisma/client'

interface RecipeQuery {
  approvalStatus?: ApprovalStatus
  mealType?: MealType
  cookingStyle?: CookingStyle
  limit?: number
  offset?: number
}

interface RecipeParams {
  id: string
}

interface CreateRecipeBody {
  name: string
  description?: string
  source?: string
  servings: number
  cookTimeMinutes: number
  prepTimeMinutes?: number
  totalTimeMinutes?: number
  mealType: MealType
  cookingStyle: CookingStyle
  photoUrl?: string
  estimatedCaloriesPerServing?: number
  estimatedCostPerServing?: number
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

interface UpdateApprovalBody {
  approvalStatus: ApprovalStatus
}

export default async function recipeRoutes(fastify: FastifyInstance) {
  // List recipes with filtering
  fastify.get('/', async (request: FastifyRequest<{ Querystring: RecipeQuery }>) => {
    const { approvalStatus, mealType, cookingStyle, limit = 50, offset = 0 } = request.query

    const recipes = await fastify.prisma.recipe.findMany({
      where: {
        ...(approvalStatus && { approvalStatus }),
        ...(mealType && { mealType }),
        ...(cookingStyle && { cookingStyle }),
      },
      include: {
        recipeIngredients: {
          include: { ingredient: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })

    return recipes
  })

  // Get pending recipes for swipe discovery
  fastify.get('/discover', async (request: FastifyRequest<{ Querystring: { limit?: number } }>) => {
    const limit = request.query.limit || 10

    const recipes = await fastify.prisma.recipe.findMany({
      where: { approvalStatus: 'pending' },
      include: {
        recipeIngredients: {
          include: { ingredient: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    return recipes
  })

  // Get single recipe
  fastify.get('/:id', async (request: FastifyRequest<{ Params: RecipeParams }>, reply) => {
    const recipe = await fastify.prisma.recipe.findUnique({
      where: { id: request.params.id },
      include: {
        recipeIngredients: {
          include: { ingredient: true },
        },
        recipeInstructions: {
          orderBy: { stepNumber: 'asc' },
        },
        cookingHistory: {
          orderBy: { cookedDate: 'desc' },
          take: 10,
        },
      },
    })

    if (!recipe) {
      return reply.notFound('Recipe not found')
    }

    return recipe
  })

  // Create recipe
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateRecipeBody }>) => {
    const { ingredients, instructions, ...recipeData } = request.body

    const recipe = await fastify.prisma.recipe.create({
      data: {
        ...recipeData,
        totalTimeMinutes: recipeData.totalTimeMinutes ||
          (recipeData.cookTimeMinutes + (recipeData.prepTimeMinutes || 0)),
        recipeIngredients: ingredients ? {
          create: ingredients.map(ing => ({
            ingredientId: ing.ingredientId,
            quantity: ing.quantity,
            unit: ing.unit,
            notes: ing.notes,
            optional: ing.optional || false,
          })),
        } : undefined,
        recipeInstructions: instructions ? {
          create: instructions.map(inst => ({
            stepNumber: inst.stepNumber,
            instructionText: inst.instructionText,
          })),
        } : undefined,
      },
      include: {
        recipeIngredients: {
          include: { ingredient: true },
        },
        recipeInstructions: true,
      },
    })

    return recipe
  })

  // Update approval status (for swipe)
  fastify.patch('/:id/approval', async (
    request: FastifyRequest<{ Params: RecipeParams; Body: UpdateApprovalBody }>,
    reply
  ) => {
    const { id } = request.params
    const { approvalStatus } = request.body

    try {
      const recipe = await fastify.prisma.recipe.update({
        where: { id },
        data: { approvalStatus },
      })
      return recipe
    } catch {
      return reply.notFound('Recipe not found')
    }
  })

  // Update recipe
  fastify.put('/:id', async (
    request: FastifyRequest<{ Params: RecipeParams; Body: Partial<CreateRecipeBody> }>,
    reply
  ) => {
    const { id } = request.params
    const { ingredients, instructions, ...recipeData } = request.body

    try {
      // Update recipe and replace ingredients/instructions if provided
      const recipe = await fastify.prisma.$transaction(async (tx) => {
        if (ingredients) {
          await tx.recipeIngredient.deleteMany({ where: { recipeId: id } })
          await tx.recipeIngredient.createMany({
            data: ingredients.map(ing => ({
              recipeId: id,
              ingredientId: ing.ingredientId,
              quantity: ing.quantity,
              unit: ing.unit,
              notes: ing.notes,
              optional: ing.optional || false,
            })),
          })
        }

        if (instructions) {
          await tx.recipeInstruction.deleteMany({ where: { recipeId: id } })
          await tx.recipeInstruction.createMany({
            data: instructions.map(inst => ({
              recipeId: id,
              stepNumber: inst.stepNumber,
              instructionText: inst.instructionText,
            })),
          })
        }

        return tx.recipe.update({
          where: { id },
          data: recipeData,
          include: {
            recipeIngredients: { include: { ingredient: true } },
            recipeInstructions: { orderBy: { stepNumber: 'asc' } },
          },
        })
      })

      return recipe
    } catch {
      return reply.notFound('Recipe not found')
    }
  })

  // Delete recipe
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: RecipeParams }>, reply) => {
    try {
      await fastify.prisma.recipe.delete({ where: { id: request.params.id } })
      return { success: true }
    } catch {
      return reply.notFound('Recipe not found')
    }
  })
}
