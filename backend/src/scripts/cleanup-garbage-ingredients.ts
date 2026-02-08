import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'

type CleanupGarbageResult = {
  garbageCount: number
  deletedLinks: number
  deletedIngredients: number
  remainingIngredients: number
  dryRun: boolean
}

export async function cleanupGarbageIngredients({ apply }: { apply: boolean }): Promise<CleanupGarbageResult> {
  const prisma = new PrismaClient()
  const dryRun = !apply
  // Find garbage ingredients (ones that start with numbers or contain measurement words in the name)
  const garbagePatterns = [
    /^\d/,                    // starts with number
    /teaspoon/i,
    /tablespoon/i,
    /\bcup\b/i,
    /ounce/i,
    /\bml\b/i,
    /\bg\b/i,
    /\blb\b/i,
    /diced|chopped|minced|sliced/i,  // prep instructions in name
  ]

  const allIngredients = await prisma.ingredient.findMany({
    include: { recipeIngredients: true }
  })

  const garbage = allIngredients.filter(ing =>
    garbagePatterns.some(pattern => pattern.test(ing.name))
  )

  console.log(`Found ${garbage.length} garbage ingredients`)

  for (const ing of garbage) {
    console.log(`  - "${ing.name}" (${ing.recipeIngredients.length} recipe links)`)
  }

  let deletedLinks = 0
  let deletedIngredients = 0
  if (!dryRun && garbage.length > 0) {
    // Delete recipe ingredient links first, then the ingredients
    const garbageIds = garbage.map(g => g.id)

    const deletedLinksResult = await prisma.recipeIngredient.deleteMany({
      where: { ingredientId: { in: garbageIds } }
    })
    deletedLinks = deletedLinksResult.count
    console.log(`\nDeleted ${deletedLinks} recipe ingredient links`)

    const deletedIngredientsResult = await prisma.ingredient.deleteMany({
      where: { id: { in: garbageIds } }
    })
    deletedIngredients = deletedIngredientsResult.count
    console.log(`Deleted ${deletedIngredients} garbage ingredients`)
  } else if (dryRun) {
    console.log('\nDry run only - no deletions performed.')
  }

  // Final count
  const remaining = await prisma.ingredient.count()
  console.log(`\nRemaining ingredients: ${remaining}`)

  await prisma.$disconnect()
  return {
    garbageCount: garbage.length,
    deletedLinks,
    deletedIngredients,
    remainingIngredients: remaining,
    dryRun,
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const apply = process.argv.includes('--apply')
  cleanupGarbageIngredients({ apply })
    .catch(console.error)
}
