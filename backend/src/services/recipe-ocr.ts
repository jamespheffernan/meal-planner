// @ts-ignore - no type definitions available
import heicConvert from 'heic-convert'
import sharp from 'sharp'
import type { PrismaClient } from '@prisma/client'
import { getOpenAIClient } from './openai-client.js'
import { canonicalizeUnit } from './units.js'

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

/**
 * Parse one or more recipes from an image using OpenAI Vision
 */
export async function parseRecipesFromImage(prisma: PrismaClient, imageUrl: string): Promise<ParsedRecipe[]> {
  const openai = await getOpenAIClient(prisma)
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a recipe extraction assistant. Extract ALL recipes from images of cookbook pages, recipe cards, or handwritten recipes.

Return a JSON object with:
- recipes: array of recipe objects

Each recipe object should have:
- name: string (recipe name)
- description: string (optional brief description)
- servings: number (if mentioned)
- cookTimeMinutes: number (if mentioned)
- prepTimeMinutes: number (if mentioned)
- ingredients: array of {name, quantity, unit, notes}
- instructions: array of strings (each step)

Be precise with measurements. Convert fractions to decimals (1/2 = 0.5).
Use these canonical unit names: cup, tbsp, tsp, ml, l, g, kg, oz, lb, piece, dozen, pinch, dash, bunch, clove, can, jar, sprig.
For items without a unit (e.g. "3 eggs"), use "piece" as the unit.

IMPORTANT: Extract ALL recipes visible in the image. If there are multiple recipes, include them all in the recipes array.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract ALL recipes from this image. Return only valid JSON with a "recipes" array.',
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl },
          },
        ],
      },
    ],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from OpenAI')
  }

  try {
    const parsed = JSON.parse(content) as { recipes: ParsedRecipe[] }
    const recipes = parsed.recipes || [parsed as unknown as ParsedRecipe]
    return recipes.map(validateParsedRecipe)
  } catch (error) {
    throw new Error(`Failed to parse recipe response: ${error}`)
  }
}

/**
 * Parse a recipe from an image using OpenAI Vision (single recipe, backwards compatible)
 */
export async function parseRecipeFromImage(prisma: PrismaClient, imageUrl: string): Promise<ParsedRecipe> {
  const recipes = await parseRecipesFromImage(prisma, imageUrl)
  return recipes[0]
}

/**
 * Convert image to JPEG if needed (handles HEIC and other formats)
 */
async function convertToJpegIfNeeded(base64Image: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  const lowerMimeType = mimeType.toLowerCase()

  if (supportedTypes.includes(lowerMimeType)) {
    return { base64: base64Image, mimeType }
  }

  const inputBuffer = Buffer.from(base64Image, 'base64')

  // Handle HEIC/HEIF specifically with heic-convert
  if (lowerMimeType.includes('heic') || lowerMimeType.includes('heif')) {
    const jpegBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.9,
    })

    return {
      base64: Buffer.from(jpegBuffer).toString('base64'),
      mimeType: 'image/jpeg'
    }
  }

  // For other unsupported formats, try sharp
  const jpegBuffer = await sharp(inputBuffer)
    .jpeg({ quality: 90 })
    .toBuffer()

  return {
    base64: jpegBuffer.toString('base64'),
    mimeType: 'image/jpeg'
  }
}

/**
 * Parse recipes from base64-encoded image data (supports multiple recipes)
 */
export async function parseRecipesFromBase64(prisma: PrismaClient, base64Image: string, mimeType: string): Promise<ParsedRecipe[]> {
  // Convert HEIC and other unsupported formats to JPEG
  const { base64, mimeType: convertedType } = await convertToJpegIfNeeded(base64Image, mimeType)
  const dataUrl = `data:${convertedType};base64,${base64}`
  return parseRecipesFromImage(prisma, dataUrl)
}

/**
 * Parse a recipe from base64-encoded image data (single recipe, backwards compatible)
 */
export async function parseRecipeFromBase64(prisma: PrismaClient, base64Image: string, mimeType: string): Promise<ParsedRecipe> {
  const recipes = await parseRecipesFromBase64(prisma, base64Image, mimeType)
  return recipes[0]
}

/**
 * Parse a grocery receipt from an image
 */
export async function parseReceiptFromImage(prisma: PrismaClient, imageUrl: string): Promise<ParsedReceipt> {
  const openai = await getOpenAIClient(prisma)
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
export async function parseReceiptFromBase64(prisma: PrismaClient, base64Image: string, mimeType: string): Promise<ParsedReceipt> {
  // Convert HEIC and other unsupported formats to JPEG
  const { base64, mimeType: convertedType } = await convertToJpegIfNeeded(base64Image, mimeType)
  const dataUrl = `data:${convertedType};base64,${base64}`
  return parseReceiptFromImage(prisma, dataUrl)
}

/**
 * Estimate nutritional info and cost for a recipe using AI
 */
export async function estimateRecipeNutrition(prisma: PrismaClient, ingredients: { name: string; quantity?: number; unit?: string }[]): Promise<{
  estimatedCaloriesPerServing: number
  estimatedCostPerServing: number
}> {
  const ingredientList = ingredients
    .map(i => `${i.quantity || ''} ${i.unit || ''} ${i.name}`.trim())
    .join('\n')

  const openai = await getOpenAIClient(prisma)
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
      unit: i.unit ? canonicalizeUnit(i.unit) : undefined,
      notes: i.notes,
    })),
    instructions: recipe.instructions || [],
  }
}

export type { ParsedRecipe, ParsedReceipt }
