import OpenAI from 'openai'
import type { PrismaClient } from '@prisma/client'
import { getSecret } from './secret-store.js'

const OPENAI_SECRET_ID = 'openai_api_key'

export async function getOpenAIKey(prisma: PrismaClient): Promise<{ key: string | null; source: 'env' | 'db' | 'none' }> {
  if (process.env.OPENAI_API_KEY) {
    return { key: process.env.OPENAI_API_KEY, source: 'env' }
  }

  try {
    const stored = await getSecret(prisma, OPENAI_SECRET_ID)
    if (stored) {
      return { key: stored, source: 'db' }
    }
  } catch {
    return { key: null, source: 'none' }
  }

  return { key: null, source: 'none' }
}

export async function getOpenAIClient(prisma: PrismaClient): Promise<OpenAI> {
  const { key } = await getOpenAIKey(prisma)
  if (!key) {
    throw new Error('OpenAI API key not configured')
  }
  return new OpenAI({ apiKey: key })
}

export { OPENAI_SECRET_ID }
