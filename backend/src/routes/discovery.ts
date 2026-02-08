import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { MealType, CandidateStatus } from '@prisma/client'
import { scrapeRecipeFromUrl } from '../services/recipe-scraper.js'
import { normalizeIngredientName } from '../services/ingredient-normalizer.js'
import { parseIngredientString } from '../services/ingredient-parser.js'
import { getRecipeAuthCookie } from '../services/recipe-auth.js'
import { getDiscoverySources, saveDiscoverySources } from '../services/discovery-sources.js'

type DiscoverySourceConfig = {
  host: string
  displayName?: string | null
  enabled: boolean
  sitemapUrls?: string[]
  rssUrls?: string[]
  weight?: number
}

interface DiscoverySearchBody {
  query: string
  limit?: number
  mealType?: MealType
  maxTimeMinutes?: number
  sources?: string[]
}

interface CandidateStatusBody {
  status: 'approved' | 'rejected'
}

interface BulkStatusBody {
  ids: string[]
  status: 'approved' | 'rejected'
}

export default async function discoveryRoutes(fastify: FastifyInstance) {
  fastify.get('/sources', async () => {
    const sources = await getDiscoverySources(fastify.prisma)
    return { sources }
  })

  fastify.put('/sources', async (request: FastifyRequest<{ Body: { sources: Array<{ host: string; displayName?: string; enabled?: boolean; sitemapUrls?: string[]; rssUrls?: string[]; weight?: number }> } }>, reply) => {
    const sources = request.body?.sources || []
    if (!Array.isArray(sources)) {
      return reply.badRequest('sources array is required')
    }

    await saveDiscoverySources(fastify.prisma, sources)
    return { success: true }
  })

  fastify.post('/search', async (request: FastifyRequest<{ Body: DiscoverySearchBody }>, reply) => {
    if (!(fastify.prisma as any).recipeDiscoveryBatch || !(fastify.prisma as any).recipeCandidate) {
      return reply.internalServerError('Discovery tables not available. Run prisma db:push and prisma generate.')
    }
    const {
      query,
      limit = 20,
      mealType,
      maxTimeMinutes,
      sources,
    } = request.body

    if (!query || !query.trim()) {
      return reply.badRequest('query is required')
    }

    const configuredSources = (await getDiscoverySources(fastify.prisma)) as DiscoverySourceConfig[]
    const sourceOverrides = (sources && sources.length > 0 ? sources : [])
      .map(s => s.trim())
      .filter(Boolean)
    const activeSources = sourceOverrides.length > 0
      ? configuredSources.filter(source => sourceOverrides.includes(source.host))
      : configuredSources.filter(source => source.enabled)

    if (activeSources.length === 0) {
      return reply.badRequest('No enabled sources configured')
    }

    const sourceHostSet = new Set(activeSources.map(source => source.host.replace(/^www\./, '')))

    const terms = buildKeywordTerms(query)

    const scoredResults: ScoredUrl[] = []
    for (const source of activeSources) {
      const weight = source.weight ?? 1
      const sitemapUrls = source.sitemapUrls || []
      const rssUrls = source.rssUrls || []

      for (const sitemapUrl of sitemapUrls) {
        try {
          const urls = await fetchSitemapUrls(sitemapUrl, 400)
          urls.forEach(url => {
            const score = scoreKeywordMatch(url, '', '', terms) * weight
            scoredResults.push({ url, score, sourceHost: source.host })
          })
        } catch {
          // Skip sitemap failures
        }
      }

      for (const rssUrl of rssUrls) {
        try {
          const items = await fetchRssItems(rssUrl, 200)
          items.forEach(item => {
            const score = scoreKeywordMatch(item.link, item.title, item.description, terms) * weight
            scoredResults.push({ url: item.link, score, sourceHost: source.host })
          })
        } catch {
          // Skip RSS failures
        }
      }
    }

    const deduped = new Map<string, ScoredUrl>()
    for (const result of scoredResults) {
      const normalized = normalizeUrl(result.url)
      if (!normalized) continue
      const existing = deduped.get(normalized)
      if (!existing || result.score > existing.score) {
        deduped.set(normalized, { ...result, url: normalized })
      }
    }

    const filtered = Array.from(deduped.values()).filter(result => {
      const host = safeHost(result.url)
      const normalizedHost = host ? host.replace(/^www\./, '') : null
      return normalizedHost ? sourceHostSet.has(normalizedHost) : false
    })
    filtered.sort((a, b) => b.score - a.score)
    const limited = filtered.slice(0, limit)

    const existingRecipes = await fastify.prisma.recipe.findMany({
      where: { source: { in: limited.map(item => item.url) } },
      select: { source: true },
    })
    const existingCandidates = await fastify.prisma.recipeCandidate.findMany({
      where: { sourceUrl: { in: limited.map(item => item.url) } },
      select: { sourceUrl: true },
    })
    const existingSet = new Set([
      ...existingRecipes.map(r => r.source).filter(Boolean) as string[],
      ...existingCandidates.map(c => c.sourceUrl),
    ])

    const toProcess = limited.filter(item => !existingSet.has(item.url))

    const batch = await fastify.prisma.recipeDiscoveryBatch.create({
      data: {
        query: query.trim(),
        mealType,
        maxTimeMinutes,
        sources: activeSources.map(source => source.host),
      },
    })

    const errors: Array<{ url: string; error: string }> = []
    let createdCount = 0

    await runWithConcurrency(toProcess, 4, async (item) => {
      const url = item.url
      try {
        const host = safeHost(url)
        const normalizedHost = host ? host.replace(/^www\./, '') : null
        const authCookie = host ? await getRecipeAuthCookie(fastify.prisma, host) : null
        const scraped = await scrapeRecipeFromUrl(url, authCookie ? { cookie: authCookie } : undefined)
        const totalTime = scraped.totalTimeMinutes ||
          ((scraped.cookTimeMinutes || 0) + (scraped.prepTimeMinutes || 0)) ||
          undefined

        if (maxTimeMinutes && totalTime && totalTime > maxTimeMinutes) {
          return
        }

        await fastify.prisma.recipeCandidate.create({
          data: {
            batchId: batch.id,
            sourceUrl: url,
            sourceName: normalizedHost
              ? (activeSources.find(source => source.host.replace(/^www\./, '') === normalizedHost)?.displayName || normalizedHost)
              : 'Unknown',
            name: scraped.name,
            description: scraped.description,
            imageUrl: extractImageUrl(scraped.image),
            servings: scraped.servings,
            cookTimeMinutes: scraped.cookTimeMinutes,
            prepTimeMinutes: scraped.prepTimeMinutes,
            totalTimeMinutes: totalTime,
            ingredients: scraped.ingredients || [],
            instructions: scraped.instructions || [],
            status: 'pending',
          },
        })
        createdCount += 1
      } catch (error) {
        errors.push({ url, error: String(error) })
      }
    })

    return {
      batchId: batch.id,
      createdCount,
      skippedDuplicates: limited.length - toProcess.length,
      errors: errors.length > 0 ? errors : undefined,
    }
  })

  fastify.get('/batches/:id/candidates', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { status?: CandidateStatus } }>) => {
    const { id } = request.params
    const status = request.query.status

    const candidates = await fastify.prisma.recipeCandidate.findMany({
      where: {
        batchId: id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'asc' },
    })

    if (candidates.length === 0) {
      return { candidates: [] }
    }

    const pantryItems = await fastify.prisma.pantryInventory.findMany({
      where: { status: { not: 'depleted' } },
      include: { ingredient: true },
    })
    const pantrySet = new Set(
      pantryItems.map(item => normalizeIngredientName(item.ingredient.name))
    )

    const allNames = new Set<string>()
    for (const candidate of candidates) {
      candidate.ingredients.forEach(ing => {
        const normalized = normalizeIngredientName(ing)
        if (normalized) allNames.add(normalized)
      })
    }

    const ingredientRecords = await fastify.prisma.ingredient.findMany({
      where: { name: { in: Array.from(allNames) } },
      select: { id: true, name: true },
    })
    const ingredientIdByName = new Map(ingredientRecords.map(r => [r.name, r.id]))
    const ingredientIds = ingredientRecords.map(r => r.id)

    const usageCounts = ingredientIds.length > 0
      ? await fastify.prisma.recipeIngredient.groupBy({
        by: ['ingredientId'],
        _count: { _all: true },
        where: { ingredientId: { in: ingredientIds } },
      })
      : []

    const usageById = new Map<string, number>(
      usageCounts.map(u => [u.ingredientId, u._count._all])
    )

    const enriched = candidates.map(candidate => {
      const ingredientCount = candidate.ingredients.length
      const pantryMatchNames: string[] = []
      const pantryMatchSet = new Set<string>()
      const unusualIngredients: string[] = []
      const unusualSet = new Set<string>()

      for (const ing of candidate.ingredients) {
        const normalized = normalizeIngredientName(ing)
        if (!normalized) continue

        if (pantrySet.has(normalized)) {
          if (!pantryMatchSet.has(normalized)) {
            pantryMatchSet.add(normalized)
            if (pantryMatchNames.length < 5) pantryMatchNames.push(ing)
          }
          continue
        }

        const ingredientId = ingredientIdByName.get(normalized)
        const usage = ingredientId ? (usageById.get(ingredientId) || 0) : 0
        if (!ingredientId || usage < 3) {
          if (!unusualSet.has(normalized)) {
            unusualSet.add(normalized)
            if (unusualIngredients.length < 5) unusualIngredients.push(ing)
          }
        }
      }

      const pantryMatchCount = pantryMatchSet.size

      const reasons: string[] = ['Matches theme']
      if (pantryMatchCount >= 2) reasons.push(`Uses ${pantryMatchCount} pantry items`)
      const timeValue = candidate.totalTimeMinutes || candidate.cookTimeMinutes
      if (timeValue && timeValue <= 30) reasons.push('Quick (<30 min)')
      if (ingredientCount <= 7) reasons.push('Few ingredients')
      if (unusualIngredients.length > 0) reasons.push('Includes unusual ingredients')

      return {
        ...candidate,
        insights: {
          ingredientCount,
          pantryMatchCount,
          pantryMatchNames,
          unusualIngredients,
          reasons,
        },
      }
    })

    return { candidates: enriched }
  })

  fastify.patch('/candidates/:id/status', async (request: FastifyRequest<{ Params: { id: string }; Body: CandidateStatusBody }>, reply) => {
    const { id } = request.params
    const { status } = request.body

    if (status !== 'approved' && status !== 'rejected') {
      return reply.badRequest('status must be approved or rejected')
    }

    const candidate = await fastify.prisma.recipeCandidate.findUnique({
      where: { id },
      include: { batch: true },
    })

    if (!candidate) {
      return reply.notFound('Candidate not found')
    }

    if (status === 'rejected') {
      await fastify.prisma.recipeCandidate.update({
        where: { id },
        data: { status: 'rejected' },
      })
      return { success: true }
    }

    const mealType = candidate.batch.mealType || inferMealType(candidate.batch.query)
    const recipe = await createRecipeFromCandidate(fastify, candidate, mealType)

    await fastify.prisma.recipeCandidate.update({
      where: { id },
      data: {
        status: 'imported',
        recipeId: recipe.id,
      },
    })

    return { success: true, recipeId: recipe.id }
  })

  fastify.post('/candidates/bulk', async (request: FastifyRequest<{ Body: BulkStatusBody }>, reply) => {
    const { ids, status } = request.body

    if (!ids || ids.length === 0) {
      return reply.badRequest('ids array is required')
    }
    if (status !== 'approved' && status !== 'rejected') {
      return reply.badRequest('status must be approved or rejected')
    }

    const candidates = await fastify.prisma.recipeCandidate.findMany({
      where: { id: { in: ids } },
      include: { batch: true },
    })

    let updated = 0
    let createdRecipes = 0

    for (const candidate of candidates) {
      if (status === 'rejected') {
        await fastify.prisma.recipeCandidate.update({
          where: { id: candidate.id },
          data: { status: 'rejected' },
        })
        updated += 1
        continue
      }

      const mealType = candidate.batch.mealType || inferMealType(candidate.batch.query)
      const recipe = await createRecipeFromCandidate(fastify, candidate, mealType)
      await fastify.prisma.recipeCandidate.update({
        where: { id: candidate.id },
        data: { status: 'imported', recipeId: recipe.id },
      })
      updated += 1
      createdRecipes += 1
    }

    return { success: true, updated, createdRecipes }
  })
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    const base = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
    return base.replace(/\/+$/, '')
  } catch {
    return null
  }
}

type ScoredUrl = { url: string; score: number; sourceHost: string }

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'you', 'your', 'our', 'ours',
  'recipe', 'recipes', 'dish', 'meal', 'easy', 'quick', 'best', 'simple', 'fast',
  'how', 'to', 'a', 'an', 'of', 'in', 'on', 'at', 'by', 'or', 'as', 'is', 'it',
])

function buildKeywordTerms(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\\s-]/g, ' ')
    .split(/\\s+/)
    .map(term => term.trim())
    .filter(term => term.length > 2 && !STOPWORDS.has(term))
}

function scoreKeywordMatch(url: string, title: string, description: string, terms: string[]) {
  if (terms.length === 0) return 0
  const urlText = url.toLowerCase()
  const titleText = (title || '').toLowerCase()
  const descText = (description || '').toLowerCase()

  let score = 0
  for (const term of terms) {
    if (urlText.includes(term)) score += 2
    if (titleText.includes(term)) score += 3
    if (descText.includes(term)) score += 1
  }
  return score
}

function extractImageUrl(image: unknown): string | undefined {
  if (!image) return undefined
  if (typeof image === 'string') return image
  if (typeof image === 'object' && image !== null) {
    const imgObj = image as Record<string, unknown>
    if (imgObj.url && typeof imgObj.url === 'string') return imgObj.url
    if (Array.isArray(image) && image.length > 0) {
      return extractImageUrl(image[0])
    }
  }
  return undefined
}

function inferMealType(query: string): MealType {
  const lower = query.toLowerCase()
  if (lower.includes('breakfast') || lower.includes('brunch')) return 'breakfast'
  if (lower.includes('lunch')) return 'lunch'
  if (lower.includes('snack')) return 'snack'
  return 'dinner'
}

async function createRecipeFromCandidate(
  fastify: FastifyInstance,
  candidate: {
    name: string
    description: string | null
    sourceUrl: string
    servings: number | null
    cookTimeMinutes: number | null
    prepTimeMinutes: number | null
    totalTimeMinutes: number | null
    ingredients: string[]
    instructions: string[]
    imageUrl: string | null
  },
  mealType: MealType
) {
  const ingredientRecords = []
  for (const ingStr of candidate.ingredients) {
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

  const cookTime = candidate.cookTimeMinutes || 30
  const prepTime = candidate.prepTimeMinutes || 0
  const totalTime = candidate.totalTimeMinutes || (cookTime + prepTime)

  return fastify.prisma.recipe.create({
    data: {
      name: candidate.name,
      description: candidate.description || undefined,
      source: candidate.sourceUrl,
      servings: candidate.servings || 4,
      cookTimeMinutes: cookTime,
      prepTimeMinutes: candidate.prepTimeMinutes || undefined,
      totalTimeMinutes: totalTime,
      mealType,
      cookingStyle: 'quick_weeknight',
      photoUrl: candidate.imageUrl || undefined,
      approvalStatus: 'approved',
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
        create: candidate.instructions.map((text, index) => ({
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

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function runNext() {
    const current = nextIndex
    if (current >= items.length) return
    nextIndex += 1
    results[current] = await worker(items[current], current)
    await runNext()
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext())
  await Promise.all(runners)
  return results
}

async function fetchSitemapUrls(sitemapUrl: string, maxUrls: number): Promise<string[]> {
  const queue = [sitemapUrl]
  const seen = new Set<string>()
  const urls: string[] = []
  let depth = 0

  while (queue.length > 0 && urls.length < maxUrls && depth < 2) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)

    const response = await fetch(current, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MealPlannerBot/1.0)',
        'Accept': 'application/xml,text/xml,application/xhtml+xml',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap: ${response.status}`)
    }

    const xml = await response.text()
    const locs = extractLocs(xml)

    if (isSitemapIndex(xml)) {
      queue.push(...locs)
      depth += 1
    } else {
      for (const loc of locs) {
        if (urls.length >= maxUrls) break
        urls.push(loc)
      }
    }
  }

  return urls
}

function extractLocs(xml: string): string[] {
  const locs: string[] = []
  const regex = /<loc>([^<]+)<\/loc>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    const raw = match[1].trim()
    if (!raw) continue
    locs.push(decodeXmlEntities(raw))
  }
  return locs
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml)
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

async function fetchRssItems(rssUrl: string, maxItems: number) {
  const response = await fetch(rssUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MealPlannerBot/1.0)',
      'Accept': 'application/rss+xml,application/atom+xml,application/xml,text/xml',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch RSS: ${response.status}`)
  }

  const xml = await response.text()

  const items: Array<{ link: string; title: string; description: string }> = []

  // RSS <item>
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1]
    const link = extractTag(block, 'link')
    if (!link) continue
    items.push({
      link,
      title: extractTag(block, 'title') || '',
      description: extractTag(block, 'description') || '',
    })
  }

  // Atom <entry>
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi
  while ((match = entryRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1]
    const link = extractAtomLink(block)
    if (!link) continue
    items.push({
      link,
      title: extractTag(block, 'title') || '',
      description: extractTag(block, 'summary') || extractTag(block, 'content') || '',
    })
  }

  return items
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')
  const match = xml.match(regex)
  if (!match) return null
  return decodeXmlEntities(match[1].replace(/<!\\[CDATA\\[|\\]\\]>/g, '').trim())
}

function extractAtomLink(xml: string): string | null {
  const hrefMatch = xml.match(new RegExp("<link[^>]*href=['\\\"]([^'\\\"]+)['\\\"][^>]*\\\\/?>", 'i'))
  if (hrefMatch) return hrefMatch[1].trim()
  return extractTag(xml, 'link')
}
