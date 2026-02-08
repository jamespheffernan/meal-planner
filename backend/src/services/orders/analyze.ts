import type { PrismaClient, ProductPreferenceStatus } from '@prisma/client'
import { getBudgetSummary } from '../budget/summary.js'
import { normalizeProductName } from '../staples/detector.js'

export type BudgetSeverity = 'ok' | 'notify' | 'confirm' | 'review' | 'unknown'

export type BudgetAnalysis = {
  baselineType: 'target' | 'typical' | 'none'
  baselineWeekly: number | null
  orderTotal: number
  delta: number | null
  deltaPct: number | null
  severity: BudgetSeverity
}

export type ApprovalReason =
  | 'disliked_ingredient'
  | 'disliked_product'
  | 'price_increase'
  | 'unknown_item'
  | 'trying_item'

export type ApprovalItem = {
  purchaseOrderItemId: string
  ingredientId: string | null
  ingredientName: string | null
  storeProductId: string | null
  storeProductName: string | null
  rawName: string
  quantity: number
  price: number
  preferenceStatus: ProductPreferenceStatus
  typicalPrice: number | null
  reasons: ApprovalReason[]
}

export type ApprovalAnalysis = {
  autoApproved: ApprovalItem[]
  needsApproval: ApprovalItem[]
}

function severityFromPct(deltaPct: number): Exclude<BudgetSeverity, 'unknown'> {
  // Defaults tuned for "weekly shop": small overage is fine, big overage demands review.
  if (deltaPct <= 0.10) return 'ok'
  if (deltaPct <= 0.20) return 'notify'
  if (deltaPct <= 0.35) return 'confirm'
  return 'review'
}

async function getPreferenceForOrderItem(
  prisma: PrismaClient,
  it: { storeProductId: string | null; ingredientId: string | null; rawName: string }
) {
  if (it.storeProductId) {
    const p = await prisma.storeProductPreference.findFirst({
      where: { storeProductId: it.storeProductId },
      orderBy: { updatedAt: 'desc' },
    })
    if (p) return p
  }
  if (it.ingredientId) {
    const p = await prisma.storeProductPreference.findFirst({
      where: { ingredientId: it.ingredientId },
      orderBy: { updatedAt: 'desc' },
    })
    if (p) return p
  }
  const normalizedName = normalizeProductName(it.rawName)
  if (normalizedName) {
    const p = await prisma.storeProductPreference.findFirst({
      where: { normalizedName, storeProductId: null, ingredientId: null },
      orderBy: { updatedAt: 'desc' },
    })
    if (p) return p
  }
  return null
}

export async function analyzePurchaseOrder(prisma: PrismaClient, purchaseOrderId: string) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      items: { include: { ingredient: true, storeProduct: true }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!order) return { ok: false as const, error: 'Order not found' }

  const prefs = await prisma.userPreferences.findFirst()
  const targetWeekly = prefs?.budgetTargetWeekly ? Number(prefs.budgetTargetWeekly) : null
  const typical = await getBudgetSummary(prisma, 8)
  const typicalWeekly = typical.sampleSize >= 2 ? Number(typical.typicalWeekly) : null

  const baselineWeekly = targetWeekly ?? typicalWeekly
  const baselineType: BudgetAnalysis['baselineType'] =
    baselineWeekly === null ? 'none' : (targetWeekly !== null ? 'target' : 'typical')

  const orderTotal = Number(order.total)
  let delta: number | null = null
  let deltaPct: number | null = null
  let severity: BudgetSeverity = 'unknown'
  if (baselineWeekly !== null && baselineWeekly > 0) {
    delta = orderTotal - baselineWeekly
    deltaPct = delta / baselineWeekly
    severity = severityFromPct(deltaPct)
  }

  const budget: BudgetAnalysis = {
    baselineType,
    baselineWeekly,
    orderTotal,
    delta,
    deltaPct,
    severity,
  }

  const dislikedIds = new Set<string>(prefs?.dislikedIngredients || [])
  const itemsWithPrefs = await Promise.all(order.items.map(async (it) => {
    const pref = await getPreferenceForOrderItem(prisma, {
      storeProductId: it.storeProductId || null,
      ingredientId: it.ingredientId || null,
      rawName: it.rawName,
    })
    return { it, pref }
  }))

  const autoApproved: ApprovalItem[] = []
  const needsApproval: ApprovalItem[] = []

  for (const { it, pref } of itemsWithPrefs) {
    const preferenceStatus = (pref?.status || 'unknown') as ProductPreferenceStatus
    const typicalPrice = pref?.typicalPrice !== null && pref?.typicalPrice !== undefined ? Number(pref.typicalPrice) : null
    const price = Number(it.price)
    const reasons: ApprovalReason[] = []

    const ingredientId = it.ingredientId || null
    const storeProductId = it.storeProductId || null
    const ingredientName = it.ingredient?.name || null
    const storeProductName = it.storeProduct?.name || null

    if (ingredientId && dislikedIds.has(ingredientId)) {
      reasons.push('disliked_ingredient')
    }
    if (preferenceStatus === 'disliked') {
      reasons.push('disliked_product')
    }
    if (preferenceStatus === 'trying') {
      reasons.push('trying_item')
    }
    if (typicalPrice !== null && typicalPrice > 0) {
      const pct = (price - typicalPrice) / typicalPrice
      if (pct > 0.30) reasons.push('price_increase')
    }

    // Default: auto-approve things the user has explicitly mapped before (ingredient+storeProduct present)
    // unless a hard-stop reason exists.
    const isMapped = Boolean(ingredientId && storeProductId)

    const approvalItem: ApprovalItem = {
      purchaseOrderItemId: it.id,
      ingredientId,
      ingredientName,
      storeProductId,
      storeProductName,
      rawName: it.rawName,
      quantity: it.quantity,
      price,
      preferenceStatus,
      typicalPrice,
      reasons,
    }

    const hardStop = reasons.includes('disliked_ingredient') || reasons.includes('disliked_product')
    if (hardStop) {
      needsApproval.push(approvalItem)
      continue
    }

    if (preferenceStatus === 'liked' || preferenceStatus === 'staple') {
      autoApproved.push(approvalItem)
      continue
    }

    if (preferenceStatus === 'trying') {
      // If it's already been purchased before and isn't wildly more expensive, auto-approve.
      if ((pref?.purchaseCount || 0) > 0 && !reasons.includes('price_increase')) {
        autoApproved.push(approvalItem)
      } else {
        needsApproval.push(approvalItem)
      }
      continue
    }

    // Unknown preference: mapped items are implicitly "acceptable" (unless price spike), otherwise request review.
    if (isMapped && !reasons.includes('price_increase')) {
      autoApproved.push(approvalItem)
      continue
    }

    reasons.push('unknown_item')
    needsApproval.push(approvalItem)
  }

  const approvals: ApprovalAnalysis = { autoApproved, needsApproval }

  return { ok: true as const, budget, approvals }
}

