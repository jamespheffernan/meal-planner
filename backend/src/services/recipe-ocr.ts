import OpenAI from 'openai'

interface ParsedRecipe {
  name: string
  description?: string
  servings?: number
  cookTimeMinutes?: number
  prepTimeMinutes?: number
  ingredients: {
    name: string
    quantity?: number
    unit?: string
    notes?: string
  }[]
  instructions: string[]
}

interface ParsedReceipt {
  storeName?: string
  purchaseDate?: string
  items: {
    name: string
    quantity?: number
    unit?: string
    price?: number
  }[]
  total?: number
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Parse a recipe from an image using OpenAI Vision
 */
export async function parseRecipeFromImage(imageUrl: string): Promise<ParsedRecipe> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a recipe extraction assistant. Extract recipe information from images of cookbook pages, recipe cards, or handwritten recipes.

Return a JSON object with:
- name: string (recipe name)
- description: string (optional brief description)
- servings: number (if mentioned)
- cookTimeMinutes: number (if mentioned)
- prepTimeMinutes: number (if mentioned)
- ingredients: array of {name, quantity, unit, notes}
- instructions: array of strings (each step)

Be precise with measurements. Convert fractions to decimals (1/2 = 0.5).
If units are abbreviated, expand them (tbsp = tablespoon, tsp = teaspoon, oz = ounce, lb = pound, g = gram, ml = milliliter, L = liter).`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the recipe from this image. Return only valid JSON.',
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl },
          },
        ],
      },
    ],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from OpenAI')
  }

  try {
    const parsed = JSON.parse(content) as ParsedRecipe
    return validateParsedRecipe(parsed)
  } catch (error) {
    throw new Error(`Failed to parse recipe response: ${error}`)
  }
}

/**
 * Parse a recipe from base64-encoded image data
 */
export async function parseRecipeFromBase64(base64Image: string, mimeType: string): Promise<ParsedRecipe> {
  const dataUrl = `data:${mimeType};base64,${base64Image}`
  return parseRecipeFromImage(dataUrl)
}

/**
 * Parse a grocery receipt from an image
 */
export async function parseReceiptFromImage(imageUrl: string): Promise<ParsedReceipt> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a receipt parsing assistant. Extract grocery receipt information from images.

Return a JSON object with:
- storeName: string (store name if visible)
- purchaseDate: string (date in YYYY-MM-DD format if visible)
- items: array of {name, quantity, unit, price}
- total: number (total amount if visible)

For items:
- name: normalize product names (remove brand prefixes if generic item)
- quantity: number (default 1 if not specified)
- unit: string (piece, kg, g, L, ml, etc.)
- price: number (item price)

Be accurate with prices and quantities.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract all items from this grocery receipt. Return only valid JSON.',
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl },
          },
        ],
      },
    ],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from OpenAI')
  }

  try {
    return JSON.parse(content) as ParsedReceipt
  } catch (error) {
    throw new Error(`Failed to parse receipt response: ${error}`)
  }
}

/**
 * Parse a recipe from base64-encoded receipt image
 */
export async function parseReceiptFromBase64(base64Image: string, mimeType: string): Promise<ParsedReceipt> {
  const dataUrl = `data:${mimeType};base64,${base64Image}`
  return parseReceiptFromImage(dataUrl)
}

/**
 * Estimate nutritional info and cost for a recipe using AI
 */
export async function estimateRecipeNutrition(ingredients: { name: string; quantity?: number; unit?: string }[]): Promise<{
  estimatedCaloriesPerServing: number
  estimatedCostPerServing: number
}> {
  const ingredientList = ingredients
    .map(i => `${i.quantity || ''} ${i.unit || ''} ${i.name}`.trim())
    .join('\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a nutrition and cost estimation assistant. Given a list of ingredients, estimate:
1. Total calories for the entire recipe
2. Estimated cost in GBP (UK prices)

Return JSON with:
- totalCalories: number
- estimatedCostGBP: number
- servings: number (estimated if not specified, assume 4)`,
      },
      {
        role: 'user',
        content: `Estimate nutrition and cost for these ingredients:\n${ingredientList}\n\nReturn only valid JSON.`,
      },
    ],
    max_tokens: 500,
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    return { estimatedCaloriesPerServing: 0, estimatedCostPerServing: 0 }
  }

  try {
    const parsed = JSON.parse(content) as {
      totalCalories: number
      estimatedCostGBP: number
      servings: number
    }
    const servings = parsed.servings || 4
    return {
      estimatedCaloriesPerServing: Math.round(parsed.totalCalories / servings),
      estimatedCostPerServing: Math.round((parsed.estimatedCostGBP / servings) * 100) / 100,
    }
  } catch {
    return { estimatedCaloriesPerServing: 0, estimatedCostPerServing: 0 }
  }
}

function validateParsedRecipe(recipe: Partial<ParsedRecipe>): ParsedRecipe {
  return {
    name: recipe.name || 'Untitled Recipe',
    description: recipe.description,
    servings: recipe.servings,
    cookTimeMinutes: recipe.cookTimeMinutes,
    prepTimeMinutes: recipe.prepTimeMinutes,
    ingredients: (recipe.ingredients || []).map(i => ({
      name: i.name || 'Unknown ingredient',
      quantity: i.quantity,
      unit: i.unit,
      notes: i.notes,
    })),
    instructions: recipe.instructions || [],
  }
}

export type { ParsedRecipe, ParsedReceipt }
