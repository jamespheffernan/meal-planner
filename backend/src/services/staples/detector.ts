import type { PrismaClient, StapleSource } from '@prisma/client'

export type StapleSuggestion = {
  normalizedName: string
  purchaseCount: number
  avgIntervalDays: number
  varianceRatio: number
  confidence: 'high' | 'medium' | 'low'
  reorderAfterDays: number
  lastPurchasedAt: Date | null
}

// Very lightweight normalizer to group variants.
// (We can refine this as we ingest real order history.)
export function normalizeProductName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(organic|free range|barista|skimmed|semi-skimmed|whole)\b/g, ' ')
    .replace(/\bx\s*\d+\b/g, ' ')
    .replace(/\b(\d+(?:\.\d+)?)(ml|l|g|kg|pack|packs|x)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mean(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / (nums.length || 1)
}

function stddev(nums: number[]): number {
  if (nums.length < 2) return 0
  const m = mean(nums)
  const v = mean(nums.map(n => (n - m) ** 2))
  return Math.sqrt(v)
}

export async function detectStaplesFromOrders(prisma: PrismaClient, opts?: { weeks?: number; source?: StapleSource }) {
  const weeks = opts?.weeks ?? 12
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - weeks * 7)

  const items = await prisma.purchaseOrderItem.findMany({
    where: {
      purchaseOrder: {
        status: { in: ['placed', 'delivered'] },
        OR: [
          { deliveredAt: { gte: cutoff } },
          { placedAt: { gte: cutoff } },
          { createdAt: { gte: cutoff } },
        ],
      },
    },
    include: {
      purchaseOrder: true,
      storeProduct: true,
    },
    orderBy: { purchaseOrder: { createdAt: 'asc' } },
  })

  // Group by normalized name, using store product name if present.
  const groups = new Map<string, Date[]>()
  for (const it of items) {
    const name = it.storeProduct?.name || it.rawName
    const key = normalizeProductName(name)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    const date = (it.purchaseOrder.deliveredAt || it.purchaseOrder.placedAt || it.purchaseOrder.createdAt) as Date
    groups.get(key)!.push(new Date(date))
  }

  const suggestions: StapleSuggestion[] = []
  for (const [key, dates] of groups) {
    const uniqueDates = Array.from(new Set(dates.map(d => d.toISOString().slice(0, 10))))
      .map(s => new Date(s))
      .sort((a, b) => a.getTime() - b.getTime())

    const purchaseCount = uniqueDates.length
    if (purchaseCount < 3) continue

    const intervals: number[] = []
    for (let i = 1; i < uniqueDates.length; i++) {
      intervals.push(Math.max(1, Math.round((uniqueDates[i].getTime() - uniqueDates[i - 1].getTime()) / (1000 * 60 * 60 * 24))))
    }

    const avg = intervals.length ? mean(intervals) : 7
    const sd = stddev(intervals)
    const varianceRatio = avg > 0 ? sd / avg : 1

    let confidence: 'high' | 'medium' | 'low' = 'low'
    if (purchaseCount >= 4 && varianceRatio < 0.3) confidence = 'high'
    else if (purchaseCount >= 3 && varianceRatio < 0.5) confidence = 'medium'

    const reorderAfterDays = Math.max(3, Math.min(28, Math.round(avg)))
    const lastPurchasedAt = uniqueDates[uniqueDates.length - 1] || null

    suggestions.push({
      normalizedName: key,
      purchaseCount,
      avgIntervalDays: Math.round(avg * 10) / 10,
      varianceRatio: Math.round(varianceRatio * 100) / 100,
      confidence,
      reorderAfterDays,
      lastPurchasedAt,
    })
  }

  suggestions.sort((a, b) => b.purchaseCount - a.purchaseCount)

  return suggestions
}
