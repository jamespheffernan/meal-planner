import type { PrismaClient } from '@prisma/client'

export async function confirmOcadoMappings(prisma: PrismaClient, mappings: Array<{ ingredientId: string; storeProductId: string; isDefault?: boolean }>) {
  const now = new Date()

  const created = await prisma.$transaction(async (tx) => {
    const out = []
    for (const m of mappings) {
      const isDefault = m.isDefault ?? true
      if (isDefault) {
        await tx.ingredientStoreMapping.updateMany({
          where: { ingredientId: m.ingredientId, storeProduct: { provider: 'ocado' } },
          data: { isDefault: false },
        })
      }

      const mapping = await tx.ingredientStoreMapping.upsert({
        where: {
          ingredientId_storeProductId: {
            ingredientId: m.ingredientId,
            storeProductId: m.storeProductId,
          },
        },
        update: {
          isDefault,
          confidence: 1.0,
          lastConfirmedAt: now,
        },
        create: {
          ingredientId: m.ingredientId,
          storeProductId: m.storeProductId,
          isDefault,
          confidence: 1.0,
          lastConfirmedAt: now,
        },
      })
      out.push(mapping)
    }
    return out
  })

  return created
}

