import type { PrismaClient, UserOverride } from '@prisma/client'
import { OcadoAutomation } from '../stores/ocado/ocado-automation.js'

function shouldOrderItem(item: { assumedHave: boolean; userOverride: UserOverride | null; purchased?: boolean }): boolean {
  if (item.purchased) return false
  if (item.userOverride === 'have') return false
  if (item.userOverride === 'need') return true
  return !item.assumedHave
}

export async function prepareOcadoOrderForShoppingList(prisma: PrismaClient, shoppingListId: string, opts?: { maxResultsPerItem?: number }) {
  const provider = 'ocado' as const
  const maxResultsPerItem = opts?.maxResultsPerItem || 5

  const list = await prisma.shoppingList.findUnique({
    where: { id: shoppingListId },
    include: {
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
                orderBy: { updatedAt: 'desc' },
                take: 1,
              },
            },
          },
          brand: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!list) {
    return { ok: false as const, error: 'Shopping list not found' }
  }

  const neededItems = list.items.filter(i => shouldOrderItem({
    assumedHave: i.assumedHave,
    userOverride: i.userOverride,
    purchased: i.purchased,
  }))

  const autoMapped: any[] = []
  const needsChoice: any[] = []

  const ocado = new OcadoAutomation(prisma)
  const now = new Date()

  await ocado.withPage({}, async ({ page }) => {
    for (const item of neededItems) {
      const existing = item.ingredient.ingredientStoreMappings?.[0]
      if (existing?.storeProduct) {
        autoMapped.push({
          itemId: item.id,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredient.name,
          storeProduct: {
            id: existing.storeProduct.id,
            provider: existing.storeProduct.provider,
            providerProductId: existing.storeProduct.providerProductId,
            name: existing.storeProduct.name,
            imageUrl: existing.storeProduct.imageUrl,
            productUrl: existing.storeProduct.productUrl,
            lastSeenPrice: existing.storeProduct.lastSeenPrice,
            currency: existing.storeProduct.currency,
          },
        })
        continue
      }

      const queryParts = [
        item.brand?.brandName?.trim(),
        item.ingredient.name.trim(),
      ].filter(Boolean)
      const query = queryParts.join(' ')

      const results = await ocado.searchProducts(page, query, maxResultsPerItem)
      const storedCandidates = []

      for (const r of results) {
        const record = await prisma.storeProduct.upsert({
          where: {
            provider_providerProductId: {
              provider,
              providerProductId: r.providerProductId,
            },
          },
          update: {
            name: r.name,
            imageUrl: r.imageUrl,
            productUrl: r.productUrl,
            lastSeenPrice: r.price !== null ? r.price : undefined,
            currency: r.currency,
            lastSeenAt: now,
          },
          create: {
            provider,
            providerProductId: r.providerProductId,
            name: r.name,
            imageUrl: r.imageUrl,
            productUrl: r.productUrl,
            lastSeenPrice: r.price !== null ? r.price : undefined,
            currency: r.currency,
            lastSeenAt: now,
          },
        })

        storedCandidates.push({
          storeProductId: record.id,
          providerProductId: r.providerProductId,
          name: r.name,
          price: r.price,
          currency: r.currency,
          imageUrl: r.imageUrl,
          productUrl: r.productUrl,
        })
      }

      needsChoice.push({
        itemId: item.id,
        ingredientId: item.ingredientId,
        ingredientName: item.ingredient.name,
        query,
        candidates: storedCandidates,
      })
    }
  })

  return {
    ok: true as const,
    provider,
    shoppingListId: list.id,
    autoMapped,
    needsChoice,
  }
}
