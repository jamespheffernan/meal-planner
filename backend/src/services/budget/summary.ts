import type { PrismaClient } from '@prisma/client'

function startOfWeek(date: Date): Date {
  // Monday as start (UK/Europe default), stable for "weekly shop" behavior.
  const d = new Date(date)
  const day = d.getDay() // 0=Sun
  const delta = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + delta)
  d.setHours(0, 0, 0, 0)
  return d
}

export async function getBudgetSummary(prisma: PrismaClient, weeks = 8) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - weeks * 7)

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['placed', 'delivered'] },
      OR: [
        { deliveredAt: { gte: cutoff } },
        { placedAt: { gte: cutoff } },
        // Back-compat / safety: if timestamps are missing but status is terminal, include by createdAt.
        { createdAt: { gte: cutoff } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })

  if (orders.length === 0) {
    return {
      typicalWeekly: 0,
      minWeekly: 0,
      maxWeekly: 0,
      sampleSize: 0,
      confidence: 'low' as const,
      weeks: [],
    }
  }

  const buckets = new Map<string, number>()
  for (const o of orders) {
    const date = (o.deliveredAt || o.placedAt || o.createdAt) as Date
    const key = startOfWeek(new Date(date)).toISOString().slice(0, 10)
    const current = buckets.get(key) || 0
    buckets.set(key, current + Number(o.total))
  }

  const weeklyTotals = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, total]) => ({ weekStart, total }))

  const totals = weeklyTotals.map(w => w.total)
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length
  const min = Math.min(...totals)
  const max = Math.max(...totals)

  const confidence =
    totals.length >= 4 ? 'high' :
    totals.length >= 2 ? 'medium' :
    'low'

  return {
    typicalWeekly: mean,
    minWeekly: min,
    maxWeekly: max,
    sampleSize: totals.length,
    confidence,
    weeks: weeklyTotals,
  }
}
