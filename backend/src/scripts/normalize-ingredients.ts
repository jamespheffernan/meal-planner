import { PrismaClient } from '@prisma/client'
import OpenAI from 'openai'

const prisma = new PrismaClient()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface ParsedIngredient {
  name: string           // normalized name like "celery", "onion", "chicken breast"
  quantity: number
  unit: string           // standardized: g, ml, piece, tbsp, tsp, cup, etc.
  notes?: string         // "finely chopped", "optional", etc.
  category: string       // will be mapped to valid enum
}

// Map parsed categories to valid Prisma enum values
function mapCategory(cat: string): 'meat' | 'dairy' | 'produce' | 'pantry' | 'frozen' | 'staple' | 'perishable' {
  const mapping: Record<string, 'meat' | 'dairy' | 'produce' | 'pantry' | 'frozen' | 'staple' | 'perishable'> = {
    'meat': 'meat',
    'protein': 'meat',
    'dairy': 'dairy',
    'produce': 'produce',
    'vegetable': 'produce',
    'fruit': 'produce',
    'pantry': 'pantry',
    'frozen': 'frozen',
    'staple': 'staple',
    'perishable': 'perishable',
    'spice': 'pantry',
    'condiment': 'pantry',
    'grain': 'staple',
    'herb': 'produce',
  }
  return mapping[cat?.toLowerCase()] || 'pantry'
}

interface RecipeIngredientMapping {
  recipeIngredientId: string
  originalText: string
  parsed: ParsedIngredient
}

async function parseIngredientText(ingredientTexts: string[]): Promise<ParsedIngredient[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are an ingredient parser. Given a list of ingredient texts from recipes, normalize each one.

For each ingredient, extract:
- name: the base ingredient name, normalized and lowercase (e.g., "onion" not "1 onion finely chopped", "chicken breast" not "500g chicken breast")
- quantity: the numeric amount (default to 1 if not specified)
- unit: standardized unit (g, kg, ml, l, piece, tbsp, tsp, cup, clove, bunch, can, jar, pack). Convert descriptive amounts: "a pinch" = 0.5 tsp, "a handful" = 30g, etc.
- notes: any prep instructions like "finely chopped", "optional", "to taste" (omit if none)
- category: one of meat, dairy, produce, pantry, frozen, staple, perishable

Common normalizations:
- "salt and pepper" → two separate ingredients: "salt" and "black pepper"
- "olive oil" stays as "olive oil" (not just "oil")
- "8 potatoes" → name: "potato", quantity: 8, unit: "piece"
- "400g can chopped tomatoes" → name: "canned tomatoes", quantity: 400, unit: "g"
- "1 (14-ounce) can diced tomatoes" → name: "canned diced tomatoes", quantity: 400, unit: "g" (convert oz to g)

Return a JSON array matching the input order.`
      },
      {
        role: 'user',
        content: JSON.stringify(ingredientTexts)
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('No response from OpenAI')

  const parsed = JSON.parse(content)
  return parsed.ingredients || parsed
}

async function searchOpenFoodFacts(ingredientName: string): Promise<{
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  imageUrl?: string
} | null> {
  try {
    const query = encodeURIComponent(ingredientName)
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,nutriments,image_url,image_front_url,image_front_small_url`,
      { headers: { 'User-Agent': 'MealPlanner/1.0' } }
    )

    if (!response.ok) return null

    const data = await response.json()
    if (!data.products?.length) return null

    // Find best match
    const product = data.products[0]
    const n = product.nutriments || {}

    return {
      calories: n['energy-kcal_100g'] || n['energy-kcal'],
      protein: n.proteins_100g || n.proteins,
      carbs: n.carbohydrates_100g || n.carbohydrates,
      fat: n.fat_100g || n.fat,
      imageUrl: product.image_front_url || product.image_url || product.image_front_small_url,
    }
  } catch (error) {
    console.error(`Open Food Facts error for ${ingredientName}:`, error)
    return null
  }
}

async function main() {
  console.log('Starting ingredient normalization...\n')

  // Get all recipes with their ingredients
  const recipes = await prisma.recipe.findMany({
    include: {
      recipeIngredients: {
        include: { ingredient: true }
      }
    }
  })

  console.log(`Found ${recipes.length} recipes to process\n`)

  // Collect all unique ingredient texts
  const ingredientTexts = new Map<string, RecipeIngredientMapping[]>()

  for (const recipe of recipes) {
    for (const ri of recipe.recipeIngredients) {
      const text = ri.ingredient.name
      if (!ingredientTexts.has(text)) {
        ingredientTexts.set(text, [])
      }
      ingredientTexts.get(text)!.push({
        recipeIngredientId: ri.id,
        originalText: text,
        parsed: null as any
      })
    }
  }

  console.log(`Found ${ingredientTexts.size} unique ingredient texts to normalize\n`)

  // Process in batches
  const batchSize = 30
  const allTexts = Array.from(ingredientTexts.keys())
  const normalizedIngredients = new Map<string, ParsedIngredient>()

  for (let i = 0; i < allTexts.length; i += batchSize) {
    const batch = allTexts.slice(i, i + batchSize)
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allTexts.length / batchSize)}...`)

    try {
      const parsed = await parseIngredientText(batch)

      for (let j = 0; j < batch.length; j++) {
        if (parsed[j]) {
          normalizedIngredients.set(batch[j], parsed[j])
        }
      }
    } catch (error) {
      console.error(`Batch error:`, error)
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\nNormalized ${normalizedIngredients.size} ingredients\n`)

  // Build normalized ingredient database
  const uniqueNormalizedNames = new Map<string, ParsedIngredient>()
  for (const [, parsed] of normalizedIngredients) {
    if (!uniqueNormalizedNames.has(parsed.name)) {
      uniqueNormalizedNames.set(parsed.name, parsed)
    }
  }

  console.log(`Found ${uniqueNormalizedNames.size} unique normalized ingredient names\n`)

  // Create or update normalized ingredients
  const ingredientIdMap = new Map<string, string>() // normalized name -> ingredient id

  for (const [name, parsed] of uniqueNormalizedNames) {
    // Check if normalized ingredient already exists
    let ingredient = await prisma.ingredient.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } }
    })

    if (!ingredient) {
      // Look up nutrition from Open Food Facts
      console.log(`Looking up nutrition for: ${name}`)
      const nutrition = await searchOpenFoodFacts(name)
      await new Promise(r => setTimeout(r, 200)) // Rate limit OFF API

      ingredient = await prisma.ingredient.create({
        data: {
          name,
          category: mapCategory(parsed.category),
          typicalUnit: parsed.unit || 'piece',
          estimatedCaloriesPerUnit: nutrition?.calories || null,
          imageUrl: nutrition?.imageUrl || null,
        }
      })
      console.log(`  Created: ${name} (${parsed.category}, ${parsed.unit})${nutrition?.imageUrl ? ' [has image]' : ''}`)
    } else {
      console.log(`  Exists: ${name}`)
    }

    ingredientIdMap.set(name, ingredient.id)
  }

  console.log(`\nUpdating recipe ingredients...\n`)

  // Update recipe ingredients with proper quantities and link to normalized ingredients
  let updated = 0
  let errors = 0

  for (const [originalText, parsed] of normalizedIngredients) {
    const newIngredientId = ingredientIdMap.get(parsed.name)
    if (!newIngredientId) {
      console.error(`No ingredient ID for: ${parsed.name}`)
      errors++
      continue
    }

    const mappings = ingredientTexts.get(originalText) || []
    for (const mapping of mappings) {
      try {
        await prisma.recipeIngredient.update({
          where: { id: mapping.recipeIngredientId },
          data: {
            ingredientId: newIngredientId,
            quantity: parsed.quantity,
            unit: parsed.unit,
            notes: parsed.notes || null,
          }
        })
        updated++
      } catch (error) {
        console.error(`Failed to update ${mapping.recipeIngredientId}:`, error)
        errors++
      }
    }
  }

  console.log(`\nUpdated ${updated} recipe ingredients (${errors} errors)\n`)

  // Clean up orphaned ingredients (not linked to any recipe)
  const orphaned = await prisma.ingredient.findMany({
    where: {
      recipeIngredients: { none: {} },
      pantryInventory: { none: {} },
      shoppingListItems: { none: {} },
    }
  })

  console.log(`Found ${orphaned.length} orphaned ingredients to delete\n`)

  if (orphaned.length > 0) {
    await prisma.ingredient.deleteMany({
      where: {
        id: { in: orphaned.map(i => i.id) }
      }
    })
    console.log(`Deleted ${orphaned.length} orphaned ingredients\n`)
  }

  // Final stats
  const finalIngredients = await prisma.ingredient.count()
  const finalRecipeIngredients = await prisma.recipeIngredient.count()

  console.log('=== Final Stats ===')
  console.log(`Ingredients: ${finalIngredients}`)
  console.log(`Recipe-Ingredient links: ${finalRecipeIngredients}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
