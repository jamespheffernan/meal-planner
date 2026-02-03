import type { FastifyInstance, FastifyRequest } from 'fastify'
import { scrapeRecipeFromUrl, type ScrapedRecipe } from '../services/recipe-scraper.js'
import { parseRecipesFromImage, parseRecipesFromBase64, parseReceiptFromImage, parseReceiptFromBase64, estimateRecipeNutrition } from '../services/recipe-ocr.js'
import { normalizeIngredientName } from '../services/ingredient-normalizer.js'
import { parseIngredientString } from '../services/ingredient-parser.js'
import { canonicalizeUnit } from '../services/units.js'
import { parsePaprikaExport, deduplicateRecipes, type ImportedRecipe } from '../services/paprika-import.js'

interface UrlImportBody {
  url: string
  autoApprove?: boolean
}

interface ImageImportBody {
  imageUrl?: string
  imageBase64?: string
  mimeType?: string
  autoApprove?: boolean
  previewOnly?: boolean  // If true, parse and return without saving
  recipes?: Array<{      // For submitting corrected recipes after preview
    name: string
    description?: string
    servings?: number
    cookTimeMinutes?: number
    prepTimeMinutes?: number
    ingredients: { name: string; quantity?: number; unit?: string; notes?: string }[]
    instructions: string[]
  }>
}

interface PaprikaImportBody {
  data: string // base64 encoded .paprikarecipes file or JSON string
  autoApprove?: boolean
}

interface ReceiptImportBody {
  imageUrl?: string
  imageBase64?: string
  mimeType?: string
  storeName?: string
  applyMatches?: boolean
}

// Helper to extract URL from image field (can be string or ImageObject)
function extractImageUrl(image: unknown): string | undefined {
  if (!image) return undefined
  if (typeof image === 'string') return image
  if (typeof image === 'object' && image !== null) {
    const imgObj = image as Record<string, unknown>
    // Handle schema.org ImageObject
    if (imgObj.url && typeof imgObj.url === 'string') return imgObj.url
    // Handle array of images
    if (Array.isArray(image) && image.length > 0) {
      return extractImageUrl(image[0])
    }
  }
  return undefined
}

export default async function ingestionRoutes(fastify: FastifyInstance) {
  // Import recipe from URL
  fastify.post('/url', async (request: FastifyRequest<{ Body: UrlImportBody }>, reply) => {
    const { url, autoApprove = false } = request.body

    if (!url) {
      return reply.badRequest('URL is required')
    }

    try {
      const scraped = await scrapeRecipeFromUrl(url)

      // Create recipe in database
      const recipe = await createRecipeFromScraped(fastify, scraped, autoApprove)

      return {
        success: true,
        recipe,
        scraped, // Include raw scraped data for debugging/review
      }
    } catch (error) {
      return reply.badRequest(`Failed to import from URL: ${error}`)
    }
  })

  // Import recipes from image (OCR) - supports multiple recipes per image
  // Use previewOnly=true to parse without saving, then submit corrections via recipes array
  fastify.post('/image', async (request: FastifyRequest<{ Body: ImageImportBody }>, reply) => {
    const { imageUrl, imageBase64, mimeType, autoApprove = false, previewOnly = false, recipes: correctedRecipes } = request.body

    try {
      // If corrected recipes provided, save them directly (skip OCR)
      if (correctedRecipes && correctedRecipes.length > 0) {
        const createdRecipes = []

        for (const parsed of correctedRecipes) {
          const estimates = await estimateRecipeNutrition(fastify.prisma, parsed.ingredients)
          const ingredientIds = await ensureIngredients(fastify, parsed.ingredients)

          const recipe = await fastify.prisma.recipe.create({
            data: {
              name: parsed.name,
              description: parsed.description,
              source: 'Image Import',
              servings: parsed.servings || 4,
              cookTimeMinutes: parsed.cookTimeMinutes || 30,
              prepTimeMinutes: parsed.prepTimeMinutes,
              totalTimeMinutes: (parsed.cookTimeMinutes || 30) + (parsed.prepTimeMinutes || 0),
              mealType: 'dinner',
              cookingStyle: 'quick_weeknight',
              estimatedCaloriesPerServing: estimates.estimatedCaloriesPerServing || null,
              estimatedCostPerServing: estimates.estimatedCostPerServing || null,
              caloriesIsEstimate: true,
              costIsEstimate: true,
              approvalStatus: autoApprove ? 'approved' : 'pending',
              recipeIngredients: {
                create: ingredientIds.map((ing, index) => ({
                  ingredientId: ing.id,
                  quantity: parsed.ingredients[index]?.quantity || 1,
                  unit: canonicalizeUnit(parsed.ingredients[index]?.unit || 'piece'),
                  notes: parsed.ingredients[index]?.notes,
                  optional: false,
                })),
              },
              recipeInstructions: {
                create: parsed.instructions.map((text, index) => ({
                  stepNumber: index + 1,
                  instructionText: text,
                })),
              },
            },
            include: {
              recipeIngredients: { include: { ingredient: true } },
              recipeInstructions: true,
            },
          })

          createdRecipes.push(recipe)
        }

        return {
          success: true,
          count: createdRecipes.length,
          recipes: createdRecipes,
        }
      }

      // OCR the image
      if (!imageUrl && !imageBase64) {
        return reply.badRequest('Either imageUrl, imageBase64, or recipes array is required')
      }

      if (imageBase64 && !mimeType) {
        return reply.badRequest('mimeType is required when using imageBase64')
      }

      const parsedRecipes = imageUrl
        ? await parseRecipesFromImage(fastify.prisma, imageUrl)
        : await parseRecipesFromBase64(fastify.prisma, imageBase64!, mimeType!)

      // Preview mode - return parsed data without saving
      if (previewOnly) {
        return {
          success: true,
          preview: true,
          count: parsedRecipes.length,
          recipes: parsedRecipes,
        }
      }

      // Save mode - create recipes in database
      const createdRecipes = []

      for (const parsed of parsedRecipes) {
        const estimates = await estimateRecipeNutrition(fastify.prisma, parsed.ingredients)
        const ingredientIds = await ensureIngredients(fastify, parsed.ingredients)

        const recipe = await fastify.prisma.recipe.create({
          data: {
            name: parsed.name,
            description: parsed.description,
            source: 'Image Import',
            servings: parsed.servings || 4,
            cookTimeMinutes: parsed.cookTimeMinutes || 30,
            prepTimeMinutes: parsed.prepTimeMinutes,
            totalTimeMinutes: (parsed.cookTimeMinutes || 30) + (parsed.prepTimeMinutes || 0),
            mealType: 'dinner',
            cookingStyle: 'quick_weeknight',
            estimatedCaloriesPerServing: estimates.estimatedCaloriesPerServing || null,
            estimatedCostPerServing: estimates.estimatedCostPerServing || null,
            caloriesIsEstimate: true,
            costIsEstimate: true,
            approvalStatus: autoApprove ? 'approved' : 'pending',
            recipeIngredients: {
              create: ingredientIds.map((ing, index) => ({
                ingredientId: ing.id,
                quantity: parsed.ingredients[index]?.quantity || 1,
                unit: parsed.ingredients[index]?.unit || 'piece',
                notes: parsed.ingredients[index]?.notes,
                optional: false,
              })),
            },
            recipeInstructions: {
              create: parsed.instructions.map((text, index) => ({
                stepNumber: index + 1,
                instructionText: text,
              })),
            },
          },
          include: {
            recipeIngredients: { include: { ingredient: true } },
            recipeInstructions: true,
          },
        })

        createdRecipes.push({ recipe, parsed })
      }

      return {
        success: true,
        count: createdRecipes.length,
        recipes: createdRecipes.map(r => r.recipe),
        parsed: createdRecipes.map(r => r.parsed),
      }
    } catch (error) {
      return reply.badRequest(`Failed to parse image: ${error}`)
    }
  })

  // Import recipes from Paprika export
  fastify.post('/paprika', async (request: FastifyRequest<{ Body: PaprikaImportBody }>, reply) => {
    const { data, autoApprove = false } = request.body

    if (!data) {
      return reply.badRequest('Data is required')
    }

    try {
      // Decode if base64 (Paprika exports are usually base64-encoded files)
      const trimmed = data.trim()
      const buffer = (trimmed.startsWith('{') || trimmed.startsWith('['))
        ? Buffer.from(trimmed, 'utf-8')
        : Buffer.from(trimmed, 'base64')

      const imported = await parsePaprikaExport(buffer)

      // Get existing recipe names for deduplication
      const existingRecipes = await fastify.prisma.recipe.findMany({
        select: { name: true },
      })
      const existingNames = existingRecipes.map(r => r.name)

      const { unique, duplicates } = deduplicateRecipes(imported, existingNames)

      // Create recipes
      const created = []
      const errors = []

      for (const recipe of unique) {
        try {
          const created_recipe = await createRecipeFromImported(fastify, recipe, autoApprove)
          created.push(created_recipe)
        } catch (error) {
          errors.push({ name: recipe.name, error: String(error) })
        }
      }

      return {
        success: true,
        imported: created.length,
        duplicatesSkipped: duplicates.length,
        errors: errors.length > 0 ? errors : undefined,
        duplicateNames: duplicates.map(d => d.name),
      }
    } catch (error) {
      return reply.badRequest(`Failed to parse Paprika export: ${error}`)
    }
  })

  // Import receipt for ingredient/price data
  fastify.post('/receipt', async (request: FastifyRequest<{ Body: ReceiptImportBody }>, reply) => {
    const { imageUrl, imageBase64, mimeType, storeName, applyMatches = true } = request.body

    if (!imageUrl && !imageBase64) {
      return reply.badRequest('Either imageUrl or imageBase64 is required')
    }

    if (imageBase64 && !mimeType) {
      return reply.badRequest('mimeType is required when using imageBase64')
    }

    try {
      const parsed = imageUrl
        ? await parseReceiptFromImage(fastify.prisma, imageUrl)
        : await parseReceiptFromBase64(fastify.prisma, imageBase64!, mimeType!)

      const allIngredients = await fastify.prisma.ingredient.findMany({
        select: { id: true, name: true, estimatedCostPerUnit: true },
      })

      // Create grocery receipt record
      const receipt = await fastify.prisma.groceryReceipt.create({
        data: {
          storeName: storeName || parsed.storeName || 'Unknown Store',
          purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate) : new Date(),
          totalAmount: parsed.total || 0,
          parsedItems: parsed.items as any,
          processingStatus: 'parsed',
        },
      })

      // Try to match items to existing ingredients
      const matchedItems = []
      const unmatchedItems = []
      for (const item of parsed.items) {
        const bestMatch = findBestIngredientMatch(item.name, allIngredients)
        const ingredient = bestMatch?.ingredient

        if (ingredient) {
          // Update cost estimate if we have price data
          let updatedCost: number | null = null
          let suggestedCost: number | null = null
          if (item.price) {
            const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1
            const costPerUnit = item.price / quantity
            const existing = ingredient.estimatedCostPerUnit ? Number(ingredient.estimatedCostPerUnit) : null
            const blendedCost = existing ? (existing * 0.7 + costPerUnit * 0.3) : costPerUnit
            suggestedCost = blendedCost
            if (applyMatches) {
              await fastify.prisma.ingredient.update({
                where: { id: ingredient.id },
                data: {
                  estimatedCostPerUnit: blendedCost,
                },
              })
              updatedCost = blendedCost
            }
          }

          matchedItems.push({
            receiptItem: item.name,
            matchedIngredient: ingredient.name,
            ingredientId: ingredient.id,
            matchScore: bestMatch?.score,
            updatedCostPerUnit: updatedCost,
            suggestedCostPerUnit: suggestedCost,
            receiptPrice: item.price,
            receiptQuantity: item.quantity,
            applied: applyMatches && updatedCost !== null,
          })
        } else {
          unmatchedItems.push(item)
        }
      }

      // Update receipt status
      await fastify.prisma.groceryReceipt.update({
        where: { id: receipt.id },
        data: { processingStatus: 'matched' },
      })

      return {
        success: true,
        receipt,
        parsed,
        matchedItems,
        unmatchedCount: parsed.items.length - matchedItems.length,
        unmatchedItems,
      }
    } catch (error) {
      return reply.badRequest(`Failed to parse receipt: ${error}`)
    }
  })

  // Apply receipt matches (manual confirmation)
  fastify.post('/receipt/apply', async (request: FastifyRequest<{ Body: { matches: Array<{ ingredientId: string; price?: number; quantity?: number }> } }>, reply) => {
    const { matches } = request.body

    if (!matches || matches.length === 0) {
      return reply.badRequest('Matches array is required')
    }

    const updates = []

    for (const match of matches) {
      if (!match.price) continue
      const ingredient = await fastify.prisma.ingredient.findUnique({
        where: { id: match.ingredientId },
        select: { id: true, estimatedCostPerUnit: true },
      })
      if (!ingredient) continue

      const quantity = match.quantity && match.quantity > 0 ? match.quantity : 1
      const costPerUnit = match.price / quantity
      const existing = ingredient.estimatedCostPerUnit ? Number(ingredient.estimatedCostPerUnit) : null
      const blendedCost = existing ? (existing * 0.7 + costPerUnit * 0.3) : costPerUnit

      await fastify.prisma.ingredient.update({
        where: { id: ingredient.id },
        data: { estimatedCostPerUnit: blendedCost },
      })

      updates.push({ ingredientId: ingredient.id, updatedCostPerUnit: blendedCost })
    }

    return {
      success: true,
      updated: updates.length,
      updates,
    }
  })

  // Estimate nutrition for a recipe
  fastify.post('/estimate/:recipeId', async (request: FastifyRequest<{ Params: { recipeId: string } }>, reply) => {
    const recipe = await fastify.prisma.recipe.findUnique({
      where: { id: request.params.recipeId },
      include: {
        recipeIngredients: {
          include: { ingredient: true },
        },
      },
    })

    if (!recipe) {
      return reply.notFound('Recipe not found')
    }

    const ingredients = recipe.recipeIngredients.map(ri => ({
      name: ri.ingredient.name,
      quantity: Number(ri.quantity),
      unit: ri.unit,
    }))

    const estimates = await estimateRecipeNutrition(fastify.prisma, ingredients)

    // Update recipe with estimates
    await fastify.prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        estimatedCaloriesPerServing: estimates.estimatedCaloriesPerServing,
        estimatedCostPerServing: estimates.estimatedCostPerServing,
        caloriesIsEstimate: true,
        costIsEstimate: true,
      },
    })

    return {
      success: true,
      estimates,
    }
  })
}

function normalizeReceiptText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findBestIngredientMatch(
  receiptName: string,
  ingredients: { id: string; name: string; estimatedCostPerUnit: unknown }[]
): { ingredient: { id: string; name: string; estimatedCostPerUnit: unknown }; score: number } | null {
  const target = normalizeReceiptText(receiptName)
  if (!target) return null

  let best: { ingredient: { id: string; name: string; estimatedCostPerUnit: unknown }; score: number } | null = null

  for (const ingredient of ingredients) {
    const candidate = normalizeReceiptText(ingredient.name)
    if (!candidate) continue

    let score = 0
    if (target === candidate) {
      score = 1
    } else if (target.includes(candidate) || candidate.includes(target)) {
      score = 0.85
    } else {
      const targetTokens = new Set(target.split(' '))
      const candidateTokens = new Set(candidate.split(' '))
      let overlap = 0
      targetTokens.forEach(token => {
        if (candidateTokens.has(token)) overlap += 1
      })
      const tokenScore = overlap / Math.max(targetTokens.size, candidateTokens.size)
      score = tokenScore
    }

    if (score >= 0.6 && (!best || score > best.score)) {
      best = { ingredient, score }
    }
  }

  return best
}

async function createRecipeFromScraped(
  fastify: FastifyInstance,
  scraped: ScrapedRecipe,
  autoApprove: boolean
) {
  // Create or find ingredients
  const ingredientRecords = []
  for (const ingStr of scraped.ingredients) {
    const normalizedName = normalizeIngredientName(ingStr)
    const ingredient = await fastify.prisma.ingredient.upsert({
      where: { name: normalizedName },
      create: {
        name: normalizedName,
        category: 'pantry', // Default
        typicalUnit: 'piece',
      },
      update: {},
    })
    ingredientRecords.push({ ingredient, originalString: ingStr })
  }

  // Create recipe
  return fastify.prisma.recipe.create({
    data: {
      name: scraped.name,
      description: scraped.description,
      source: scraped.source,
      servings: scraped.servings || 4,
      cookTimeMinutes: scraped.cookTimeMinutes || 30,
      prepTimeMinutes: scraped.prepTimeMinutes,
      totalTimeMinutes: scraped.totalTimeMinutes ||
        (scraped.cookTimeMinutes || 30) + (scraped.prepTimeMinutes || 0),
      mealType: 'dinner', // Default
      cookingStyle: 'quick_weeknight', // Default
      photoUrl: extractImageUrl(scraped.image),
      approvalStatus: autoApprove ? 'approved' : 'pending',
      recipeIngredients: {
        create: ingredientRecords.map(ir => {
          const parsed = parseIngredientString(ir.originalString)
          return {
            ingredientId: ir.ingredient.id,
            quantity: parsed.quantity ?? 1,
            unit: parsed.unit ?? 'piece',
            notes: parsed.notes || ir.originalString,
          }
        }),
      },
      recipeInstructions: {
        create: scraped.instructions.map((text, index) => ({
          stepNumber: index + 1,
          instructionText: text,
        })),
      },
    },
    include: {
      recipeIngredients: { include: { ingredient: true } },
      recipeInstructions: true,
    },
  })
}

async function createRecipeFromImported(
  fastify: FastifyInstance,
  imported: ImportedRecipe,
  autoApprove: boolean
) {
  // Create or find ingredients
  const ingredientRecords = []
  for (const ingStr of imported.ingredients) {
    const normalizedName = normalizeIngredientName(ingStr)
    const ingredient = await fastify.prisma.ingredient.upsert({
      where: { name: normalizedName },
      create: {
        name: normalizedName,
        category: 'pantry',
        typicalUnit: 'piece',
      },
      update: {},
    })
    ingredientRecords.push({ ingredient, originalString: ingStr })
  }

  return fastify.prisma.recipe.create({
    data: {
      name: imported.name,
      description: imported.description,
      source: imported.source,
      servings: imported.servings || 4,
      cookTimeMinutes: imported.cookTimeMinutes || 30,
      prepTimeMinutes: imported.prepTimeMinutes,
      totalTimeMinutes: imported.totalTimeMinutes ||
        (imported.cookTimeMinutes || 30) + (imported.prepTimeMinutes || 0),
      mealType: 'dinner',
      cookingStyle: 'quick_weeknight',
      approvalStatus: autoApprove ? 'approved' : 'pending',
      recipeIngredients: {
        create: ingredientRecords.map(ir => {
          const parsed = parseIngredientString(ir.originalString)
          return {
            ingredientId: ir.ingredient.id,
            quantity: parsed.quantity ?? 1,
            unit: parsed.unit ?? 'piece',
            notes: parsed.notes || ir.originalString,
          }
        }),
      },
      recipeInstructions: {
        create: imported.instructions.map((text, index) => ({
          stepNumber: index + 1,
          instructionText: text,
        })),
      },
    },
    include: {
      recipeIngredients: { include: { ingredient: true } },
      recipeInstructions: true,
    },
  })
}

async function ensureIngredients(
  fastify: FastifyInstance,
  ingredients: { name: string; quantity?: number; unit?: string }[]
) {
  const records = []
  for (const ing of ingredients) {
    const normalizedName = normalizeIngredientName(ing.name)
    const ingredient = await fastify.prisma.ingredient.upsert({
      where: { name: normalizedName },
      create: {
        name: normalizedName,
        category: 'pantry',
        typicalUnit: ing.unit || 'piece',
      },
      update: {},
    })
    records.push(ingredient)
  }
  return records
}
