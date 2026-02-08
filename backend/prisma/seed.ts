import { PrismaClient } from '@prisma/client'
import { ingredientCatalog } from './ingredient-catalog.js'

const prisma = new PrismaClient()

type OffLookupResult = {
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  imageUrl?: string
  productName?: string
}

const OFF_ENRICH = process.env.OFF_ENRICH !== 'false'
const OFF_ENRICH_CONCURRENCY = Math.max(1, Number(process.env.OFF_ENRICH_CONCURRENCY ?? 3))
const OFF_ENRICH_DELAY_MS = Math.max(0, Number(process.env.OFF_ENRICH_DELAY_MS ?? 200))

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function searchOpenFoodFacts(ingredientName: string): Promise<OffLookupResult | null> {
  try {
    const query = encodeURIComponent(ingredientName)
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=8&fields=product_name,generic_name,nutriments,image_url,image_front_url,image_front_small_url`,
      { headers: { 'User-Agent': 'MealPlanner/1.0' } }
    )

    if (!response.ok) return null

    const data = await response.json()
    if (!data.products?.length) return null

    const normalizedQuery = ingredientName.toLowerCase()
    const ranked = data.products
      .map((product: any) => {
        const n = product.nutriments || {}
        const calories = n['energy-kcal_100g'] || n['energy-kcal']
        const protein = n.proteins_100g || n.proteins
        const carbs = n.carbohydrates_100g || n.carbohydrates
        const fat = n.fat_100g || n.fat
        const imageUrl = product.image_front_url || product.image_url || product.image_front_small_url
        const nameText = `${product.product_name || ''} ${product.generic_name || ''}`.toLowerCase()
        const nameMatch = nameText.includes(normalizedQuery)
        const hasCalories = Boolean(calories)
        const score = (nameMatch ? 5 : 0) + (hasCalories ? 4 : 0) + (imageUrl ? 1 : 0)
        return {
          score,
          productName: product.product_name,
          calories,
          protein,
          carbs,
          fat,
          imageUrl,
        }
      })
      .sort((a: any, b: any) => b.score - a.score)

    const withCalories = ranked.find((item: any) => item.calories !== undefined)
    const withImage = ranked.find((item: any) => item.imageUrl)
    const best = withCalories || withImage || ranked[0]

    if (!best?.calories && !best?.imageUrl) return null

    return {
      productName: best.productName,
      calories: best.calories,
      protein: best.protein,
      carbs: best.carbs,
      fat: best.fat,
      imageUrl: best.imageUrl,
    }
  } catch (error) {
    console.warn(`Open Food Facts error for ${ingredientName}:`, error)
    return null
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, handler: (item: T, index: number) => Promise<R>) {
  let idx = 0
  const results: R[] = new Array(items.length)
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx++
      results[current] = await handler(items[current], current)
    }
  })
  await Promise.all(workers)
  return results
}

async function seedIngredientsFromCatalog() {
  let enriched = 0
  let failures = 0

  await runWithConcurrency(ingredientCatalog, OFF_ENRICH_CONCURRENCY, async (item) => {
    let offData: OffLookupResult | null = null

    if (OFF_ENRICH && item.estimatedCaloriesPerUnit === undefined) {
      if (OFF_ENRICH_DELAY_MS) {
        await sleep(OFF_ENRICH_DELAY_MS)
      }
      offData = await searchOpenFoodFacts(item.name)
    }

    try {
      const existing = await prisma.ingredient.findUnique({ where: { name: item.name } })
      if (existing) {
        const shouldUpdateCalories = existing.estimatedCaloriesPerUnit === null && offData?.calories !== undefined
        const shouldUpdateImage = !existing.imageUrl && offData?.imageUrl
        if (shouldUpdateCalories || shouldUpdateImage) {
          await prisma.ingredient.update({
            where: { id: existing.id },
            data: {
              ...(shouldUpdateCalories ? { estimatedCaloriesPerUnit: offData?.calories } : {}),
              ...(shouldUpdateImage ? { imageUrl: offData?.imageUrl } : {}),
            },
          })
          enriched += 1
        }
      } else {
        await prisma.ingredient.create({
          data: {
            ...item,
            estimatedCaloriesPerUnit: item.estimatedCaloriesPerUnit ?? offData?.calories,
            estimatedCostPerUnit: item.estimatedCostPerUnit,
            imageUrl: offData?.imageUrl,
          },
        })
        if (offData?.calories || offData?.imageUrl) {
          enriched += 1
        }
      }
    } catch (error) {
      failures += 1
      console.warn(`Failed to seed ingredient "${item.name}":`, error)
    }
  })

  console.log(`Seeded ${ingredientCatalog.length} ingredients (${enriched} enriched, ${failures} failed)`)
}

async function buildIngredientIdMap(names: string[]) {
  const unique = Array.from(new Set(names))
  const records = await prisma.ingredient.findMany({
    where: { name: { in: unique } },
    select: { id: true, name: true },
  })
  const map = new Map(records.map(r => [r.name, r.id]))
  const missing = unique.filter(name => !map.has(name))
  if (missing.length > 0) {
    throw new Error(`Missing ingredients for seed recipes: ${missing.join(', ')}`)
  }
  return map
}

async function main() {
  console.log('Seeding database...')

  await seedIngredientsFromCatalog()

  const seedIngredientNames = [
    'chicken breast',
    'ground beef',
    'salmon fillet',
    'eggs',
    'butter',
    'milk',
    'parmesan cheese',
    'onion',
    'garlic',
    'tomatoes',
    'spinach',
    'lemon',
    'broccoli',
    'olive oil',
    'salt',
    'black pepper',
    'soy sauce',
    'pasta',
    'rice',
    'canned tomatoes',
    'chicken stock',
  ]

  const ingredientIdByName = await buildIngredientIdMap(seedIngredientNames)

  // Create sample recipes
  const chickenStirFry = await prisma.recipe.create({
    data: {
      name: 'Quick Chicken Stir Fry',
      description: 'A fast and healthy weeknight dinner with chicken and vegetables',
      servings: 4,
      cookTimeMinutes: 15,
      prepTimeMinutes: 10,
      totalTimeMinutes: 25,
      mealType: 'dinner',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 350,
      estimatedCostPerServing: 3.50,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredientIdByName.get('chicken breast')!, quantity: 500, unit: 'g' },
          { ingredientId: ingredientIdByName.get('onion')!, quantity: 1, unit: 'piece' },
          { ingredientId: ingredientIdByName.get('garlic')!, quantity: 3, unit: 'clove' },
          { ingredientId: ingredientIdByName.get('broccoli')!, quantity: 200, unit: 'g' },
          { ingredientId: ingredientIdByName.get('olive oil')!, quantity: 2, unit: 'tbsp' },
          { ingredientId: ingredientIdByName.get('soy sauce')!, quantity: 1, unit: 'tbsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Cut chicken breast into thin strips and season with salt and pepper.' },
          { stepNumber: 2, instructionText: 'Heat olive oil in a large wok or skillet over high heat.' },
          { stepNumber: 3, instructionText: 'Add chicken and stir fry for 5-6 minutes until golden and cooked through. Remove and set aside.' },
          { stepNumber: 4, instructionText: 'Add onion and garlic to the pan and stir fry for 2 minutes.' },
          { stepNumber: 5, instructionText: 'Add broccoli and cook for 3 minutes until tender-crisp.' },
          { stepNumber: 6, instructionText: 'Return chicken to the pan, add soy sauce, toss to combine and serve.' },
        ],
      },
    },
  })

  const spaghettiSauce = await prisma.recipe.create({
    data: {
      name: 'Classic Spaghetti with Meat Sauce',
      description: 'A hearty Italian classic perfect for batch cooking',
      servings: 6,
      cookTimeMinutes: 45,
      prepTimeMinutes: 15,
      totalTimeMinutes: 60,
      mealType: 'dinner',
      cookingStyle: 'batch_cook',
      estimatedCaloriesPerServing: 520,
      estimatedCostPerServing: 2.80,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredientIdByName.get('ground beef')!, quantity: 500, unit: 'g' },
          { ingredientId: ingredientIdByName.get('pasta')!, quantity: 400, unit: 'g' },
          { ingredientId: ingredientIdByName.get('onion')!, quantity: 1, unit: 'piece' },
          { ingredientId: ingredientIdByName.get('garlic')!, quantity: 4, unit: 'clove' },
          { ingredientId: ingredientIdByName.get('canned tomatoes')!, quantity: 400, unit: 'g' },
          { ingredientId: ingredientIdByName.get('parmesan cheese')!, quantity: 50, unit: 'g' },
          { ingredientId: ingredientIdByName.get('olive oil')!, quantity: 2, unit: 'tbsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Heat olive oil in a large pot over medium heat.' },
          { stepNumber: 2, instructionText: 'Add onion and garlic, cook until softened.' },
          { stepNumber: 3, instructionText: 'Add ground beef and cook until browned, breaking it up as it cooks.' },
          { stepNumber: 4, instructionText: 'Add canned tomatoes, season with salt and pepper. Simmer for 30 minutes.' },
          { stepNumber: 5, instructionText: 'Cook pasta according to package directions, drain.' },
          { stepNumber: 6, instructionText: 'Serve sauce over pasta, topped with parmesan cheese.' },
        ],
      },
    },
  })

  const salmonDinner = await prisma.recipe.create({
    data: {
      name: 'Pan-Seared Salmon with Lemon',
      description: 'Elegant but simple salmon dinner ready in 20 minutes',
      servings: 2,
      cookTimeMinutes: 12,
      prepTimeMinutes: 5,
      totalTimeMinutes: 17,
      mealType: 'dinner',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 380,
      estimatedCostPerServing: 8.50,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredientIdByName.get('salmon fillet')!, quantity: 300, unit: 'g' },
          { ingredientId: ingredientIdByName.get('lemon')!, quantity: 1, unit: 'piece' },
          { ingredientId: ingredientIdByName.get('butter')!, quantity: 2, unit: 'tbsp' },
          { ingredientId: ingredientIdByName.get('spinach')!, quantity: 100, unit: 'g' },
          { ingredientId: ingredientIdByName.get('salt')!, quantity: 0.5, unit: 'tsp' },
          { ingredientId: ingredientIdByName.get('black pepper')!, quantity: 0.25, unit: 'tsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Pat salmon fillets dry and season with salt and pepper.' },
          { stepNumber: 2, instructionText: 'Heat butter in a skillet over medium-high heat.' },
          { stepNumber: 3, instructionText: 'Place salmon skin-side up and cook for 4 minutes until golden.' },
          { stepNumber: 4, instructionText: 'Flip and cook for another 3-4 minutes.' },
          { stepNumber: 5, instructionText: 'Squeeze lemon juice over the salmon.' },
          { stepNumber: 6, instructionText: 'Serve with sauteed spinach on the side.' },
        ],
      },
    },
  })

  const scrambledEggs = await prisma.recipe.create({
    data: {
      name: 'Fluffy Scrambled Eggs',
      description: 'Perfect creamy scrambled eggs for breakfast',
      servings: 2,
      cookTimeMinutes: 5,
      prepTimeMinutes: 2,
      totalTimeMinutes: 7,
      mealType: 'breakfast',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 220,
      estimatedCostPerServing: 1.20,
      approvalStatus: 'approved',
      recipeIngredients: {
        create: [
          { ingredientId: ingredientIdByName.get('eggs')!, quantity: 4, unit: 'piece' },
          { ingredientId: ingredientIdByName.get('butter')!, quantity: 1, unit: 'tbsp' },
          { ingredientId: ingredientIdByName.get('milk')!, quantity: 30, unit: 'ml' },
          { ingredientId: ingredientIdByName.get('salt')!, quantity: 0.25, unit: 'tsp' },
          { ingredientId: ingredientIdByName.get('black pepper')!, quantity: 0.1, unit: 'tsp' },
        ],
      },
      recipeInstructions: {
        create: [
          { stepNumber: 1, instructionText: 'Crack eggs into a bowl, add milk, salt and pepper. Whisk until combined.' },
          { stepNumber: 2, instructionText: 'Melt butter in a non-stick pan over low heat.' },
          { stepNumber: 3, instructionText: 'Pour in eggs and let sit for 20 seconds.' },
          { stepNumber: 4, instructionText: 'Gently push eggs from edges to center, forming soft curds.' },
          { stepNumber: 5, instructionText: 'Remove from heat while still slightly wet - they will continue cooking.' },
        ],
      },
    },
  })

  // Create a pending recipe for discover
  await prisma.recipe.create({
    data: {
      name: 'Mediterranean Chicken Bowl',
      description: 'Healthy grain bowl with grilled chicken, hummus, and fresh vegetables',
      servings: 2,
      cookTimeMinutes: 20,
      prepTimeMinutes: 15,
      totalTimeMinutes: 35,
      mealType: 'lunch',
      cookingStyle: 'quick_weeknight',
      estimatedCaloriesPerServing: 450,
      estimatedCostPerServing: 5.00,
      approvalStatus: 'pending',
    },
  })

  await prisma.recipe.create({
    data: {
      name: 'Thai Green Curry',
      description: 'Aromatic coconut curry with vegetables and your choice of protein',
      servings: 4,
      cookTimeMinutes: 25,
      prepTimeMinutes: 15,
      totalTimeMinutes: 40,
      mealType: 'dinner',
      cookingStyle: 'batch_cook',
      estimatedCaloriesPerServing: 480,
      estimatedCostPerServing: 4.50,
      approvalStatus: 'pending',
    },
  })

  console.log('Created sample recipes')

  // Create user preferences
  await prisma.userPreferences.upsert({
    where: { id: 'default-user' },
    update: {},
    create: {
      id: 'default-user',
      budgetTargetWeekly: 100,
      calorieTargetDaily: 2000,
      preferredCuisines: ['Italian', 'Asian', 'Mediterranean'],
      dietaryRestrictions: [],
      dislikedIngredients: [],
      priorityWeights: {
        variety: 0.15,
        expiration: 0.20,
        pantry: 0.15,
        budget: 0.15,
        calorie: 0.10,
        time: 0.15,
        rating: 0.10,
      },
      defaultShoppingDay: 'saturday',
    },
  })

  console.log('Created user preferences')

  // Add some pantry items
  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredientIdByName.get('olive oil')!, // olive oil
      quantity: 500,
      unit: 'ml',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredientIdByName.get('salt')!, // salt
      quantity: 1,
      unit: 'container',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredientIdByName.get('pasta')!, // pasta
      quantity: 500,
      unit: 'g',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredientIdByName.get('rice')!, // rice
      quantity: 1000,
      unit: 'g',
      acquiredDate: new Date(),
      status: 'stocked',
      source: 'manual_entry',
    },
  })

  // Add an expiring item
  const threeDaysFromNow = new Date()
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)

  await prisma.pantryInventory.create({
    data: {
      ingredientId: ingredientIdByName.get('chicken breast')!, // chicken
      quantity: 400,
      unit: 'g',
      acquiredDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      expirationDate: threeDaysFromNow,
      status: 'stocked',
      source: 'grocery_trip',
    },
  })

  console.log('Created pantry items')

  void chickenStirFry
  void spaghettiSauce
  void salmonDinner
  void scrambledEggs
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
