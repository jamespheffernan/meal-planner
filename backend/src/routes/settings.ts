import type { FastifyInstance, FastifyRequest } from 'fastify'
import OpenAI from 'openai'
import { OPENAI_SECRET_ID, getOpenAIKey } from '../services/openai-client.js'
import { storeSecret, deleteSecret, hasSecret, isEncryptionReady } from '../services/secret-store.js'

interface OpenAIKeyBody {
  apiKey: string
}

interface OpenAIKeyVerifyBody {
  apiKey?: string
}

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get('/openai-key', async () => {
    const { source } = await getOpenAIKey(fastify.prisma)
    const hasKey = source !== 'none'
    return { hasKey, source, encryptionReady: isEncryptionReady() }
  })

  fastify.put('/openai-key', async (request: FastifyRequest<{ Body: OpenAIKeyBody }>, reply) => {
    const apiKey = request.body?.apiKey?.trim()
    if (!apiKey) {
      return reply.badRequest('apiKey is required')
    }

    try {
      await storeSecret(fastify.prisma, OPENAI_SECRET_ID, apiKey)
      return { hasKey: true }
    } catch (error) {
      if (error instanceof Error && error.message.includes('MEAL_PLANNER_ENCRYPTION_KEY')) {
        return reply.badRequest(error.message)
      }
      return reply.internalServerError(error instanceof Error ? error.message : 'Failed to store key')
    }
  })

  fastify.delete('/openai-key', async () => {
    await deleteSecret(fastify.prisma, OPENAI_SECRET_ID)
    const hasKey = await hasSecret(fastify.prisma, OPENAI_SECRET_ID)
    return { hasKey }
  })

  fastify.post('/openai-key/verify', async (request: FastifyRequest<{ Body: OpenAIKeyVerifyBody }>, reply) => {
    const apiKey = request.body?.apiKey?.trim()
    let keyToTest = apiKey

    if (!keyToTest) {
      const { key } = await getOpenAIKey(fastify.prisma)
      keyToTest = key || undefined
    }

    if (!keyToTest) {
      return reply.badRequest('No OpenAI API key provided or stored')
    }

    try {
      const openai = new OpenAI({ apiKey: keyToTest })
      const models = await openai.models.list()
      const firstModel = models.data?.[0]?.id
      return { ok: true, model: firstModel || null }
    } catch (error: any) {
      const status = error?.status || error?.response?.status
      if (status === 401) {
        return reply.badRequest('Invalid OpenAI API key')
      }
      return reply.internalServerError('Failed to verify OpenAI API key')
    }
  })
}
