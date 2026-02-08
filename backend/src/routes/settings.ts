import type { FastifyInstance, FastifyRequest } from 'fastify'
import OpenAI from 'openai'
import { OPENAI_SECRET_ID, getOpenAIKey } from '../services/openai-client.js'
import { storeSecret, deleteSecret, hasSecret, isEncryptionReady } from '../services/secret-store.js'
import { setRecipeAuthCookie, deleteRecipeAuthCookie, hasRecipeAuthCookie, isEncryptionReady as isRecipeAuthReady } from '../services/recipe-auth.js'
import type { StoreProvider } from '@prisma/client'
import { deleteStoreSession, getStoreSessionStatus, setStoreSession } from '../services/store-session.js'
import { z } from 'zod'

interface OpenAIKeyBody {
  apiKey: string
}

interface OpenAIKeyVerifyBody {
  apiKey?: string
}

interface RecipeAuthCookieBody {
  hostname: string
  cookie?: string
}

const StoreSessionUpsertSchema = z.object({
  provider: z.enum(['ocado']),
  // Accept either a JSON string or a parsed object. We store encrypted JSON.
  storageStateJson: z.string().optional(),
  storageState: z.unknown().optional(),
})

const StoreSessionDeleteSchema = z.object({
  provider: z.enum(['ocado']),
})

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

  fastify.get('/recipe-auth-cookie', async (request: FastifyRequest) => {
    const hostname = String((request.query as Record<string, unknown>)?.hostname || '').trim()
    if (!hostname) {
      return { hasCookie: false, encryptionReady: isRecipeAuthReady() }
    }
    const hasCookie = await hasRecipeAuthCookie(fastify.prisma, hostname)
    return { hasCookie, encryptionReady: isRecipeAuthReady(), hostname }
  })

  fastify.put('/recipe-auth-cookie', async (request: FastifyRequest<{ Body: RecipeAuthCookieBody }>, reply) => {
    const hostname = request.body?.hostname?.trim()
    const cookie = request.body?.cookie?.trim()

    if (!hostname) {
      return reply.badRequest('hostname is required')
    }
    if (!cookie) {
      return reply.badRequest('cookie is required')
    }

    try {
      await setRecipeAuthCookie(fastify.prisma, hostname, cookie)
      return { hasCookie: true, hostname }
    } catch (error) {
      if (error instanceof Error && error.message.includes('MEAL_PLANNER_ENCRYPTION_KEY')) {
        return reply.badRequest(error.message)
      }
      return reply.internalServerError(error instanceof Error ? error.message : 'Failed to store cookie')
    }
  })

  fastify.delete('/recipe-auth-cookie', async (request: FastifyRequest<{ Body: RecipeAuthCookieBody }>, reply) => {
    const hostname = request.body?.hostname?.trim()
    if (!hostname) {
      return reply.badRequest('hostname is required')
    }
    await deleteRecipeAuthCookie(fastify.prisma, hostname)
    const hasCookie = await hasRecipeAuthCookie(fastify.prisma, hostname)
    return { hasCookie, hostname }
  })

  // Store sessions (Playwright storageState) - stored encrypted in AppSecret
  fastify.get('/store-session', async (request: FastifyRequest) => {
    const providerRaw = String((request.query as any)?.provider || '').trim()
    const provider = (providerRaw || 'ocado') as StoreProvider
    if (provider !== 'ocado') {
      return { hasSession: false, provider, encryptionReady: isEncryptionReady() }
    }
    return getStoreSessionStatus(fastify.prisma, provider)
  })

  fastify.put('/store-session', async (request: FastifyRequest, reply) => {
    const parsed = StoreSessionUpsertSchema.safeParse(request.body || {})
    if (!parsed.success) {
      return reply.badRequest('provider and storageState are required')
    }

    const provider = parsed.data.provider as StoreProvider
    const storageStateJson =
      parsed.data.storageStateJson ||
      (parsed.data.storageState ? JSON.stringify(parsed.data.storageState) : null)

    if (!storageStateJson) {
      return reply.badRequest('storageStateJson or storageState is required')
    }

    try {
      await setStoreSession(fastify.prisma, provider, storageStateJson)
      return { hasSession: true, provider }
    } catch (error) {
      if (error instanceof Error && error.message.includes('MEAL_PLANNER_ENCRYPTION_KEY')) {
        return reply.badRequest(error.message)
      }
      return reply.internalServerError(error instanceof Error ? error.message : 'Failed to store session')
    }
  })

  fastify.delete('/store-session', async (request: FastifyRequest, reply) => {
    const parsed = StoreSessionDeleteSchema.safeParse(request.body || {})
    if (!parsed.success) {
      return reply.badRequest('provider is required')
    }
    const provider = parsed.data.provider as StoreProvider
    return deleteStoreSession(fastify.prisma, provider)
  })
}
