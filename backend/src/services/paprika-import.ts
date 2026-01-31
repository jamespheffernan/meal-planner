import { createGunzip } from 'zlib'
import { Readable } from 'stream'

interface PaprikaRecipe {
  name: string
  description?: string
  source?: string
  servings?: string
  cook_time?: string
  prep_time?: string
  total_time?: string
  ingredients?: string
  directions?: string
  notes?: string
  nutritional_info?: string
  photo_data?: string
  categories?: string[]
  difficulty?: string
  rating?: number
  uid?: string
}

interface ImportedRecipe {
  name: string
  description?: string
  source?: string
  servings?: number
  cookTimeMinutes?: number
  prepTimeMinutes?: number
  totalTimeMinutes?: number
  ingredients: string[]
  instructions: string[]
  photoBase64?: string
  categories?: string[]
}

/**
 * Parse a Paprika recipe export file (.paprikarecipes or JSON)
 * Paprika exports can be:
 * 1. A gzipped JSON array (.paprikarecipes)
 * 2. A JSON array
 * 3. A single JSON object
 */
export async function parsePaprikaExport(data: Buffer | string): Promise<ImportedRecipe[]> {
  let jsonData: string

  // Check if it's gzipped (Paprika .paprikarecipes format)
  if (Buffer.isBuffer(data) && isGzipped(data)) {
    jsonData = await decompressGzip(data)
  } else if (Buffer.isBuffer(data)) {
    jsonData = data.toString('utf-8')
  } else {
    jsonData = data
  }

  // Parse JSON
  let recipes: PaprikaRecipe[]
  try {
    const parsed = JSON.parse(jsonData)
    recipes = Array.isArray(parsed) ? parsed : [parsed]
  } catch (error) {
    throw new Error(`Invalid Paprika export format: ${error}`)
  }

  return recipes.map(convertPaprikaRecipe)
}

/**
 * Parse a single Paprika recipe JSON
 */
export function parsePaprikaRecipe(json: string): ImportedRecipe {
  const recipe = JSON.parse(json) as PaprikaRecipe
  return convertPaprikaRecipe(recipe)
}

function convertPaprikaRecipe(recipe: PaprikaRecipe): ImportedRecipe {
  return {
    name: recipe.name || 'Untitled Recipe',
    description: recipe.description || recipe.notes || undefined,
    source: recipe.source || undefined,
    servings: parseServings(recipe.servings),
    cookTimeMinutes: parseTime(recipe.cook_time),
    prepTimeMinutes: parseTime(recipe.prep_time),
    totalTimeMinutes: parseTime(recipe.total_time),
    ingredients: parseIngredients(recipe.ingredients),
    instructions: parseInstructions(recipe.directions),
    photoBase64: recipe.photo_data || undefined,
    categories: recipe.categories || undefined,
  }
}

function isGzipped(buffer: Buffer): boolean {
  // Gzip magic number: 1f 8b
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

async function decompressGzip(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const gunzip = createGunzip()

    gunzip.on('data', (chunk: Buffer) => chunks.push(chunk))
    gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    gunzip.on('error', reject)

    const readable = Readable.from(buffer)
    readable.pipe(gunzip)
  })
}

function parseServings(servings: string | undefined): number | undefined {
  if (!servings) return undefined

  // Try to extract a number
  const match = servings.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : undefined
}

function parseTime(time: string | undefined): number | undefined {
  if (!time) return undefined

  // Paprika stores time as strings like "30 minutes", "1 hour 30 minutes", etc.
  let totalMinutes = 0

  // Match hours
  const hourMatch = time.match(/(\d+)\s*(?:hour|hr|h)/i)
  if (hourMatch) {
    totalMinutes += parseInt(hourMatch[1], 10) * 60
  }

  // Match minutes
  const minMatch = time.match(/(\d+)\s*(?:minute|min|m(?!onth))/i)
  if (minMatch) {
    totalMinutes += parseInt(minMatch[1], 10)
  }

  // If no units matched, try just a number (assume minutes)
  if (totalMinutes === 0) {
    const plainMatch = time.match(/^(\d+)$/)
    if (plainMatch) {
      totalMinutes = parseInt(plainMatch[1], 10)
    }
  }

  return totalMinutes > 0 ? totalMinutes : undefined
}

function parseIngredients(ingredients: string | undefined): string[] {
  if (!ingredients) return []

  // Paprika stores ingredients as newline-separated text
  return ingredients
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#')) // Filter empty lines and headers
}

function parseInstructions(directions: string | undefined): string[] {
  if (!directions) return []

  // Paprika stores instructions as newline-separated text
  // Some may be numbered (1. First step) or not
  const lines = directions.split(/\n+/).map(line => line.trim()).filter(Boolean)

  // Remove leading numbers and dots
  return lines.map(line => line.replace(/^\d+\.\s*/, ''))
}

/**
 * Deduplicate recipes by name (case-insensitive)
 */
export function deduplicateRecipes(
  newRecipes: ImportedRecipe[],
  existingNames: string[]
): { unique: ImportedRecipe[]; duplicates: ImportedRecipe[] } {
  const existingNamesLower = new Set(existingNames.map(n => n.toLowerCase()))
  const seenNames = new Set<string>()

  const unique: ImportedRecipe[] = []
  const duplicates: ImportedRecipe[] = []

  for (const recipe of newRecipes) {
    const nameLower = recipe.name.toLowerCase()

    if (existingNamesLower.has(nameLower) || seenNames.has(nameLower)) {
      duplicates.push(recipe)
    } else {
      unique.push(recipe)
      seenNames.add(nameLower)
    }
  }

  return { unique, duplicates }
}

export type { PaprikaRecipe, ImportedRecipe }
