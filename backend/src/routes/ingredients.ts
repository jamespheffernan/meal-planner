import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { IngredientCategory, BrandPreference } from '@prisma/client'

interface IngredientParams {
  id: string
}

interface CreateIngredientBody {
  name: string
  category: IngredientCategory
  typicalUnit: string
  estimatedCaloriesPerUnit?: number
  estimatedCostPerUnit?: number
}

interface CreateBrandBody {
  brandName: string
  preferenceLevel: BrandPreference
  notes?: string
}

export default async function ingredientRoutes(fastify: FastifyInstance) {
  // List ingredients
  fastify.get('/', async (request: FastifyRequest<{ Querystring: { search?: string; category?: IngredientCategory } }>) => {
    const { search, category } = request.query

    const ingredients = await fastify.prisma.ingredient.findMany({
      where: {
        ...(search && { name: { contains: search, mode: 'insensitive' } }),
        ...(category && { category }),
      },
      include: {
        brands: {
          orderBy: { preferenceLevel: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })

    return ingredients
  })

  // Get single ingredient
  fastify.get('/:id', async (request: FastifyRequest<{ Params: IngredientParams }>, reply) => {
    const ingredient = await fastify.prisma.ingredient.findUnique({
      where: { id: request.params.id },
      include: {
        brands: true,
        recipeIngredients: {
          include: { recipe: { select: { id: true, name: true } } },
        },
      },
    })

    if (!ingredient) {
      return reply.notFound('Ingredient not found')
    }

    return ingredient
  })

  // Create ingredient
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateIngredientBody }>) => {
    const ingredient = await fastify.prisma.ingredient.create({
      data: request.body,
    })

    return ingredient
  })

  // Update ingredient
  fastify.put('/:id', async (
    request: FastifyRequest<{ Params: IngredientParams; Body: Partial<CreateIngredientBody> }>,
    reply
  ) => {
    try {
      const ingredient = await fastify.prisma.ingredient.update({
        where: { id: request.params.id },
        data: request.body,
      })
      return ingredient
    } catch {
      return reply.notFound('Ingredient not found')
    }
  })

  // Delete ingredient
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: IngredientParams }>, reply) => {
    try {
      await fastify.prisma.ingredient.delete({ where: { id: request.params.id } })
      return { success: true }
    } catch {
      return reply.notFound('Ingredient not found')
    }
  })

  // Add brand to ingredient
  fastify.post('/:id/brands', async (
    request: FastifyRequest<{ Params: IngredientParams; Body: CreateBrandBody }>,
    reply
  ) => {
    const ingredient = await fastify.prisma.ingredient.findUnique({
      where: { id: request.params.id },
    })

    if (!ingredient) {
      return reply.notFound('Ingredient not found')
    }

    const brand = await fastify.prisma.brand.create({
      data: {
        ingredientId: request.params.id,
        ...request.body,
      },
    })

    return brand
  })

  // Delete brand
  fastify.delete('/:id/brands/:brandId', async (
    request: FastifyRequest<{ Params: { id: string; brandId: string } }>,
    reply
  ) => {
    try {
      await fastify.prisma.brand.delete({ where: { id: request.params.brandId } })
      return { success: true }
    } catch {
      return reply.notFound('Brand not found')
    }
  })
}
