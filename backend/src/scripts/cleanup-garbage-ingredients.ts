import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
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

  // Delete recipe ingredient links first, then the ingredients
  const garbageIds = garbage.map(g => g.id)

  const deletedLinks = await prisma.recipeIngredient.deleteMany({
    where: { ingredientId: { in: garbageIds } }
  })
  console.log(`\nDeleted ${deletedLinks.count} recipe ingredient links`)

  const deletedIngredients = await prisma.ingredient.deleteMany({
    where: { id: { in: garbageIds } }
  })
  console.log(`Deleted ${deletedIngredients.count} garbage ingredients`)

  // Final count
  const remaining = await prisma.ingredient.count()
  console.log(`\nRemaining ingredients: ${remaining}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
