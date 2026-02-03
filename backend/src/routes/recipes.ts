import type { FastifyInstance, FastifyRequest } from 'fastify'
// @ts-ignore - no type definitions available
import heicConvert from 'heic-convert'
import sharp from 'sharp'
import type { ApprovalStatus, MealType, CookingStyle } from '@prisma/client'

interface RecipeQuery {
  approvalStatus?: ApprovalStatus
  mealType?: MealType
  cookingStyle?: CookingStyle
  limit?: string
  offset?: string
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
    const { approvalStatus, mealType, cookingStyle } = request.query
    const limit = Number(request.query.limit) || 50
    const offset = Number(request.query.offset) || 0

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
  fastify.get('/discover', async (request: FastifyRequest<{ Querystring: { limit?: string } }>) => {
    const limit = Number(request.query.limit) || 10

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

  // Update recipe photo
  fastify.patch('/:id/photo', async (
    request: FastifyRequest<{ Params: RecipeParams; Body: { photoUrl?: string; photoBase64?: string; mimeType?: string } }>,
    reply
  ) => {
    const { id } = request.params
    const { photoUrl, photoBase64, mimeType } = request.body

    let finalPhotoUrl = photoUrl

    // If base64 provided, normalize to a reasonably sized JPEG data URL
    if (photoBase64 && mimeType) {
      const normalized = await normalizePhotoBase64(photoBase64, mimeType)
      finalPhotoUrl = `data:${normalized.mimeType};base64,${normalized.base64}`
    }

    if (!finalPhotoUrl) {
      return reply.badRequest('Either photoUrl or photoBase64 with mimeType is required')
    }

    try {
      const recipe = await fastify.prisma.recipe.update({
        where: { id },
        data: { photoUrl: finalPhotoUrl },
      })
      return recipe
    } catch {
      return reply.notFound('Recipe not found')
    }
  })

  // Search and set a placeholder image for recipe
  fastify.post('/:id/find-image', async (
    request: FastifyRequest<{ Params: RecipeParams }>,
    reply
  ) => {
    const { id } = request.params

    const recipe = await fastify.prisma.recipe.findUnique({
      where: { id },
      select: { name: true, mealType: true },
    })

    if (!recipe) {
      return reply.notFound('Recipe not found')
    }

    // Import dynamically to avoid circular deps
    const { searchFoodImage, getPlaceholderImage } = await import('../services/image-search.js')

    // Try to find a specific image, fall back to placeholder
    let photoUrl = await searchFoodImage(recipe.name)
    if (!photoUrl) {
      photoUrl = getPlaceholderImage(recipe.mealType)
    }

    const updated = await fastify.prisma.recipe.update({
      where: { id },
      data: { photoUrl },
    })

    return { photoUrl: updated.photoUrl }
  })

  // Generate an AI image for a recipe
  fastify.post('/:id/generate-image', async (
    request: FastifyRequest<{ Params: RecipeParams }>,
    reply
  ) => {
    const { id } = request.params

    const recipe = await fastify.prisma.recipe.findUnique({
      where: { id },
      select: { name: true, mealType: true },
    })

    if (!recipe) {
      return reply.notFound('Recipe not found')
    }

    try {
      const { generateRecipeImage } = await import('../services/ai-image.js')
      const photoUrl = await generateRecipeImage(fastify.prisma, recipe.name, recipe.mealType)

      const updated = await fastify.prisma.recipe.update({
        where: { id },
        data: { photoUrl },
      })

      return { photoUrl: updated.photoUrl }
    } catch (error) {
      console.error('Failed to generate AI image', {
        recipeId: id,
        message: error instanceof Error ? error.message : error,
      })
      return reply.internalServerError('Failed to generate AI image')
    }
  })
}

async function normalizePhotoBase64(photoBase64: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  const lowerType = mimeType.toLowerCase()
  let inputBuffer = Buffer.from(photoBase64, 'base64')

  if (lowerType.includes('heic') || lowerType.includes('heif')) {
    const jpegBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.9,
    })
    inputBuffer = Buffer.from(jpegBuffer)
  }

  const image = sharp(inputBuffer)
  const metadata = await image.metadata()
  const maxSize = 1600

  if (metadata.width && metadata.height) {
    if (metadata.width > maxSize || metadata.height > maxSize) {
      image.resize({ width: maxSize, height: maxSize, fit: 'inside' })
    }
  }

  const outputBuffer = await image.jpeg({ quality: 85 }).toBuffer()

  return {
    base64: outputBuffer.toString('base64'),
    mimeType: 'image/jpeg',
  }
}
