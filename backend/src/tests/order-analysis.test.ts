import { describe, it, expect } from 'vitest'
import { analyzePurchaseOrder } from '../services/orders/analyze.js'

describe('Order analysis', () => {
  it('flags disliked items and auto-approves mapped unknown items', async () => {
    const prisma: any = {
      purchaseOrder: {
        findUnique: async () => ({
          id: 'po1',
          total: 120,
          items: [
            {
              id: 'it1',
              ingredientId: 'ing1',
              storeProductId: 'sp1',
              rawName: 'Milk',
              quantity: 1,
              price: 2.2,
              ingredient: { id: 'ing1', name: 'Milk' },
              storeProduct: { id: 'sp1', name: 'Milk 2L' },
            },
            {
              id: 'it2',
              ingredientId: 'ing2',
              storeProductId: 'sp2',
              rawName: 'Peanuts',
              quantity: 1,
              price: 3.0,
              ingredient: { id: 'ing2', name: 'Peanuts' },
              storeProduct: { id: 'sp2', name: 'Peanuts' },
            },
            {
              id: 'it3',
              ingredientId: null,
              storeProductId: 'sp3',
              rawName: 'Some snack',
              quantity: 1,
              price: 1.5,
              ingredient: null,
              storeProduct: { id: 'sp3', name: 'Some snack' },
            },
          ],
        }),
        findMany: async () => ([]),
      },
      userPreferences: {
        findFirst: async () => ({
          budgetTargetWeekly: 100,
          dislikedIngredients: ['ing2'],
        }),
      },
      storeProductPreference: {
        findFirst: async (args: any) => {
          // Provide a preference only for sp3: typical price 1.0 and disliked status.
          if (args?.where?.storeProductId === 'sp3') {
            return {
              id: 'pref1',
              status: 'disliked',
              typicalPrice: 1.0,
              purchaseCount: 2,
            }
          }
          return null
        },
      },
    }

    const res = await analyzePurchaseOrder(prisma as any, 'po1')
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.budget.severity).toBe('notify') // 120 vs 100
    expect(res.approvals.autoApproved.length).toBe(1)
    expect(res.approvals.needsApproval.length).toBe(2)

    const needs = res.approvals.needsApproval.map(x => ({ id: x.purchaseOrderItemId, reasons: x.reasons }))
    expect(needs.find(x => x.id === 'it2')?.reasons).toContain('disliked_ingredient')
    expect(needs.find(x => x.id === 'it3')?.reasons).toContain('disliked_product')
  })
})

