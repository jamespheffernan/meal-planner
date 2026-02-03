import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

const ENCRYPTION_KEY_ENV = 'MEAL_PLANNER_ENCRYPTION_KEY'

export function isEncryptionReady(): boolean {
  const raw = process.env[ENCRYPTION_KEY_ENV]
  if (!raw) return false

  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex')
  } else {
    key = Buffer.from(raw, 'base64')
  }

  return key.length === 32
}

function getEncryptionKey(): Buffer {
  const raw = process.env[ENCRYPTION_KEY_ENV]
  if (!raw) {
    throw new Error(`${ENCRYPTION_KEY_ENV} not set`)
  }

  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex')
  } else {
    key = Buffer.from(raw, 'base64')
  }

  if (key.length !== 32) {
    throw new Error(`${ENCRYPTION_KEY_ENV} must be 32 bytes (hex or base64)`)
  }

  return key
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.')
}

function decrypt(payload: string): string {
  const key = getEncryptionKey()
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted payload')
  }
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString('utf8')
}

export async function storeSecret(prisma: PrismaClient, id: string, plaintext: string) {
  const encryptedValue = encrypt(plaintext)
  await prisma.appSecret.upsert({
    where: { id },
    update: { encryptedValue },
    create: { id, encryptedValue },
  })
}

export async function deleteSecret(prisma: PrismaClient, id: string) {
  await prisma.appSecret.delete({ where: { id } }).catch(() => undefined)
}

export async function getSecret(prisma: PrismaClient, id: string): Promise<string | null> {
  const record = await prisma.appSecret.findUnique({ where: { id } })
  if (!record) return null
  return decrypt(record.encryptedValue)
}

export async function hasSecret(prisma: PrismaClient, id: string): Promise<boolean> {
  const record = await prisma.appSecret.findUnique({ where: { id } })
  return Boolean(record)
}
