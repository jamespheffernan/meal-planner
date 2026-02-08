import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { handleAssistantMessage } from '../services/shopping-assistant/orchestrator.js'

const MessageSchema = z.object({
  channel: z.enum(['telegram', 'web']),
  externalId: z.string().min(1),
  message: z.string().min(1),
})

export default async function shoppingAssistantRoutes(fastify: FastifyInstance) {
  fastify.post('/message', async (request: FastifyRequest, reply) => {
    const parsed = MessageSchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('channel, externalId, message are required')

    return handleAssistantMessage(fastify.prisma, parsed.data)
  })
}

