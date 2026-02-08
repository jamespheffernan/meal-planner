import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { setOcadoDefaultIngredientMapping, setOcadoShoppingListOverride } from '../services/orders/mappings.js'

const ListMappingsQuerySchema = z.object({
  provider: z.enum(['ocado']).optional(),
  shoppingListId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const SetDefaultBodySchema = z.object({
  ingredientId: z.string().min(1),
  storeProductId: z.string().min(1),
})

const ClearDefaultBodySchema = z.object({
  ingredientId: z.string().min(1),
})

const SetOverrideBodySchema = z.object({
  shoppingListId: z.string().min(1),
  ingredientId: z.string().min(1),
  storeProductId: z.string().min(1),
})

const ClearOverrideBodySchema = z.object({
  shoppingListId: z.string().min(1),
  ingredientId: z.string().min(1),
})

export default async function mappingsRoutes(fastify: FastifyInstance) {
  // List ingredients + mappings. Optional `shoppingListId` adds per-list overrides.
  fastify.get('/', async (request: FastifyRequest, reply) => {
    const parsed = ListMappingsQuerySchema.safeParse(request.query || {})
    if (!parsed.success) return reply.badRequest('Invalid request')

    const provider = parsed.data.provider || 'ocado'
    const shoppingListId = parsed.data.shoppingListId
    const q = parsed.data.q?.trim()
    const limit = parsed.data.limit || 200

    const ingredients = await fastify.prisma.ingredient.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
      take: limit,
      include: {
        ingredientStoreMappings: {
          where: {
            isDefault: true,
            storeProduct: { provider },
          },
          include: { storeProduct: true },
          take: 1,
        },
      },
    })

    const ingredientIds = ingredients.map(i => i.id)
    const overrides = shoppingListId
      ? await fastify.prisma.shoppingListIngredientStoreOverride.findMany({
        where: { shoppingListId, provider, ingredientId: { in: ingredientIds } },
        include: { storeProduct: true },
      })
      : []

    const overrideByIngredientId = new Map(overrides.map(o => [o.ingredientId, o]))

    return {
      ok: true as const,
      provider,
      items: ingredients.map(i => {
        const def = i.ingredientStoreMappings?.[0]?.storeProduct || null
        const ov = overrideByIngredientId.get(i.id)?.storeProduct || null
        const effective = ov || def
        const effectiveSource = ov ? 'this_list' : def ? 'default' : null
        return {
          ingredientId: i.id,
          ingredientName: i.name,
          defaultMapping: def ? {
            storeProductId: def.id,
            provider: def.provider,
            providerProductId: def.providerProductId,
            name: def.name,
            imageUrl: def.imageUrl,
            productUrl: def.productUrl,
            lastSeenPrice: def.lastSeenPrice !== null && def.lastSeenPrice !== undefined ? Number(def.lastSeenPrice) : null,
            currency: def.currency,
          } : null,
          overrideMapping: ov ? {
            storeProductId: ov.id,
            provider: ov.provider,
            providerProductId: ov.providerProductId,
            name: ov.name,
            imageUrl: ov.imageUrl,
            productUrl: ov.productUrl,
            lastSeenPrice: ov.lastSeenPrice !== null && ov.lastSeenPrice !== undefined ? Number(ov.lastSeenPrice) : null,
            currency: ov.currency,
          } : null,
          effectiveMapping: effective ? {
            storeProductId: effective.id,
            provider: effective.provider,
            providerProductId: effective.providerProductId,
            name: effective.name,
            imageUrl: effective.imageUrl,
            productUrl: effective.productUrl,
            lastSeenPrice: effective.lastSeenPrice !== null && effective.lastSeenPrice !== undefined ? Number(effective.lastSeenPrice) : null,
            currency: effective.currency,
          } : null,
          effectiveSource,
        }
      }),
    }
  })

  // Set global default mapping (default forever).
  fastify.put('/default', async (request: FastifyRequest, reply) => {
    const parsed = SetDefaultBodySchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('Invalid request')
    await setOcadoDefaultIngredientMapping(fastify.prisma, parsed.data.ingredientId, parsed.data.storeProductId)
    return { ok: true }
  })

  // Clear global default mapping.
  fastify.delete('/default', async (request: FastifyRequest, reply) => {
    const parsed = ClearDefaultBodySchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('Invalid request')
    await setOcadoDefaultIngredientMapping(fastify.prisma, parsed.data.ingredientId, null)
    return { ok: true }
  })

  // Set per-list override mapping (this list only).
  fastify.put('/override', async (request: FastifyRequest, reply) => {
    const parsed = SetOverrideBodySchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('Invalid request')
    await setOcadoShoppingListOverride(
      fastify.prisma,
      parsed.data.shoppingListId,
      parsed.data.ingredientId,
      parsed.data.storeProductId
    )
    return { ok: true }
  })

  // Clear per-list override mapping.
  fastify.delete('/override', async (request: FastifyRequest, reply) => {
    const parsed = ClearOverrideBodySchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('Invalid request')
    await setOcadoShoppingListOverride(fastify.prisma, parsed.data.shoppingListId, parsed.data.ingredientId, null)
    return { ok: true }
  })
}
