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

interface BulkCreateBody {
  ingredients: Array<{
    name: string
    category: IngredientCategory
    typicalUnit: string
    estimatedCaloriesPerUnit?: number
    estimatedCostPerUnit?: number
  }>
}

interface OffLookupResult {
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  imageUrl?: string
  productName?: string
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
    const offData = await searchOpenFoodFacts(request.body.name)
    const ingredient = await fastify.prisma.ingredient.create({
      data: {
        ...request.body,
        estimatedCaloriesPerUnit: request.body.estimatedCaloriesPerUnit ?? offData?.calories,
        imageUrl: offData?.imageUrl,
      },
    })

    return ingredient
  })

  // Bulk create ingredients
  fastify.post('/bulk', async (request: FastifyRequest<{ Body: BulkCreateBody }>, reply) => {
    const { ingredients } = request.body

    if (!ingredients || ingredients.length === 0) {
      return reply.badRequest('Ingredients array is required')
    }

    const created = []
    const errors = []

    for (const item of ingredients) {
      try {
        const offData = await searchOpenFoodFacts(item.name)
        const record = await fastify.prisma.ingredient.create({
          data: {
            ...item,
            estimatedCaloriesPerUnit: item.estimatedCaloriesPerUnit ?? offData?.calories,
            imageUrl: offData?.imageUrl,
          },
        })
        created.push(record)
      } catch (error) {
        errors.push({ name: item.name, error: String(error) })
      }
    }

    return {
      success: true,
      created: created.length,
      errors: errors.length > 0 ? errors : undefined,
    }
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

  // Refresh Open Food Facts data for ingredient
  fastify.post('/:id/off-refresh', async (request: FastifyRequest<{ Params: IngredientParams }>, reply) => {
    const ingredient = await fastify.prisma.ingredient.findUnique({
      where: { id: request.params.id },
    })

    if (!ingredient) {
      return reply.notFound('Ingredient not found')
    }

    const offData = await searchOpenFoodFacts(ingredient.name)
    if (!offData) {
      return reply.badRequest('No Open Food Facts match found')
    }

    const updated = await fastify.prisma.ingredient.update({
      where: { id: ingredient.id },
      data: {
        estimatedCaloriesPerUnit: offData.calories ?? ingredient.estimatedCaloriesPerUnit,
        imageUrl: offData.imageUrl ?? ingredient.imageUrl,
      },
    })

    return {
      ingredient: updated,
      offData,
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

async function searchOpenFoodFacts(ingredientName: string): Promise<OffLookupResult | null> {
  try {
    const query = encodeURIComponent(ingredientName)
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,nutriments,image_url,image_front_url,image_front_small_url`,
      { headers: { 'User-Agent': 'MealPlanner/1.0' } }
    )

    if (!response.ok) return null

    const data = await response.json()
    if (!data.products?.length) return null

    const product = data.products[0]
    const n = product.nutriments || {}

    return {
      productName: product.product_name,
      calories: n['energy-kcal_100g'] || n['energy-kcal'],
      protein: n.proteins_100g || n.proteins,
      carbs: n.carbohydrates_100g || n.carbohydrates,
      fat: n.fat_100g || n.fat,
      imageUrl: product.image_front_url || product.image_url || product.image_front_small_url,
    }
  } catch (error) {
    console.error(`Open Food Facts error for ${ingredientName}:`, error)
    return null
  }
}
