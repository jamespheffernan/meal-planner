import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { transitionPurchaseOrderUpdateData } from '../services/orders/lifecycle.js'
import { analyzePurchaseOrder } from '../services/orders/analyze.js'
import { applyOrderLearning } from '../services/orders/learning.js'

const ListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'placed', 'delivered', 'cancelled']).optional(),
  provider: z.enum(['ocado']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const UpdateBodySchema = z.object({
  // Only allow user-facing terminal-ish transitions via this endpoint.
  // - approved is reserved for checkout dry-run
  // - placed is reserved for the gated place-order flow
  status: z.enum(['delivered', 'cancelled']).optional(),
  deliverySlot: z.string().max(500).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
})

export default async function ordersRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query || {})
    if (!parsed.success) return reply.badRequest('Invalid query')

    const limit = parsed.data.limit ?? 50

    const orders = await fastify.prisma.purchaseOrder.findMany({
      where: {
        status: parsed.data.status,
        provider: parsed.data.provider,
      },
      include: {
        shoppingList: true,
        items: {
          include: {
            ingredient: true,
            storeProduct: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return { orders }
  })

  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const order = await fastify.prisma.purchaseOrder.findUnique({
      where: { id: request.params.id },
      include: {
        shoppingList: { include: { items: { include: { ingredient: true }, orderBy: { createdAt: 'asc' } } } },
        items: { include: { ingredient: true, storeProduct: true }, orderBy: { createdAt: 'asc' } },
      },
    })
    if (!order) return reply.notFound('Order not found')
    return { order }
  })

  fastify.get('/:id/analysis', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const analysis = await analyzePurchaseOrder(fastify.prisma, request.params.id)
    if (!analysis.ok) return reply.notFound(analysis.error || 'Order not found')
    return analysis
  })

  // Update order metadata and/or transition status (strict lifecycle).
  fastify.patch('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const parsed = UpdateBodySchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('Invalid request')

    const hasAny =
      parsed.data.status !== undefined ||
      parsed.data.deliverySlot !== undefined ||
      parsed.data.notes !== undefined
    if (!hasAny) return reply.badRequest('No fields to update')

    const existing = await fastify.prisma.purchaseOrder.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        placedAt: true,
        deliveredAt: true,
        cancelledAt: true,
      },
    })
    if (!existing) return reply.notFound('Order not found')

    let data: any = {}
    if (parsed.data.status) {
      data = { ...data, ...transitionPurchaseOrderUpdateData(existing as any, parsed.data.status) }
    }
    if (parsed.data.deliverySlot !== undefined) data.deliverySlot = parsed.data.deliverySlot
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes

    try {
      const order = await fastify.prisma.purchaseOrder.update({
        where: { id: request.params.id },
        data,
        include: {
          shoppingList: { include: { items: { include: { ingredient: true }, orderBy: { createdAt: 'asc' } } } },
          items: { include: { ingredient: true, storeProduct: true }, orderBy: { createdAt: 'asc' } },
        },
      })
      if (parsed.data.status && parsed.data.status !== existing.status) {
        // Best-effort learning loop from actual "placed/delivered" events.
        await applyOrderLearning(fastify.prisma, order.id, order.status).catch(() => undefined)
      }
      return { order }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to update order'
      if (message.includes('Invalid status transition')) return reply.badRequest(message)
      throw e
    }
  })
}
