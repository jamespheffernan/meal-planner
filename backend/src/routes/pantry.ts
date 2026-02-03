import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PantryStatus, PantrySource } from '@prisma/client'
import { canonicalizeUnit, toBaseUnit, type CanonicalUnit } from '../services/units.js'

interface PantryParams {
  id: string
}

interface CreatePantryItemBody {
  ingredientId: string
  quantity: number
  unit: string
  acquiredDate?: string
  expirationDate?: string
  status?: PantryStatus
  source?: PantrySource
  notes?: string
}

interface UpdatePantryItemBody {
  quantity?: number
  status?: PantryStatus
  expirationDate?: string | null
  notes?: string
}

export default async function pantryRoutes(fastify: FastifyInstance) {
  // List pantry items
  fastify.get('/', async (request: FastifyRequest<{
    Querystring: {
      status?: PantryStatus
      expiringWithinDays?: number
    }
  }>) => {
    const { status, expiringWithinDays } = request.query

    let expirationFilter = {}
    if (expiringWithinDays) {
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() + expiringWithinDays)
      expirationFilter = {
        expirationDate: {
          lte: targetDate,
          gte: new Date(),
        },
      }
    }

    const items = await fastify.prisma.pantryInventory.findMany({
      where: {
        ...(status && { status }),
        ...expirationFilter,
      },
      include: {
        ingredient: true,
      },
      orderBy: [
        { expirationDate: 'asc' },
        { ingredient: { name: 'asc' } },
      ],
    })

    return items
  })

  // Get expiring soon items (for dashboard alerts)
  fastify.get('/expiring', async (request: FastifyRequest<{ Querystring: { days?: number } }>) => {
    const days = request.query.days || 5
    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + days)

    const items = await fastify.prisma.pantryInventory.findMany({
      where: {
        expirationDate: {
          lte: targetDate,
          gte: new Date(),
        },
        status: { not: 'depleted' },
      },
      include: {
        ingredient: true,
      },
      orderBy: { expirationDate: 'asc' },
    })

    return items
  })

  // Get single pantry item
  fastify.get('/:id', async (request: FastifyRequest<{ Params: PantryParams }>, reply) => {
    const item = await fastify.prisma.pantryInventory.findUnique({
      where: { id: request.params.id },
      include: { ingredient: true },
    })

    if (!item) {
      return reply.notFound('Pantry item not found')
    }

    return item
  })

  // Add pantry item
  fastify.post('/', async (request: FastifyRequest<{ Body: CreatePantryItemBody }>) => {
    const { acquiredDate, expirationDate, ...rest } = request.body

    const item = await fastify.prisma.pantryInventory.create({
      data: {
        ...rest,
        unit: canonicalizeUnit(rest.unit),
        acquiredDate: acquiredDate ? new Date(acquiredDate) : new Date(),
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        source: rest.source || 'manual_entry',
      },
      include: { ingredient: true },
    })

    return item
  })

  // Update pantry item
  fastify.patch('/:id', async (
    request: FastifyRequest<{ Params: PantryParams; Body: UpdatePantryItemBody }>,
    reply
  ) => {
    const { expirationDate, ...rest } = request.body

    try {
      const item = await fastify.prisma.pantryInventory.update({
        where: { id: request.params.id },
        data: {
          ...rest,
          ...(expirationDate !== undefined && {
            expirationDate: expirationDate ? new Date(expirationDate) : null,
          }),
        },
        include: { ingredient: true },
      })
      return item
    } catch {
      return reply.notFound('Pantry item not found')
    }
  })

  // Quick status update (for telegram bot or quick actions)
  fastify.patch('/:id/status', async (
    request: FastifyRequest<{ Params: PantryParams; Body: { status: PantryStatus } }>,
    reply
  ) => {
    try {
      const item = await fastify.prisma.pantryInventory.update({
        where: { id: request.params.id },
        data: {
          status: request.body.status,
          source: 'user_checkin',
        },
        include: { ingredient: true },
      })
      return item
    } catch {
      return reply.notFound('Pantry item not found')
    }
  })

  // Bulk update from check-in (for telegram bot interactions)
  fastify.post('/checkin', async (request: FastifyRequest<{
    Body: { updates: { ingredientId: string; have: boolean }[] }
  }>) => {
    const { updates } = request.body

    const results = await fastify.prisma.$transaction(async (tx) => {
      const updated = []

      for (const update of updates) {
        const existing = await tx.pantryInventory.findFirst({
          where: { ingredientId: update.ingredientId },
        })

        if (existing) {
          const item = await tx.pantryInventory.update({
            where: { id: existing.id },
            data: {
              status: update.have ? 'stocked' : 'depleted',
              source: 'user_checkin',
            },
          })
          updated.push(item)
        }
      }

      return updated
    })

    return results
  })

  // Deduct ingredients after cooking (called when meal is marked cooked)
  fastify.post('/deduct', async (request: FastifyRequest<{
    Body: {
      recipeId: string
      servingsCooked: number
    }
  }>) => {
    const { recipeId, servingsCooked } = request.body

    // Get recipe with ingredients
    const recipe = await fastify.prisma.recipe.findUnique({
      where: { id: recipeId },
      include: {
        recipeIngredients: true,
      },
    })

    if (!recipe) {
      return { deducted: [] }
    }

    const multiplier = servingsCooked / recipe.servings

    const results = await fastify.prisma.$transaction(async (tx) => {
      const deducted = []

      for (const ri of recipe.recipeIngredients) {
        const recipeQty = Number(ri.quantity) * multiplier
        const recipeUnit = canonicalizeUnit(ri.unit) as CanonicalUnit
        const recipeBase = toBaseUnit(recipeQty, recipeUnit)

        const pantryItem = await tx.pantryInventory.findFirst({
          where: { ingredientId: ri.ingredientId },
        })

        if (pantryItem) {
          const pantryUnit = canonicalizeUnit(pantryItem.unit) as CanonicalUnit
          const pantryBase = toBaseUnit(Number(pantryItem.quantity), pantryUnit)

          let newQuantity: number
          if (pantryBase.unit === recipeBase.unit) {
            // Same base unit — subtract in base, convert back
            const newBaseQty = Math.max(0, pantryBase.qty - recipeBase.qty)
            // Convert back to pantry's original unit
            const factor = pantryBase.qty > 0 ? Number(pantryItem.quantity) / pantryBase.qty : 1
            newQuantity = newBaseQty * factor
          } else {
            // Incompatible units — best effort: subtract raw quantities
            newQuantity = Math.max(0, Number(pantryItem.quantity) - recipeQty)
          }

          const newStatus: PantryStatus = newQuantity <= 0 ? 'depleted' :
            newQuantity < Number(pantryItem.quantity) * 0.25 ? 'running_low' : 'stocked'

          const updated = await tx.pantryInventory.update({
            where: { id: pantryItem.id },
            data: {
              quantity: newQuantity,
              status: newStatus,
              source: 'recipe_deduction',
            },
          })
          deducted.push(updated)
        }
      }

      return deducted
    })

    return { deducted: results }
  })

  // Delete pantry item
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: PantryParams }>, reply) => {
    try {
      await fastify.prisma.pantryInventory.delete({ where: { id: request.params.id } })
      return { success: true }
    } catch {
      return reply.notFound('Pantry item not found')
    }
  })
}
