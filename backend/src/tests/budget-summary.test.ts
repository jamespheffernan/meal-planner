import { describe, it, expect } from 'vitest'
import { getBudgetSummary } from '../services/budget/summary.js'

// This file tests the pure behavior indirectly by using a minimal mock Prisma shape.

describe('Budget summary', () => {
  it('computes weekly buckets and confidence', async () => {
    const prisma: any = {
      purchaseOrder: {
        findMany: async () => ([
          { placedAt: new Date('2026-01-05T10:00:00Z'), total: 80 }, // week of Jan 5
          { placedAt: new Date('2026-01-06T10:00:00Z'), total: 20 }, // same week
          { placedAt: new Date('2026-01-12T10:00:00Z'), total: 100 }, // next week
          { placedAt: new Date('2026-01-19T10:00:00Z'), total: 120 }, // next week
          { placedAt: new Date('2026-01-26T10:00:00Z'), total: 90 }, // next week
        ]),
      },
    }

    const summary = await getBudgetSummary(prisma as any, 52)
    expect(summary.sampleSize).toBeGreaterThanOrEqual(3)
    expect(summary.typicalWeekly).toBeGreaterThan(0)
    expect(['low', 'medium', 'high']).toContain(summary.confidence)
    expect(summary.weeks.length).toBe(summary.sampleSize)
  })
})

