import * as cheerio from 'cheerio'

interface ScrapedRecipe {
  name: string
  description?: string
  servings?: number
  cookTimeMinutes?: number
  prepTimeMinutes?: number
  totalTimeMinutes?: number
  ingredients: string[]
  instructions: string[]
  image?: string
  source: string
}

interface ScrapeOptions {
  cookie?: string
  extraHeaders?: Record<string, string>
}

/**
 * Scrape recipe data from a URL
 * Supports schema.org/Recipe JSON-LD markup and common recipe site patterns
 */
export async function scrapeRecipeFromUrl(url: string, options: ScrapeOptions = {}): Promise<ScrapedRecipe> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; MealPlannerBot/1.0)',
    'Accept': 'text/html,application/xhtml+xml',
    ...options.extraHeaders,
  }

  if (options.cookie) {
    headers.Cookie = options.cookie
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  // Try to find JSON-LD schema.org Recipe data first (most reliable)
  const jsonLdRecipe = extractJsonLdRecipe($)
  if (jsonLdRecipe) {
    return { ...jsonLdRecipe, source: url }
  }

  // Fall back to microdata extraction
  const microdataRecipe = extractMicrodataRecipe($)
  if (microdataRecipe) {
    return { ...microdataRecipe, source: url }
  }

  // Fall back to common HTML patterns
  return extractFromHtmlPatterns($, url)
}

function extractJsonLdRecipe($: cheerio.CheerioAPI): Omit<ScrapedRecipe, 'source'> | null {
  const scripts = $('script[type="application/ld+json"]')

  for (let i = 0; i < scripts.length; i++) {
    try {
      const content = $(scripts[i]).html()
      if (!content) continue

      const data = JSON.parse(content)

      // Handle @graph structure
      const recipes = data['@graph']
        ? data['@graph'].filter((item: Record<string, unknown>) => item['@type'] === 'Recipe')
        : [data]

      for (const recipe of recipes) {
        if (recipe['@type'] === 'Recipe' || recipe['@type']?.includes?.('Recipe')) {
          return parseJsonLdRecipe(recipe)
        }
      }
    } catch {
      // Continue to next script tag
    }
  }

  return null
}

function parseJsonLdRecipe(recipe: Record<string, unknown>): Omit<ScrapedRecipe, 'source'> {
  const ingredients = normalizeIngredients(recipe.recipeIngredient as string[] | undefined)
  const instructions = normalizeInstructions(recipe.recipeInstructions)

  return {
    name: String(recipe.name || 'Untitled Recipe'),
    description: recipe.description ? String(recipe.description) : undefined,
    servings: parseServings(recipe.recipeYield),
    cookTimeMinutes: parseDuration(recipe.cookTime as string | undefined),
    prepTimeMinutes: parseDuration(recipe.prepTime as string | undefined),
    totalTimeMinutes: parseDuration(recipe.totalTime as string | undefined),
    ingredients,
    instructions,
    image: parseImage(recipe.image),
  }
}

function extractMicrodataRecipe($: cheerio.CheerioAPI): Omit<ScrapedRecipe, 'source'> | null {
  const recipeElement = $('[itemtype*="schema.org/Recipe"]')
  if (!recipeElement.length) return null

  const name = recipeElement.find('[itemprop="name"]').first().text().trim()
  if (!name) return null

  const ingredients: string[] = []
  recipeElement.find('[itemprop="recipeIngredient"], [itemprop="ingredients"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text) ingredients.push(text)
  })

  const instructions: string[] = []
  recipeElement.find('[itemprop="recipeInstructions"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text) instructions.push(text)
  })

  return {
    name,
    description: recipeElement.find('[itemprop="description"]').first().text().trim() || undefined,
    servings: parseServings(recipeElement.find('[itemprop="recipeYield"]').first().text()),
    cookTimeMinutes: parseDuration(recipeElement.find('[itemprop="cookTime"]').attr('datetime')),
    prepTimeMinutes: parseDuration(recipeElement.find('[itemprop="prepTime"]').attr('datetime')),
    totalTimeMinutes: parseDuration(recipeElement.find('[itemprop="totalTime"]').attr('datetime')),
    ingredients,
    instructions,
    image: recipeElement.find('[itemprop="image"]').attr('src') || undefined,
  }
}

function extractFromHtmlPatterns($: cheerio.CheerioAPI, url: string): ScrapedRecipe {
  // Try common class names and patterns
  const name = $('h1').first().text().trim() ||
    $('.recipe-title, .recipe-name, [class*="recipe-title"]').first().text().trim() ||
    $('title').text().trim()

  const ingredients: string[] = []
  const ingredientSelectors = [
    '.ingredients li',
    '.recipe-ingredients li',
    '[class*="ingredient"] li',
    '.ingredient-list li',
    'ul.ingredients li',
  ]

  for (const selector of ingredientSelectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim()
      if (text && !ingredients.includes(text)) {
        ingredients.push(text)
      }
    })
    if (ingredients.length > 0) break
  }

  const instructions: string[] = []
  const instructionSelectors = [
    '.instructions li',
    '.recipe-instructions li',
    '.directions li',
    '[class*="instruction"] li',
    '.steps li',
    '.recipe-steps li',
  ]

  for (const selector of instructionSelectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim()
      if (text && !instructions.includes(text)) {
        instructions.push(text)
      }
    })
    if (instructions.length > 0) break
  }

  // If still no instructions, try paragraphs in instruction sections
  if (instructions.length === 0) {
    $('.instructions p, .directions p, .recipe-instructions p').each((_, el) => {
      const text = $(el).text().trim()
      if (text) instructions.push(text)
    })
  }

  return {
    name: name || 'Untitled Recipe',
    description: $('meta[name="description"]').attr('content') || undefined,
    ingredients,
    instructions,
    image: $('meta[property="og:image"]').attr('content') || undefined,
    source: url,
  }
}

function normalizeIngredients(ingredients: string[] | undefined): string[] {
  if (!ingredients) return []
  return ingredients.map(i => String(i).trim()).filter(Boolean)
}

function normalizeInstructions(instructions: unknown): string[] {
  if (!instructions) return []

  if (typeof instructions === 'string') {
    return instructions.split(/\n+/).map(s => s.trim()).filter(Boolean)
  }

  if (Array.isArray(instructions)) {
    return instructions.map(inst => {
      if (typeof inst === 'string') return inst.trim()
      if (inst && typeof inst === 'object') {
        // Handle HowToStep objects
        const step = inst as Record<string, unknown>
        return String(step.text || step.name || '').trim()
      }
      return ''
    }).filter(Boolean)
  }

  return []
}

function parseServings(yield_: unknown): number | undefined {
  if (!yield_) return undefined

  const yieldStr = Array.isArray(yield_) ? yield_[0] : String(yield_)
  const match = yieldStr.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : undefined
}

function parseDuration(duration: string | undefined): number | undefined {
  if (!duration) return undefined

  // ISO 8601 duration format: PT30M, PT1H30M, etc.
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
  if (match) {
    const hours = parseInt(match[1] || '0', 10)
    const minutes = parseInt(match[2] || '0', 10)
    return hours * 60 + minutes
  }

  // Try plain number (assume minutes)
  const plainMatch = duration.match(/(\d+)/)
  return plainMatch ? parseInt(plainMatch[1], 10) : undefined
}

function parseImage(image: unknown): string | undefined {
  if (!image) return undefined
  if (typeof image === 'string') return image
  if (Array.isArray(image)) return image[0] as string
  if (typeof image === 'object' && image !== null) {
    const img = image as Record<string, unknown>
    return img.url as string | undefined
  }
  return undefined
}

export type { ScrapedRecipe }
