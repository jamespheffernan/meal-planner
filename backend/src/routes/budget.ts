import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getBudgetSummary } from '../services/budget/summary.js'

const SummaryQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).optional(),
})

export default async function budgetRoutes(fastify: FastifyInstance) {
  fastify.get('/summary', async (request: FastifyRequest, reply) => {
    const parsed = SummaryQuerySchema.safeParse(request.query || {})
    if (!parsed.success) return reply.badRequest('Invalid query')

    const summary = await getBudgetSummary(fastify.prisma, parsed.data.weeks || 8)
    return summary
  })
}

