import type { PrismaClient } from '@prisma/client'
import { storeSecret, getSecret, deleteSecret, hasSecret, isEncryptionReady } from './secret-store.js'

const RECIPE_AUTH_SECRET_PREFIX = 'recipe-auth-cookie:'

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase()
}

function getSecretId(hostname: string): string {
  return `${RECIPE_AUTH_SECRET_PREFIX}${normalizeHostname(hostname)}`
}

export async function setRecipeAuthCookie(prisma: PrismaClient, hostname: string, cookie: string) {
  const normalized = normalizeHostname(hostname)
  const trimmed = cookie.trim()
  if (!normalized) {
    throw new Error('hostname is required')
  }
  if (!trimmed) {
    throw new Error('cookie is required')
  }
  await storeSecret(prisma, getSecretId(normalized), trimmed)
}

export async function getRecipeAuthCookie(prisma: PrismaClient, hostname: string): Promise<string | null> {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return null
  return getSecret(prisma, getSecretId(normalized))
}

export async function hasRecipeAuthCookie(prisma: PrismaClient, hostname: string): Promise<boolean> {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return false
  return hasSecret(prisma, getSecretId(normalized))
}

export async function deleteRecipeAuthCookie(prisma: PrismaClient, hostname: string) {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return
  await deleteSecret(prisma, getSecretId(normalized))
}

export { isEncryptionReady }
