import type { PrismaClient, StoreProvider } from '@prisma/client'
import { storeSecret, deleteSecret, hasSecret, getSecret, isEncryptionReady } from './secret-store.js'

export function storeSessionSecretId(provider: StoreProvider): string {
  return `store:${provider}:playwright_storage_state`
}

export async function getStoreSessionStatus(prisma: PrismaClient, provider: StoreProvider) {
  const hasSession = await hasSecret(prisma, storeSessionSecretId(provider))
  return { hasSession, encryptionReady: isEncryptionReady(), provider }
}

export async function setStoreSession(prisma: PrismaClient, provider: StoreProvider, storageStateJson: string) {
  await storeSecret(prisma, storeSessionSecretId(provider), storageStateJson)
  return { hasSession: true, provider }
}

export async function deleteStoreSession(prisma: PrismaClient, provider: StoreProvider) {
  await deleteSecret(prisma, storeSessionSecretId(provider))
  const hasSession = await hasSecret(prisma, storeSessionSecretId(provider))
  return { hasSession, provider }
}

export async function getStoreSessionStorageState(prisma: PrismaClient, provider: StoreProvider): Promise<any | null> {
  const raw = await getSecret(prisma, storeSessionSecretId(provider))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    // If the stored value is corrupted, treat it as missing.
    return null
  }
}

