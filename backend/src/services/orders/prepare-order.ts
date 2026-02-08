import type { PrismaClient, UserOverride } from '@prisma/client'
import { OcadoAutomation } from '../stores/ocado/ocado-automation.js'

function shouldOrderItem(item: { assumedHave: boolean; userOverride: UserOverride | null; purchased?: boolean }): boolean {
  if (item.purchased) return false
  if (item.userOverride === 'have') return false
  if (item.userOverride === 'need') return true
  return !item.assumedHave
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

function rankOcadoCandidates(input: {
  candidates: Array<{ storeProductId: string; name: string; price: number | null }>
  preferredBrandName?: string | null
  defaultStoreProductId?: string | null
  previouslySelectedStoreProductIds?: Set<string>
}) {
  const brand = input.preferredBrandName ? normalize(input.preferredBrandName) : null
  const previously = input.previouslySelectedStoreProductIds || new Set<string>()
  const defaultId = input.defaultStoreProductId || null

  const scored = input.candidates.map((c) => {
    let score = 0
    const name = normalize(c.name)
    if (brand && name.includes(brand)) score += 100
    if (defaultId && c.storeProductId === defaultId) score += 80
    if (previously.has(c.storeProductId)) score += 50
    if (c.price !== null && Number.isFinite(c.price)) {
      score += 10
      score += Math.max(-50, -c.price)
    } else {
      score -= 5
    }
    return { c, score }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.c.name.localeCompare(b.c.name)
  })

  return scored.map(s => s.c)
}

export async function prepareOcadoOrderForShoppingList(prisma: PrismaClient, shoppingListId: string, opts?: { maxResultsPerItem?: number }) {
  const provider = 'ocado' as const
  const maxResultsPerItem = opts?.maxResultsPerItem || 5

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
                  storeProduct: { provider },
                },
                include: { storeProduct: true },
                orderBy: [
                  { isDefault: 'desc' },
                  { lastConfirmedAt: 'desc' },
                  { updatedAt: 'desc' },
                ],
                take: 10,
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

  const overrideByIngredientId = new Map(
    (list.storeOverrides || []).map(o => [o.ingredientId, o])
  )

  await ocado.withPage({ headless: true }, async ({ page }) => {
    for (const item of neededItems) {
      const override = overrideByIngredientId.get(item.ingredientId)
      if (override?.storeProduct) {
        autoMapped.push({
          itemId: item.id,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredient.name,
          mappingSource: 'this_list',
          storeProduct: {
            id: override.storeProduct.id,
            provider: override.storeProduct.provider,
            providerProductId: override.storeProduct.providerProductId,
            name: override.storeProduct.name,
            imageUrl: override.storeProduct.imageUrl,
            productUrl: override.storeProduct.productUrl,
            lastSeenPrice: override.storeProduct.lastSeenPrice,
            currency: override.storeProduct.currency,
          },
        })
        continue
      }

      const defaultMapping = (item.ingredient.ingredientStoreMappings || []).find(m => m.isDefault && m.storeProduct?.provider === provider)
      if (defaultMapping?.storeProduct) {
        autoMapped.push({
          itemId: item.id,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredient.name,
          mappingSource: 'default',
          storeProduct: {
            id: defaultMapping.storeProduct.id,
            provider: defaultMapping.storeProduct.provider,
            providerProductId: defaultMapping.storeProduct.providerProductId,
            name: defaultMapping.storeProduct.name,
            imageUrl: defaultMapping.storeProduct.imageUrl,
            productUrl: defaultMapping.storeProduct.productUrl,
            lastSeenPrice: defaultMapping.storeProduct.lastSeenPrice,
            currency: defaultMapping.storeProduct.currency,
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

      const previouslySelectedIds = new Set(
        (item.ingredient.ingredientStoreMappings || [])
          .filter(m => m.storeProduct?.provider === provider)
          .map(m => m.storeProductId)
      )

      const ranked = rankOcadoCandidates({
        candidates: storedCandidates.map(c => ({ storeProductId: c.storeProductId, name: c.name, price: c.price })),
        preferredBrandName: item.brand?.brandName || null,
        defaultStoreProductId: defaultMapping?.storeProductId || null,
        previouslySelectedStoreProductIds: previouslySelectedIds,
      })
      const rankedById = new Map(ranked.map((c, idx) => [c.storeProductId, idx]))
      storedCandidates.sort((a, b) => (rankedById.get(a.storeProductId) ?? 999) - (rankedById.get(b.storeProductId) ?? 999))

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
