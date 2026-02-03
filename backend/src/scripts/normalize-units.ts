/**
 * Data migration script: normalize all units in existing DB rows.
 *
 * Usage:
 *   npx tsx src/scripts/normalize-units.ts           # dry-run (default)
 *   npx tsx src/scripts/normalize-units.ts --apply    # commit changes
 */

import { PrismaClient } from '@prisma/client'
import { canonicalizeUnit, type CanonicalUnit } from '../services/units.js'
import { parseIngredientString } from '../services/ingredient-parser.js'

const prisma = new PrismaClient()
const BATCH_SIZE = 100
const dryRun = !process.argv.includes('--apply')

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`)

  // 1. Normalize RecipeIngredient units
  const totalRI = await prisma.recipeIngredient.count()
  console.log(`\nRecipeIngredients: ${totalRI} rows`)
  let riUpdated = 0
  let riReparsed = 0

  for (let skip = 0; skip < totalRI; skip += BATCH_SIZE) {
    const batch = await prisma.recipeIngredient.findMany({
      skip,
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    })

    for (const ri of batch) {
      let newUnit = canonicalizeUnit(ri.unit)
      let newQty = Number(ri.quantity)
      let changed = false

      // Re-parse items that were stored as piece with notes
      if (ri.unit === 'piece' && ri.notes) {
        const parsed = parseIngredientString(ri.notes)
        if (parsed.quantity !== null && parsed.unit && parsed.unit !== 'piece') {
          newQty = parsed.quantity
          newUnit = parsed.unit
          riReparsed++
          changed = true
        }
      }

      if (newUnit !== ri.unit) changed = true

      if (changed) {
        riUpdated++
        if (!dryRun) {
          await prisma.recipeIngredient.update({
            where: { id: ri.id },
            data: { quantity: newQty, unit: newUnit },
          })
        } else if (riUpdated <= 10) {
          console.log(`  RI: "${ri.unit}" -> "${newUnit}", qty ${ri.quantity} -> ${newQty}`)
        }
      }
    }
  }
  console.log(`  Updated: ${riUpdated} (${riReparsed} re-parsed from notes)`)

  // 2. Normalize PantryInventory units
  const totalPantry = await prisma.pantryInventory.count()
  console.log(`\nPantryInventory: ${totalPantry} rows`)
  let pantryUpdated = 0

  for (let skip = 0; skip < totalPantry; skip += BATCH_SIZE) {
    const batch = await prisma.pantryInventory.findMany({
      skip,
      take: BATCH_SIZE,
    })

    for (const item of batch) {
      const newUnit = canonicalizeUnit(item.unit)
      if (newUnit !== item.unit) {
        pantryUpdated++
        if (!dryRun) {
          await prisma.pantryInventory.update({
            where: { id: item.id },
            data: { unit: newUnit },
          })
        } else if (pantryUpdated <= 10) {
          console.log(`  Pantry: "${item.unit}" -> "${newUnit}"`)
        }
      }
    }
  }
  console.log(`  Updated: ${pantryUpdated}`)

  // 3. Normalize ShoppingListItem units
  const totalSLI = await prisma.shoppingListItem.count()
  console.log(`\nShoppingListItems: ${totalSLI} rows`)
  let sliUpdated = 0

  for (let skip = 0; skip < totalSLI; skip += BATCH_SIZE) {
    const batch = await prisma.shoppingListItem.findMany({
      skip,
      take: BATCH_SIZE,
    })

    for (const item of batch) {
      const newUnit = canonicalizeUnit(item.unit)
      if (newUnit !== item.unit) {
        sliUpdated++
        if (!dryRun) {
          await prisma.shoppingListItem.update({
            where: { id: item.id },
            data: { unit: newUnit },
          })
        } else if (sliUpdated <= 10) {
          console.log(`  SLI: "${item.unit}" -> "${newUnit}"`)
        }
      }
    }
  }
  console.log(`  Updated: ${sliUpdated}`)

  // 4. Update Ingredient.typicalUnit based on most common unit across its RecipeIngredients
  const allIngredients = await prisma.ingredient.findMany({
    select: { id: true, typicalUnit: true },
  })
  console.log(`\nIngredients: ${allIngredients.length} rows`)
  let ingUpdated = 0

  for (const ingredient of allIngredients) {
    const recipeUnits = await prisma.recipeIngredient.groupBy({
      by: ['unit'],
      where: { ingredientId: ingredient.id },
      _count: { unit: true },
      orderBy: { _count: { unit: 'desc' } },
      take: 1,
    })

    if (recipeUnits.length > 0) {
      const mostCommon = canonicalizeUnit(recipeUnits[0].unit)
      if (mostCommon !== ingredient.typicalUnit) {
        ingUpdated++
        if (!dryRun) {
          await prisma.ingredient.update({
            where: { id: ingredient.id },
            data: { typicalUnit: mostCommon },
          })
        } else if (ingUpdated <= 10) {
          console.log(`  Ingredient: typicalUnit "${ingredient.typicalUnit}" -> "${mostCommon}"`)
        }
      }
    }
  }
  console.log(`  Updated: ${ingUpdated}`)

  console.log(`\nDone. ${dryRun ? 'Run with --apply to commit changes.' : 'Changes committed.'}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
