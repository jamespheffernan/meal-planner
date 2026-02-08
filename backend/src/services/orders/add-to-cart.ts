import type { PrismaClient, UserOverride } from '@prisma/client'
import { OcadoAutomation } from '../stores/ocado/ocado-automation.js'

function shouldOrderItem(item: { assumedHave: boolean; userOverride: UserOverride | null; purchased?: boolean }): boolean {
  if (item.purchased) return false
  if (item.userOverride === 'have') return false
  if (item.userOverride === 'need') return true
  return !item.assumedHave
}

export async function addOcadoShoppingListToCart(
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

  const qtyFor = (shoppingItem: { unit: string; quantity: any }) => {
    const unit = String(shoppingItem.unit || '').toLowerCase()
    const q = Number(shoppingItem.quantity)
    if (unit === 'piece' || unit === 'pcs' || unit === 'pc') {
      return Math.max(1, Number.isFinite(q) ? Math.round(q) : 1)
    }
    return 1
  }

  const ocado = new OcadoAutomation(prisma)
  const added: Array<{ ingredientId: string; ingredientName: string; providerProductId: string; quantity: number }> = []
  const skippedAlreadyInCart: Array<{ ingredientId: string; ingredientName: string; providerProductId: string; desiredQuantity: number; cartQuantity: number }> = []
  const missingMappings: Array<{ itemId: string; ingredientId: string; ingredientName: string }> = []
  let cart: any = null
  let purchaseOrderId: string | null = null

  const overrideByIngredientId = new Map(
    (list.storeOverrides || []).map(o => [o.ingredientId, o])
  )

  await ocado.withPage({ headless: true }, async ({ page }) => {
    // Idempotency: read cart quantities once and only add deltas (never decrease).
    const cartQtyByProductId = await ocado.getCartQuantitiesByProductId(page).catch(() => ({} as Record<string, number>))

    for (const item of neededItems) {
      const override = overrideByIngredientId.get(item.ingredientId)
      const sp = override?.storeProduct || item.ingredient.ingredientStoreMappings?.[0]?.storeProduct
      if (!sp) {
        missingMappings.push({ itemId: item.id, ingredientId: item.ingredientId, ingredientName: item.ingredient.name })
        continue
      }
      const overrideQty = quantityOverrides[item.ingredientId]
      const desiredQuantity = overrideQty ? overrideQty : qtyFor(item as any)

      const currentInCart = Number(cartQtyByProductId[sp.providerProductId] || 0) || 0
      const delta = Math.max(0, desiredQuantity - currentInCart)
      if (delta <= 0) {
        skippedAlreadyInCart.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredient.name,
          providerProductId: sp.providerProductId,
          desiredQuantity,
          cartQuantity: currentInCart,
        })
        continue
      }

      await ocado.addToCart(page, sp.providerProductId, delta)
      cartQtyByProductId[sp.providerProductId] = currentInCart + delta
      added.push({ ingredientId: item.ingredientId, ingredientName: item.ingredient.name, providerProductId: sp.providerProductId, quantity: desiredQuantity })
    }

    cart = await ocado.viewCart(page)
  })

  // Persist a PurchaseOrder snapshot (best-effort). Ocado sometimes hides totals; compute what we can.
  if (cart) {
    const computedTotal =
      cart.total !== null && cart.total !== undefined
        ? Number(cart.total)
        : (Array.isArray(cart.items) ? cart.items.reduce((acc: number, it: any) => acc + (Number(it?.lineTotal) || 0), 0) : 0)

    const storeProducts = await prisma.storeProduct.findMany({
      where: { provider: 'ocado', providerProductId: { in: added.map(a => a.providerProductId) } },
    })
    const byProviderId = new Map(storeProducts.map(sp => [sp.providerProductId, sp]))

    // Update latest pending order for this list if exists, else create a new pending order.
    // IMPORTANT: once an order is approved/placed/etc, we do not mutate it (strict lifecycle).
    const existing = await prisma.purchaseOrder.findFirst({
      where: { shoppingListId, provider: 'ocado', status: 'pending', source: 'from_shopping_list' },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      const updated = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          total: computedTotal,
          status: 'pending',
          items: {
            deleteMany: {},
            create: added.map(a => {
              const sp = byProviderId.get(a.providerProductId)
              const price = sp?.lastSeenPrice ? Number(sp.lastSeenPrice) : 0
              return {
                ingredientId: a.ingredientId,
                storeProductId: sp?.id || null,
                rawName: sp?.name || a.ingredientName,
                quantity: a.quantity,
                unit: null,
                price,
                lineTotal: price ? price * a.quantity : null,
              }
            }),
          },
        },
      })
      purchaseOrderId = updated.id
    } else {
      const created = await prisma.purchaseOrder.create({
        data: {
          provider: 'ocado',
          placedAt: null,
          total: computedTotal,
          currency: cart.currency || 'GBP',
          status: 'pending',
          source: 'from_shopping_list',
          shoppingListId: list.id,
          items: {
            create: added.map(a => {
              const sp = byProviderId.get(a.providerProductId)
              const price = sp?.lastSeenPrice ? Number(sp.lastSeenPrice) : 0
              return {
                ingredientId: a.ingredientId,
                storeProductId: sp?.id || null,
                rawName: sp?.name || a.ingredientName,
                quantity: a.quantity,
                unit: null,
                price,
                lineTotal: price ? price * a.quantity : null,
              }
            }),
          },
        },
      })
      purchaseOrderId = created.id
    }
  }

  return {
    ok: true as const,
    provider,
    shoppingListId: list.id,
    purchaseOrderId,
    added,
    skippedAlreadyInCart,
    missingMappings,
    cart,
  }
}
