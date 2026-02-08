import type { PrismaClient, PurchaseOrderStatus } from '@prisma/client'
import { normalizeProductName } from '../staples/detector.js'

function ema(oldV: number, newV: number, alpha: number): number {
  return oldV * (1 - alpha) + newV * alpha
}

export async function applyOrderLearning(
  prisma: PrismaClient,
  purchaseOrderId: string,
  status: PurchaseOrderStatus
) {
  // Only learn from terminal-ish statuses.
  if (status !== 'placed' && status !== 'delivered') return

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { items: { include: { ingredient: true, storeProduct: true } } },
  })
  if (!order) return

  const at = (order.deliveredAt || order.placedAt || new Date()) as Date

  for (const it of order.items) {
    const storeProductId = it.storeProductId || null
    const ingredientId = it.ingredientId || null
    const normalizedName = normalizeProductName(it.storeProduct?.name || it.ingredient?.name || it.rawName)

    const where = storeProductId
      ? { storeProductId }
      : ingredientId
        ? { ingredientId }
        : { normalizedName, storeProductId: null as any, ingredientId: null as any }

    const existing = await prisma.storeProductPreference.findFirst({
      where: where as any,
      orderBy: { updatedAt: 'desc' },
    })

    const price = Number(it.price)

    if (existing) {
      await prisma.storeProductPreference.update({
        where: { id: existing.id },
        data: {
          lastPurchasedAt: at,
          purchaseCount: existing.purchaseCount + 1,
          typicalPrice:
            price > 0
              ? (existing.typicalPrice ? ema(Number(existing.typicalPrice), price, 0.3) : price)
              : undefined,
        },
      }).catch(() => undefined)
    } else {
      await prisma.storeProductPreference.create({
        data: {
          storeProductId,
          ingredientId,
          normalizedName,
          status: 'unknown',
          lastPurchasedAt: at,
          purchaseCount: 1,
          typicalPrice: price > 0 ? price : undefined,
        },
      }).catch(() => undefined)
    }

    // Update any matching staple rules so "due" logic stays accurate.
    await prisma.stapleRule.updateMany({
      where: {
        OR: [
          ...(ingredientId ? [{ ingredientId }] : []),
          ...(storeProductId ? [{ storeProductId }] : []),
          { normalizedName },
        ],
      },
      data: { lastPurchasedAt: at },
    }).catch(() => undefined)
  }
}

