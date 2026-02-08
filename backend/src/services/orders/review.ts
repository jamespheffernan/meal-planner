import type { PrismaClient, UserOverride } from '@prisma/client'
import { OcadoAutomation } from '../stores/ocado/ocado-automation.js'

function shouldOrderItem(item: { assumedHave: boolean; userOverride: UserOverride | null; purchased?: boolean }): boolean {
  if (item.purchased) return false
  if (item.userOverride === 'have') return false
  if (item.userOverride === 'need') return true
  return !item.assumedHave
}

function desiredQtyForShoppingItem(shoppingItem: { unit: string; quantity: any }): number {
  const unit = String(shoppingItem.unit || '').toLowerCase()
  const q = Number(shoppingItem.quantity)
  if (unit === 'piece' || unit === 'pcs' || unit === 'pc') {
    return Math.max(1, Number.isFinite(q) ? Math.round(q) : 1)
  }
  return 1
}

function parseMinOrder(): number | null {
  const raw = String(process.env.OCADO_MIN_ORDER_TOTAL_GBP || '').trim()
  if (!raw) return null
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 ? v : null
}

export async function reviewOcadoShoppingListOrder(
  prisma: PrismaClient,
  shoppingListId: string,
  opts?: { quantityOverrides?: Record<string, number> }
) {
  const provider = 'ocado' as const
  const quantityOverrides = opts?.quantityOverrides || {}

  const list = await prisma.shoppingList.findUnique({
    where: { id: shoppingListId },
    include: {
      storeOverrides: {
        where: { provider },
        include: { storeProduct: true },
      },
      items: {
        include: {
          ingredient: {
            include: {
              ingredientStoreMappings: {
                where: {
                  isDefault: true,
                  storeProduct: { provider },
                },
                include: { storeProduct: true },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!list) return { ok: false as const, error: 'Shopping list not found' }

  const neededItems = list.items.filter(i => shouldOrderItem({
    assumedHave: i.assumedHave,
    userOverride: i.userOverride,
    purchased: i.purchased,
  }))

  const missingMappings: Array<{ itemId: string; ingredientId: string; ingredientName: string }> = []
  const intended: Array<{
    ingredientId: string
    ingredientName: string
    providerProductId: string
    desiredQuantity: number
  }> = []

  const overrideByIngredientId = new Map(
    (list.storeOverrides || []).map(o => [o.ingredientId, o])
  )

  for (const item of neededItems) {
    const override = overrideByIngredientId.get(item.ingredientId)
    const sp = override?.storeProduct || item.ingredient.ingredientStoreMappings?.[0]?.storeProduct
    if (!sp) {
      missingMappings.push({ itemId: item.id, ingredientId: item.ingredientId, ingredientName: item.ingredient.name })
      continue
    }
    const overrideQty = quantityOverrides[item.ingredientId]
    const desiredQuantity = overrideQty ? overrideQty : desiredQtyForShoppingItem(item as any)
    intended.push({
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient.name,
      providerProductId: sp.providerProductId,
      desiredQuantity,
    })
  }

  const ocado = new OcadoAutomation(prisma)
  let cartQtyByProductId: Record<string, number> = {}
  let cart: any = null

  await ocado.withPage({}, async ({ page }) => {
    cartQtyByProductId = await ocado.getCartQuantitiesByProductId(page).catch(() => ({} as Record<string, number>))
    cart = await ocado.viewCart(page).catch(() => null)
  })

  const willAdd: Array<{
    ingredientId: string
    ingredientName: string
    providerProductId: string
    desiredQuantity: number
    cartQuantity: number
    delta: number
  }> = []
  const alreadyInCart: Array<{
    ingredientId: string
    ingredientName: string
    providerProductId: string
    desiredQuantity: number
    cartQuantity: number
  }> = []

  for (const it of intended) {
    const cartQuantity = Number(cartQtyByProductId[it.providerProductId] || 0) || 0
    const delta = Math.max(0, it.desiredQuantity - cartQuantity)
    if (delta > 0) {
      willAdd.push({ ...it, cartQuantity, delta })
    } else {
      alreadyInCart.push({ ...it, cartQuantity })
    }
  }

  const minOrder = parseMinOrder()
  const cartTotal = cart?.total ?? null
  const minimum =
    minOrder && cartTotal !== null
      ? { threshold: minOrder, cartTotal, below: Number(cartTotal) < minOrder }
      : null

  return {
    ok: true as const,
    provider,
    shoppingListId: list.id,
    intendedCount: intended.length,
    willAdd,
    alreadyInCart,
    missingMappings,
    cart: cart || { currency: 'GBP', total: null, items: [] },
    minimum,
  }
}
