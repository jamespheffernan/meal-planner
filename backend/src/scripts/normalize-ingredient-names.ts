import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'
import { normalizeIngredientName } from '../services/ingredient-normalizer.js'

type NormalizeIngredientNamesResult = {
  groups: number
  mergedDuplicates: number
  renamed: number
}

export async function normalizeIngredientNames(): Promise<NormalizeIngredientNamesResult> {
  const prisma = new PrismaClient()
  const ingredients = await prisma.ingredient.findMany()
  if (ingredients.length === 0) {
    console.log('No ingredients found.')
    await prisma.$disconnect()
    return { groups: 0, mergedDuplicates: 0, renamed: 0 }
  }

  const groups = new Map<string, typeof ingredients>()

  for (const ingredient of ingredients) {
    const normalized = normalizeIngredientName(ingredient.name)
    if (!groups.has(normalized)) {
      groups.set(normalized, [])
    }
    groups.get(normalized)!.push(ingredient)
  }

  console.log(`Found ${groups.size} normalized ingredient groups.`)

  const prefs = await prisma.userPreferences.findMany()
  let mergedDuplicates = 0
  let renamed = 0

  for (const [normalized, group] of groups) {
    if (!normalized) continue
    const [target, ...duplicates] = group

    if (duplicates.length > 0) {
      console.log(`Merging ${duplicates.length} duplicates into "${normalized}"`)
      mergedDuplicates += duplicates.length
    }

    for (const dup of duplicates) {
      await prisma.recipeIngredient.updateMany({
        where: { ingredientId: dup.id },
        data: { ingredientId: target.id },
      })
      await prisma.pantryInventory.updateMany({
        where: { ingredientId: dup.id },
        data: { ingredientId: target.id },
      })
      await prisma.shoppingListItem.updateMany({
        where: { ingredientId: dup.id },
        data: { ingredientId: target.id },
      })
      await prisma.brand.updateMany({
        where: { ingredientId: dup.id },
        data: { ingredientId: target.id },
      })

      for (const pref of prefs) {
        const liked = new Set(pref.likedIngredients || [])
        const disliked = new Set(pref.dislikedIngredients || [])
        let changed = false

        if (liked.has(dup.id)) {
          liked.delete(dup.id)
          liked.add(target.id)
          changed = true
        }
        if (disliked.has(dup.id)) {
          disliked.delete(dup.id)
          disliked.add(target.id)
          changed = true
        }

        if (changed) {
          await prisma.userPreferences.update({
            where: { id: pref.id },
            data: {
              likedIngredients: Array.from(liked),
              dislikedIngredients: Array.from(disliked),
            },
          })
        }
      }

      await prisma.ingredient.delete({ where: { id: dup.id } })
    }

    if (target.name !== normalized) {
      try {
        await prisma.ingredient.update({
          where: { id: target.id },
          data: { name: normalized },
        })
        renamed += 1
      } catch (error) {
        console.warn(`Failed to rename "${target.name}" -> "${normalized}":`, error)
      }
    }
  }

  console.log('Normalization complete.')
  await prisma.$disconnect()
  return { groups: groups.size, mergedDuplicates, renamed }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  normalizeIngredientNames()
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
