import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { detectStaplesFromOrders } from '../services/staples/detector.js'

const SuggestionsQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).optional(),
})

const DueQuerySchema = z.object({
  max: z.coerce.number().int().min(1).max(200).optional(),
})

const ConfirmSchema = z.object({
  normalizedNames: z.array(z.string().min(1)).min(1),
  reorderAfterDays: z.number().int().min(1).max(60).optional(),
})

export default async function staplesRoutes(fastify: FastifyInstance) {
  fastify.get('/due', async (request: FastifyRequest, reply) => {
    const parsed = DueQuerySchema.safeParse(request.query || {})
    if (!parsed.success) return reply.badRequest('Invalid query')

    const max = parsed.data.max ?? 50
    const rules = await fastify.prisma.stapleRule.findMany({
      where: { enabled: true },
      include: { ingredient: true, storeProduct: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(200, max * 3), // filter in-memory
    })

    const now = Date.now()
    const due = rules.filter((r) => {
      // Avoid spamming: don't surface something we suggested very recently.
      if (r.lastSuggestedAt) {
        const ageDays = (now - new Date(r.lastSuggestedAt).getTime()) / (1000 * 60 * 60 * 24)
        if (ageDays < 1.0) return false
      }
      if (!r.lastPurchasedAt) return true
      const ageDays = (now - new Date(r.lastPurchasedAt).getTime()) / (1000 * 60 * 60 * 24)
      return ageDays >= r.reorderAfterDays
    }).slice(0, max)

    // Best-effort bump lastSuggestedAt so the "due" list stabilizes during a session.
    await fastify.prisma.stapleRule.updateMany({
      where: { id: { in: due.map(d => d.id) } },
      data: { lastSuggestedAt: new Date() },
    }).catch(() => undefined)

    return {
      due: due.map((r) => ({
        id: r.id,
        normalizedName: r.normalizedName,
        reorderAfterDays: r.reorderAfterDays,
        lastPurchasedAt: r.lastPurchasedAt,
        ingredientId: r.ingredientId,
        ingredientName: r.ingredient?.name || null,
        storeProductId: r.storeProductId,
        storeProductName: r.storeProduct?.name || null,
      })),
    }
  })

  fastify.get('/suggestions', async (request: FastifyRequest, reply) => {
    const parsed = SuggestionsQuerySchema.safeParse(request.query || {})
    if (!parsed.success) return reply.badRequest('Invalid query')

    const suggestions = await detectStaplesFromOrders(fastify.prisma, { weeks: parsed.data.weeks || 12 })

    // Persist auto-detected suggestions (disabled) so they can be reviewed/confirmed later.
    const now = new Date()
    await fastify.prisma.$transaction(async (tx) => {
      for (const s of suggestions.slice(0, 50)) {
        const ingredient = await tx.ingredient.findFirst({
          where: { name: { equals: s.normalizedName, mode: 'insensitive' } },
          select: { id: true },
        }).catch(() => null)

        const existing = await tx.stapleRule.findFirst({
          where: { normalizedName: s.normalizedName, source: 'auto_detected' },
          orderBy: { updatedAt: 'desc' },
        })

        if (existing) {
          await tx.stapleRule.update({
            where: { id: existing.id },
            data: {
              reorderAfterDays: s.reorderAfterDays,
              confidence: s.confidence === 'high' ? 0.9 : s.confidence === 'medium' ? 0.7 : 0.5,
              lastPurchasedAt: s.lastPurchasedAt || undefined,
              lastSuggestedAt: now,
            },
          })
        } else {
          await tx.stapleRule.create({
            data: {
              ingredientId: ingredient?.id || undefined,
              normalizedName: s.normalizedName,
              reorderAfterDays: s.reorderAfterDays,
              enabled: false,
              source: 'auto_detected',
              confidence: s.confidence === 'high' ? 0.9 : s.confidence === 'medium' ? 0.7 : 0.5,
              lastPurchasedAt: s.lastPurchasedAt || undefined,
              lastSuggestedAt: now,
            },
          })
        }
      }
    }).catch(() => undefined)

    return { suggestions }
  })

  fastify.post('/confirm', async (request: FastifyRequest, reply) => {
    const parsed = ConfirmSchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('normalizedNames is required')

    const now = new Date()
    const updated = await fastify.prisma.$transaction(async (tx) => {
      const out = []
      for (const name of parsed.data.normalizedNames) {
        const ingredient = await tx.ingredient.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        }).catch(() => null)

        const existing = await tx.stapleRule.findFirst({
          where: { normalizedName: name, source: 'user_confirmed' },
          orderBy: { updatedAt: 'desc' },
        })

        if (existing) {
          out.push(await tx.stapleRule.update({
            where: { id: existing.id },
            data: {
              enabled: true,
              ingredientId: existing.ingredientId || ingredient?.id || undefined,
              reorderAfterDays: parsed.data.reorderAfterDays ?? existing.reorderAfterDays,
              confidence: 1.0,
              lastSuggestedAt: now,
            },
          }))
        } else {
          out.push(await tx.stapleRule.create({
            data: {
              ingredientId: ingredient?.id || undefined,
              normalizedName: name,
              enabled: true,
              source: 'user_confirmed',
              reorderAfterDays: parsed.data.reorderAfterDays ?? 7,
              confidence: 1.0,
              lastSuggestedAt: now,
            },
          }))
        }
      }
      return out
    })

    return { ok: true, rules: updated }
  })
}
