import { PrismaClient, type StoreProvider, type ProductPreferenceStatus } from '@prisma/client'
import yaml from 'js-yaml'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeProductName } from '../services/staples/detector.js'

type Args = {
  dir: string
  apply: boolean
}

function parseArgs(): Args {
  const dirIdx = process.argv.findIndex(a => a === '--dir')
  const dir = dirIdx !== -1 ? process.argv[dirIdx + 1] : '/Users/jamesheffernan/Documents/GitHub/Grocery Getter/.claude'
  const apply = process.argv.includes('--apply')
  return { dir, apply }
}

function extractFirstYamlBlock(markdown: string): any {
  const fence = '```yaml'
  const start = markdown.indexOf(fence)
  if (start === -1) return {}
  const after = markdown.slice(start + fence.length)
  const end = after.indexOf('```')
  if (end === -1) return {}
  const yamlText = after.slice(0, end).trim()
  const parsed = yaml.load(yamlText)
  return (parsed && typeof parsed === 'object') ? parsed : {}
}

function toProvider(storeRaw: string | undefined): StoreProvider {
  const s = (storeRaw || '').toLowerCase()
  if (s.includes('ocado')) return 'ocado'
  // Default for Grocery Getter MVP
  return 'ocado'
}

function toPreferenceStatus(statusRaw: any): ProductPreferenceStatus {
  const s = String(statusRaw || 'unknown').toLowerCase()
  if (s === 'trying') return 'trying'
  if (s === 'liked') return 'liked'
  if (s === 'staple') return 'staple'
  if (s === 'disliked') return 'disliked'
  return 'unknown'
}

async function main() {
  const { dir, apply } = parseArgs()
  const prisma = new PrismaClient()

  const householdPath = join(dir, 'household.md')
  const preferencesPath = join(dir, 'preferences.md')
  const historyPath = join(dir, 'history.md')

  const householdMd = await readFile(householdPath, 'utf8').catch(() => '')
  const preferencesMd = await readFile(preferencesPath, 'utf8').catch(() => '')
  const historyMd = await readFile(historyPath, 'utf8').catch(() => '')

  const household = extractFirstYamlBlock(householdMd) as any
  const preferences = extractFirstYamlBlock(preferencesMd) as any
  const history = extractFirstYamlBlock(historyMd) as any

  const staplesAlwaysHave: Array<any> = household?.staples?.always_have || []
  const products: Record<string, any> = preferences?.products || {}
  const orderHistory: Array<any> = history?.order_history || []

  const stapleRules = staplesAlwaysHave
    .map((s: any) => {
      const name = String(s?.name || '').trim()
      if (!name) return null
      const reorderAfterWeeks = Number(s?.reorder_after_weeks || 1)
      return {
        normalizedName: normalizeProductName(name),
        enabled: true,
        source: 'imported' as const,
        confidence: 1.0,
        reorderAfterDays: Math.max(3, Math.round(reorderAfterWeeks * 7)),
      }
    })
    .filter(Boolean) as Array<{ normalizedName: string; enabled: boolean; source: 'imported'; confidence: number; reorderAfterDays: number }>

  const productPreferences = Object.entries(products).map(([name, p]) => {
    const normalizedName = normalizeProductName(name)
    return {
      normalizedName,
      status: toPreferenceStatus(p?.status),
      typicalPrice: p?.typical_price ? Number(p.typical_price) : null,
      notes: p?.notes ? String(p.notes) : null,
      lastPurchasedAt: p?.last_purchased ? new Date(String(p.last_purchased)) : null,
      purchaseCount: p?.purchase_count ? Number(p.purchase_count) : 0,
    }
  })

  const purchaseOrders = orderHistory.map((o: any) => {
    const provider = toProvider(o?.store)
    const placedAt = o?.date ? new Date(String(o.date)) : new Date()
    const total = Number(o?.total || 0)
    const items: Array<any> = o?.items || []
    return {
      provider,
      placedAt,
      total,
      currency: 'GBP',
      status: 'delivered' as const,
      source: 'manual' as const,
      items: items.map((it: any) => {
        const rawName = String(it?.product_name || it?.name || '').trim()
        const quantity = Number(it?.quantity || 1)
        const price = Number(it?.price || 0)
        return {
          rawName,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          unit: it?.unit ? String(it.unit) : null,
          price: Number.isFinite(price) ? price : 0,
          lineTotal: Number.isFinite(price) ? price * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1) : null,
        }
      }).filter((x: any) => x.rawName),
    }
  }).filter((o: any) => o.total > 0 && o.items.length > 0)

  console.log('')
  console.log('Grocery Getter import (dry-run unless --apply)')
  console.log(`Source dir: ${dir}`)
  console.log(`Staples: ${stapleRules.length}`)
  console.log(`Product preferences: ${productPreferences.length}`)
  console.log(`Orders: ${purchaseOrders.length}`)
  console.log('')

  if (!apply) {
    await prisma.$disconnect()
    console.log('Dry run only. Re-run with --apply to write to the database.')
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const r of stapleRules) {
      // Upsert by (normalizedName, source=imported) without a unique constraint: best-effort find/update/create.
      const existing = await tx.stapleRule.findFirst({
        where: { normalizedName: r.normalizedName, source: 'imported' },
        orderBy: { updatedAt: 'desc' },
      })
      if (existing) {
        await tx.stapleRule.update({
          where: { id: existing.id },
          data: {
            enabled: true,
            confidence: r.confidence,
            reorderAfterDays: r.reorderAfterDays,
          },
        })
      } else {
        await tx.stapleRule.create({ data: r })
      }
    }

    for (const p of productPreferences) {
      const existing = await tx.storeProductPreference.findFirst({
        where: { normalizedName: p.normalizedName, storeProductId: null, ingredientId: null },
        orderBy: { updatedAt: 'desc' },
      })
      if (existing) {
        await tx.storeProductPreference.update({
          where: { id: existing.id },
          data: {
            status: p.status,
            typicalPrice: p.typicalPrice ?? undefined,
            notes: p.notes ?? undefined,
            lastPurchasedAt: p.lastPurchasedAt ?? undefined,
            purchaseCount: p.purchaseCount,
          },
        })
      } else {
        await tx.storeProductPreference.create({
          data: {
            normalizedName: p.normalizedName,
            status: p.status,
            typicalPrice: p.typicalPrice ?? undefined,
            notes: p.notes ?? undefined,
            lastPurchasedAt: p.lastPurchasedAt ?? undefined,
            purchaseCount: p.purchaseCount,
          },
        })
      }
    }

    for (const o of purchaseOrders) {
      const existing = await tx.purchaseOrder.findFirst({
        where: {
          provider: o.provider,
          placedAt: o.placedAt,
          total: o.total,
          source: 'manual',
        },
      })
      if (existing) continue

      await tx.purchaseOrder.create({
        data: {
          provider: o.provider,
          placedAt: o.placedAt,
          total: o.total,
          currency: o.currency,
          status: o.status,
          source: o.source,
          items: {
            create: o.items.map((it: any) => ({
              rawName: it.rawName,
              quantity: it.quantity,
              unit: it.unit,
              price: it.price,
              lineTotal: it.lineTotal,
            })),
          },
        },
      })
    }
  })

  await prisma.$disconnect()
  console.log('Import complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

