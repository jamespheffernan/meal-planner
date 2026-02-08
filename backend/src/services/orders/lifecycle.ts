import type { Prisma, PurchaseOrder, PurchaseOrderStatus } from '@prisma/client'

const allowed: Record<PurchaseOrderStatus, ReadonlyArray<PurchaseOrderStatus>> = {
  pending: ['approved', 'cancelled'],
  approved: ['placed', 'cancelled'],
  placed: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export function isTerminalStatus(status: PurchaseOrderStatus): boolean {
  return status === 'delivered' || status === 'cancelled'
}

export function canTransitionPurchaseOrderStatus(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  if (from === to) return true
  return allowed[from].includes(to)
}

export function assertPurchaseOrderStatusTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
  if (!canTransitionPurchaseOrderStatus(from, to)) {
    throw new Error(`Invalid status transition: ${from} -> ${to}`)
  }
}

export function transitionPurchaseOrderUpdateData(
  order: Pick<PurchaseOrder, 'status' | 'approvedAt' | 'placedAt' | 'deliveredAt' | 'cancelledAt'>,
  to: PurchaseOrderStatus,
  now = new Date()
): Prisma.PurchaseOrderUpdateInput {
  const from = order.status
  assertPurchaseOrderStatusTransition(from, to)

  if (from === to) return {} satisfies Prisma.PurchaseOrderUpdateInput

  const data: Prisma.PurchaseOrderUpdateInput = { status: to }

  // Only set timestamps if not already present, so imports/manual edits don't get stomped.
  if (to === 'approved' && !order.approvedAt) data.approvedAt = now
  if (to === 'placed' && !order.placedAt) data.placedAt = now
  if (to === 'delivered' && !order.deliveredAt) data.deliveredAt = now
  if (to === 'cancelled' && !order.cancelledAt) data.cancelledAt = now

  return data
}

