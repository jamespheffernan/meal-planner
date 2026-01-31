import type { FastifyInstance, FastifyRequest } from 'fastify'
import { scrapeRecipeFromUrl, type ScrapedRecipe } from '../services/recipe-scraper.js'
import { parseRecipeFromImage, parseRecipeFromBase64, parseReceiptFromBase64, estimateRecipeNutrition } from '../services/recipe-ocr.js'
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

  // Import recipe from image (OCR)
  fastify.post('/image', async (request: FastifyRequest<{ Body: ImageImportBody }>, reply) => {
    const { imageUrl, imageBase64, mimeType, autoApprove = false } = request.body

    if (!imageUrl && !imageBase64) {
      return reply.badRequest('Either imageUrl or imageBase64 is required')
    }

    if (imageBase64 && !mimeType) {
      return reply.badRequest('mimeType is required when using imageBase64')
    }

    try {
      const parsed = imageUrl
        ? await parseRecipeFromImage(imageUrl)
        : await parseRecipeFromBase64(imageBase64!, mimeType!)

      // Estimate nutrition and cost
      const estimates = await estimateRecipeNutrition(parsed.ingredients)

      // Create or find ingredients
      const ingredientIds = await ensureIngredients(fastify, parsed.ingredients)

      // Create recipe
      const recipe = await fastify.prisma.recipe.create({
        data: {
          name: parsed.name,
          description: parsed.description,
          source: 'Image Import',
          servings: parsed.servings || 4,
          cookTimeMinutes: parsed.cookTimeMinutes || 30,
          prepTimeMinutes: parsed.prepTimeMinutes,
          totalTimeMinutes: (parsed.cookTimeMinutes || 30) + (parsed.prepTimeMinutes || 0),
          mealType: 'dinner', // Default, can be changed
          cookingStyle: 'quick_weeknight', // Default
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

      return {
        success: true,
        recipe,
        parsed, // Include raw parsed data for review
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
      // Decode if base64
      let buffer: Buffer
      try {
        buffer = Buffer.from(data, 'base64')
      } catch {
        // Assume it's already a string
        buffer = Buffer.from(data, 'utf-8')
      }

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
    const { imageUrl, imageBase64, mimeType, storeName } = request.body

    if (!imageUrl && !imageBase64) {
      return reply.badRequest('Either imageUrl or imageBase64 is required')
    }

    if (imageBase64 && !mimeType) {
      return reply.badRequest('mimeType is required when using imageBase64')
    }

    try {
      const parsed = imageUrl
        ? await import('../services/recipe-ocr.js').then(m => m.parseReceiptFromImage(imageUrl))
        : await parseReceiptFromBase64(imageBase64!, mimeType!)

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
      for (const item of parsed.items) {
        const ingredient = await fastify.prisma.ingredient.findFirst({
          where: {
            name: { contains: item.name, mode: 'insensitive' },
          },
        })

        if (ingredient) {
          // Update cost estimate if we have price data
          if (item.price && item.quantity) {
            const costPerUnit = item.price / item.quantity
            await fastify.prisma.ingredient.update({
              where: { id: ingredient.id },
              data: {
                estimatedCostPerUnit: costPerUnit,
              },
            })
          }

          matchedItems.push({
            receiptItem: item.name,
            matchedIngredient: ingredient.name,
            ingredientId: ingredient.id,
          })
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
      }
    } catch (error) {
      return reply.badRequest(`Failed to parse receipt: ${error}`)
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

    const estimates = await estimateRecipeNutrition(ingredients)

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

async function createRecipeFromScraped(
  fastify: FastifyInstance,
  scraped: ScrapedRecipe,
  autoApprove: boolean
) {
  // Create or find ingredients
  const ingredientRecords = []
  for (const ingStr of scraped.ingredients) {
    // Parse ingredient string (simple version - just use the whole string as name)
    const ingredient = await fastify.prisma.ingredient.upsert({
      where: { name: ingStr.toLowerCase().substring(0, 100) },
      create: {
        name: ingStr.toLowerCase().substring(0, 100),
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
        create: ingredientRecords.map(ir => ({
          ingredientId: ir.ingredient.id,
          quantity: 1, // Can't reliably parse quantity from scraped data
          unit: 'piece',
          notes: ir.originalString,
        })),
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
    const ingredient = await fastify.prisma.ingredient.upsert({
      where: { name: ingStr.toLowerCase().substring(0, 100) },
      create: {
        name: ingStr.toLowerCase().substring(0, 100),
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
        create: ingredientRecords.map(ir => ({
          ingredientId: ir.ingredient.id,
          quantity: 1,
          unit: 'piece',
          notes: ir.originalString,
        })),
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
    const ingredient = await fastify.prisma.ingredient.upsert({
      where: { name: ing.name.toLowerCase() },
      create: {
        name: ing.name.toLowerCase(),
        category: 'pantry',
        typicalUnit: ing.unit || 'piece',
      },
      update: {},
    })
    records.push(ingredient)
  }
  return records
}
