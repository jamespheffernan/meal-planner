import type { PrismaClient } from '@prisma/client'

export async function confirmOcadoMappings(
  prisma: PrismaClient,
  shoppingListId: string,
  mappings: Array<{ ingredientId: string; storeProductId: string; isDefault?: boolean }>
) {
  const now = new Date()

  const created = await prisma.$transaction(async (tx) => {
    const out = []
    for (const m of mappings) {
      const isDefault = m.isDefault ?? true

      if (isDefault) {
        // Global default forever.
        await tx.ingredientStoreMapping.updateMany({
          where: { ingredientId: m.ingredientId, storeProduct: { provider: 'ocado' } },
          data: { isDefault: false },
        })

        const mapping = await tx.ingredientStoreMapping.upsert({
          where: {
            ingredientId_storeProductId: {
              ingredientId: m.ingredientId,
              storeProductId: m.storeProductId,
            },
          },
          update: {
            isDefault: true,
            confidence: 1.0,
            lastConfirmedAt: now,
          },
          create: {
            ingredientId: m.ingredientId,
            storeProductId: m.storeProductId,
            isDefault: true,
            confidence: 1.0,
            lastConfirmedAt: now,
          },
        })

        // Ensure an old per-list override doesn't silently mask the newly-set default.
        await tx.shoppingListIngredientStoreOverride.delete({
          where: {
            shoppingListId_ingredientId_provider: {
              shoppingListId,
              ingredientId: m.ingredientId,
              provider: 'ocado',
            },
          },
        }).catch(() => undefined)

        out.push(mapping)
        continue
      }

      // Per-list override only (this order/list). Also record selection history in the ingredient mapping table
      // without changing the global default.
      const override = await tx.shoppingListIngredientStoreOverride.upsert({
        where: {
          shoppingListId_ingredientId_provider: {
            shoppingListId,
            ingredientId: m.ingredientId,
            provider: 'ocado',
          },
        },
        update: {
          storeProductId: m.storeProductId,
          lastConfirmedAt: now,
        },
        create: {
          shoppingListId,
          ingredientId: m.ingredientId,
          provider: 'ocado',
          storeProductId: m.storeProductId,
          lastConfirmedAt: now,
        },
      })

      // Selection history (helps ranking in future searches).
      await tx.ingredientStoreMapping.upsert({
        where: {
          ingredientId_storeProductId: {
            ingredientId: m.ingredientId,
            storeProductId: m.storeProductId,
          },
        },
        update: {
          isDefault: false,
          confidence: 1.0,
          lastConfirmedAt: now,
        },
        create: {
          ingredientId: m.ingredientId,
          storeProductId: m.storeProductId,
          isDefault: false,
          confidence: 1.0,
          lastConfirmedAt: now,
        },
      })

      out.push(override)
    }
    return out
  })

  return created
}

export async function setOcadoDefaultIngredientMapping(
  prisma: PrismaClient,
  ingredientId: string,
  storeProductId: string | null
) {
  const now = new Date()
  if (!storeProductId) {
    await prisma.ingredientStoreMapping.updateMany({
      where: { ingredientId, storeProduct: { provider: 'ocado' }, isDefault: true },
      data: { isDefault: false },
    })
    return { ok: true as const }
  }

  await prisma.$transaction(async (tx) => {
    await tx.ingredientStoreMapping.updateMany({
      where: { ingredientId, storeProduct: { provider: 'ocado' } },
      data: { isDefault: false },
    })
    await tx.ingredientStoreMapping.upsert({
      where: { ingredientId_storeProductId: { ingredientId, storeProductId } },
      update: { isDefault: true, confidence: 1.0, lastConfirmedAt: now },
      create: { ingredientId, storeProductId, isDefault: true, confidence: 1.0, lastConfirmedAt: now },
    })
  })

  return { ok: true as const }
}

export async function setOcadoShoppingListOverride(
  prisma: PrismaClient,
  shoppingListId: string,
  ingredientId: string,
  storeProductId: string | null
) {
  const now = new Date()
  if (!storeProductId) {
    await prisma.shoppingListIngredientStoreOverride.delete({
      where: { shoppingListId_ingredientId_provider: { shoppingListId, ingredientId, provider: 'ocado' } },
    }).catch(() => undefined)
    return { ok: true as const }
  }

  await prisma.shoppingListIngredientStoreOverride.upsert({
    where: { shoppingListId_ingredientId_provider: { shoppingListId, ingredientId, provider: 'ocado' } },
    update: { storeProductId, lastConfirmedAt: now },
    create: { shoppingListId, ingredientId, provider: 'ocado', storeProductId, lastConfirmedAt: now },
  })

  // Also record selection history without changing default.
  await prisma.ingredientStoreMapping.upsert({
    where: { ingredientId_storeProductId: { ingredientId, storeProductId } },
    update: { isDefault: false, confidence: 1.0, lastConfirmedAt: now },
    create: { ingredientId, storeProductId, isDefault: false, confidence: 1.0, lastConfirmedAt: now },
  })

  return { ok: true as const }
}
