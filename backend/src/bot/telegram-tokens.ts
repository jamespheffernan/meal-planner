import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

type SessionState = {
  telegramTokens?: Record<string, any>
  pendingOrder?: {
    shoppingListId: string
    remainingIngredientIds: string[]
    createdAt: string
  } | null
  messages?: any[]
}

function randomToken(): string {
  return crypto.randomBytes(6).toString('base64url') // ~8 chars
}

export async function upsertTelegramSession(prisma: PrismaClient, chatId: string) {
  return prisma.assistantSession.upsert({
    where: { channel_externalId: { channel: 'telegram', externalId: chatId } },
    update: {},
    create: { channel: 'telegram', externalId: chatId, state: { messages: [] } },
  })
}

export async function putTelegramToken(prisma: PrismaClient, chatId: string, payload: any): Promise<string> {
  const session = await upsertTelegramSession(prisma, chatId)
  const state = (session.state || {}) as SessionState
  const tokens = { ...(state.telegramTokens || {}) }

  // Prune if needed.
  const keys = Object.keys(tokens)
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 200)) delete tokens[k]
  }

  const token = randomToken()
  tokens[token] = { payload, createdAt: new Date().toISOString() }

  await prisma.assistantSession.update({
    where: { id: session.id },
    data: { state: { ...state, telegramTokens: tokens } },
  })

  return token
}

export async function consumeTelegramToken(prisma: PrismaClient, chatId: string, token: string): Promise<any | null> {
  const session = await upsertTelegramSession(prisma, chatId)
  const state = (session.state || {}) as SessionState
  const tokens = { ...(state.telegramTokens || {}) }
  const entry = tokens[token]
  if (!entry) return null
  delete tokens[token]
  await prisma.assistantSession.update({
    where: { id: session.id },
    data: { state: { ...state, telegramTokens: tokens } },
  })
  return entry.payload
}

export async function setPendingOrder(prisma: PrismaClient, chatId: string, pending: SessionState['pendingOrder']) {
  const session = await upsertTelegramSession(prisma, chatId)
  const state = (session.state || {}) as SessionState
  await prisma.assistantSession.update({
    where: { id: session.id },
    data: { state: { ...state, pendingOrder: pending } },
  })
}

export async function getPendingOrder(prisma: PrismaClient, chatId: string): Promise<SessionState['pendingOrder']> {
  const session = await upsertTelegramSession(prisma, chatId)
  const state = (session.state || {}) as SessionState
  return state.pendingOrder || null
}

