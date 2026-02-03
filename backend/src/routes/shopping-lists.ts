import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ShoppingListStatus, UserOverride } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { canonicalizeUnit, getUnitKind, toBaseUnit, getBestDisplayUnit, type CanonicalUnit, type MeasurementSystem } from '../services/units.js'

interface ShoppingListParams {
  id: string
}

interface GenerateShoppingListBody {
  mealPlanIds: string[]
  shoppingDate?: string
}

interface UpdateItemBody {
  userOverride?: UserOverride | null
  quantity?: number
  purchased?: boolean
  notes?: string
  actualCost?: number
}

// Staple categories that are assumed to be in stock
const STAPLE_CATEGORIES = ['staple']
const PERISHABLE_CATEGORIES = ['perishable', 'produce', 'meat', 'dairy']

export default async function shoppingListRoutes(fastify: FastifyInstance) {
  // List shopping lists
  fastify.get('/', async (request: FastifyRequest<{ Querystring: { status?: ShoppingListStatus } }>) => {
    const { status } = request.query

    const lists = await fastify.prisma.shoppingList.findMany({
      where: status ? { status } : undefined,
      include: {
        items: {
          include: {
            ingredient: true,
            brand: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return lists
  })

  // Get single shopping list
  fastify.get('/:id', async (request: FastifyRequest<{ Params: ShoppingListParams }>, reply) => {
    const list = await fastify.prisma.shoppingList.findUnique({
      where: { id: request.params.id },
      include: {
        items: {
          include: {
            ingredient: true,
            brand: true,
          },
          orderBy: { ingredient: { category: 'asc' } },
        },
      },
    })

    if (!list) {
      return reply.notFound('Shopping list not found')
    }

    return list
  })

  // Generate shopping list from meal plans (core algorithm from spec)
  fastify.post('/generate', async (request: FastifyRequest<{ Body: GenerateShoppingListBody }>) => {
    const { mealPlanIds, shoppingDate } = request.body

    // Get all meal plans with recipes and ingredients
    const mealPlans = await fastify.prisma.mealPlan.findMany({
      where: { id: { in: mealPlanIds } },
      include: {
        recipe: {
          include: {
            recipeIngredients: {
              include: { ingredient: true },
            },
          },
        },
      },
    })

    // Get user measurement system preference
    const userPrefs = await fastify.prisma.userPreferences.findFirst()
    const measurementSystem: MeasurementSystem = (userPrefs as any)?.measurementSystem === 'metric' ? 'metric' : 'us'

    // Aggregate ingredients — convert to base unit before summing
    const ingredientsNeeded: Map<string, {
      baseQty: number      // quantity in base unit (ml for volume, g for weight, raw for others)
      baseUnit: string     // 'ml', 'g', or the original unit
      originalUnits: Set<string>
      ingredient: { id: string; name: string; category: string; estimatedCostPerUnit: Decimal | null }
      recipeIds: string[]
    }> = new Map()

    for (const mealPlan of mealPlans) {
      const recipe = mealPlan.recipe
      const servingsMultiplier = mealPlan.servingsPlanned / recipe.servings

      for (const ri of recipe.recipeIngredients) {
        const scaledQty = Number(ri.quantity) * servingsMultiplier
        const unit = canonicalizeUnit(ri.unit) as CanonicalUnit
        const base = toBaseUnit(scaledQty, unit)
        const existing = ingredientsNeeded.get(ri.ingredientId)

        if (existing) {
          // Check if units are compatible (same base)
          if (existing.baseUnit === base.unit) {
            existing.baseQty += base.qty
          } else {
            // Incompatible units — keep as separate note
            existing.baseQty += base.qty
          }
          existing.originalUnits.add(ri.unit)
          if (!existing.recipeIds.includes(recipe.id)) {
            existing.recipeIds.push(recipe.id)
          }
        } else {
          ingredientsNeeded.set(ri.ingredientId, {
            baseQty: base.qty,
            baseUnit: base.unit as string,
            originalUnits: new Set([ri.unit]),
            ingredient: {
              id: ri.ingredient.id,
              name: ri.ingredient.name,
              category: ri.ingredient.category,
              estimatedCostPerUnit: ri.ingredient.estimatedCostPerUnit,
            },
            recipeIds: [recipe.id],
          })
        }
      }
    }

    // Check pantry and apply intelligent assumptions
    const pantryItems = await fastify.prisma.pantryInventory.findMany({
      where: {
        ingredientId: { in: Array.from(ingredientsNeeded.keys()) },
        status: { not: 'depleted' },
      },
    })

    const pantryMap = new Map(pantryItems.map(p => [p.ingredientId, p]))

    // Get preferred brands
    const brands = await fastify.prisma.brand.findMany({
      where: {
        ingredientId: { in: Array.from(ingredientsNeeded.keys()) },
        preferenceLevel: 'preferred',
      },
    })
    const brandMap = new Map(brands.map(b => [b.ingredientId, b]))

    // Build shopping list items
    const shoppingListItems: {
      ingredientId: string
      brandId: string | null
      quantity: Decimal
      unit: string
      assumedHave: boolean
      estimatedCost: Decimal | null
      recipeIds: string[]
      notes: string | undefined
    }[] = []

    let totalEstimatedCost = new Decimal(0)

    for (const [ingredientId, data] of ingredientsNeeded) {
      const pantryItem = pantryMap.get(ingredientId)
      let neededBaseQty = data.baseQty

      // Deduct pantry quantity — convert pantry to same base unit
      if (pantryItem) {
        const pantryUnit = canonicalizeUnit(pantryItem.unit) as CanonicalUnit
        const pantryBase = toBaseUnit(Number(pantryItem.quantity), pantryUnit)
        if (pantryBase.unit === data.baseUnit) {
          neededBaseQty -= pantryBase.qty
          if (neededBaseQty < 0) neededBaseQty = 0
        }
        // If units are incompatible, skip deduction (pantry in different kind)
      }

      // Apply intelligent assumption based on category
      let assumedHave = false
      if (STAPLE_CATEGORIES.includes(data.ingredient.category)) {
        assumedHave = true
      } else if (PERISHABLE_CATEGORIES.includes(data.ingredient.category)) {
        assumedHave = false
      }

      // Override if pantry says depleted
      if (pantryItem && pantryItem.status === 'depleted') {
        assumedHave = false
      }

      // Convert back to a human-friendly display unit
      const kind = getUnitKind(canonicalizeUnit(data.baseUnit) as CanonicalUnit)
      let displayQty: number
      let displayUnit: string

      if (kind === 'volume' || kind === 'weight') {
        const best = getBestDisplayUnit(
          neededBaseQty > 0 ? neededBaseQty : data.baseQty,
          kind,
          measurementSystem
        )
        displayQty = Math.round(best.qty * 100) / 100
        displayUnit = best.unit
      } else {
        displayQty = neededBaseQty > 0 ? neededBaseQty : data.baseQty
        displayUnit = data.baseUnit
      }

      // Calculate cost
      let estimatedCost: Decimal | null = null
      if (data.ingredient.estimatedCostPerUnit && displayQty > 0) {
        estimatedCost = new Decimal(displayQty).mul(data.ingredient.estimatedCostPerUnit)
        totalEstimatedCost = totalEstimatedCost.add(estimatedCost)
      }

      const preferredBrand = brandMap.get(ingredientId)

      shoppingListItems.push({
        ingredientId,
        brandId: preferredBrand?.id || null,
        quantity: new Decimal(displayQty),
        unit: displayUnit,
        assumedHave,
        estimatedCost,
        recipeIds: data.recipeIds,
        notes: undefined,
      })
    }

    // Create shopping list with items
    const shoppingList = await fastify.prisma.shoppingList.create({
      data: {
        shoppingDate: shoppingDate ? new Date(shoppingDate) : null,
        totalEstimatedCost,
        items: {
          create: shoppingListItems,
        },
      },
      include: {
        items: {
          include: {
            ingredient: true,
            brand: true,
          },
        },
      },
    })

    return shoppingList
  })

  // Update shopping list status
  fastify.patch('/:id/status', async (
    request: FastifyRequest<{ Params: ShoppingListParams; Body: { status: ShoppingListStatus } }>,
    reply
  ) => {
    try {
      const list = await fastify.prisma.shoppingList.update({
        where: { id: request.params.id },
        data: { status: request.body.status },
      })
      return list
    } catch {
      return reply.notFound('Shopping list not found')
    }
  })

  // Update shopping list item (user override, toggle need/have)
  fastify.patch('/:id/items/:itemId', async (
    request: FastifyRequest<{ Params: { id: string; itemId: string }; Body: UpdateItemBody }>,
    reply
  ) => {
    try {
      const item = await fastify.prisma.shoppingListItem.update({
        where: { id: request.params.itemId },
        data: request.body,
        include: { ingredient: true, brand: true },
      })
      return item
    } catch {
      return reply.notFound('Item not found')
    }
  })

  // Mark shopping complete and update pantry
  fastify.post('/:id/complete', async (
    request: FastifyRequest<{ Params: ShoppingListParams }>,
    reply
  ) => {
    const list = await fastify.prisma.shoppingList.findUnique({
      where: { id: request.params.id },
      include: { items: true },
    })

    if (!list) {
      return reply.notFound('Shopping list not found')
    }

    const result = await fastify.prisma.$transaction(async (tx) => {
      // Update pantry with purchased items
      const purchasedItems = list.items.filter(item => item.purchased)

      for (const item of purchasedItems) {
        // Upsert pantry inventory
        const existingPantry = await tx.pantryInventory.findFirst({
          where: { ingredientId: item.ingredientId },
        })

        if (existingPantry) {
          await tx.pantryInventory.update({
            where: { id: existingPantry.id },
            data: {
              quantity: { increment: item.quantity },
              status: 'stocked',
              source: 'grocery_trip',
            },
          })
        } else {
          await tx.pantryInventory.create({
            data: {
              ingredientId: item.ingredientId,
              quantity: item.quantity,
              unit: item.unit,
              acquiredDate: new Date(),
              status: 'stocked',
              source: 'grocery_trip',
            },
          })
        }
      }

      // Mark list as completed
      const updatedList = await tx.shoppingList.update({
        where: { id: request.params.id },
        data: { status: 'completed' },
      })

      return updatedList
    })

    return result
  })

  // Delete shopping list
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: ShoppingListParams }>, reply) => {
    try {
      await fastify.prisma.shoppingList.delete({ where: { id: request.params.id } })
      return { success: true }
    } catch {
      return reply.notFound('Shopping list not found')
    }
  })
}
