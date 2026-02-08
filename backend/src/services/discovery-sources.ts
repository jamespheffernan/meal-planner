import type { PrismaClient } from '@prisma/client'

export type DiscoverySourceInput = {
  host: string
  displayName?: string | null
  enabled?: boolean
  sitemapUrls?: string[]
  rssUrls?: string[]
  weight?: number | null
}

export const DEFAULT_SOURCES: DiscoverySourceInput[] = [
  {
    host: 'cooking.nytimes.com',
    displayName: 'NYT Cooking',
    enabled: true,
    sitemapUrls: ['https://cooking.nytimes.com/sitemap.xml'],
    rssUrls: ['https://cooking.nytimes.com/rss/recipes.xml'],
  },
  {
    host: 'www.seriouseats.com',
    displayName: 'Serious Eats',
    enabled: true,
    sitemapUrls: ['https://www.seriouseats.com/sitemap.xml'],
  },
  {
    host: 'food52.com',
    displayName: 'Food52',
    enabled: true,
    sitemapUrls: ['https://food52.com/sitemap.xml'],
  },
  {
    host: 'www.bonappetit.com',
    displayName: 'Bon Appetit',
    enabled: true,
    sitemapUrls: ['https://www.bonappetit.com/sitemap.xml'],
  },
  {
    host: 'www.bbcgoodfood.com',
    displayName: 'BBC Good Food',
    enabled: true,
    sitemapUrls: ['https://www.bbcgoodfood.com/sitemap.xml'],
  },
  {
    host: 'www.allrecipes.com',
    displayName: 'Allrecipes',
    enabled: true,
    sitemapUrls: ['https://www.allrecipes.com/sitemap.xml'],
  },
  {
    host: 'www.simplyrecipes.com',
    displayName: 'Simply Recipes',
    enabled: true,
    sitemapUrls: ['https://www.simplyrecipes.com/sitemap.xml'],
  },
  {
    host: 'www.epicurious.com',
    displayName: 'Epicurious',
    enabled: true,
    sitemapUrls: ['https://www.epicurious.com/sitemap.xml'],
  },
]

export async function getDiscoverySources(prisma: PrismaClient) {
  const model = (prisma as any).discoverySource
  if (!model?.findMany) {
    return DEFAULT_SOURCES.map((source, idx) => ({
      id: `default-${idx}`,
      host: source.host,
      displayName: source.displayName || source.host.replace(/^www\./, ''),
      enabled: source.enabled ?? true,
      sitemapUrls: source.sitemapUrls || [],
      rssUrls: source.rssUrls || [],
      weight: source.weight ?? 1,
      isDefault: true,
    }))
  }

  const sources = await model.findMany({
    orderBy: { host: 'asc' },
  })
  if (sources.length > 0) return sources

  // If none configured, return defaults (not persisted yet)
  return DEFAULT_SOURCES.map((source, idx) => ({
    id: `default-${idx}`,
    host: source.host,
    displayName: source.displayName || source.host.replace(/^www\./, ''),
    enabled: source.enabled ?? true,
    sitemapUrls: source.sitemapUrls || [],
    rssUrls: source.rssUrls || [],
    weight: source.weight ?? 1,
    isDefault: true,
  }))
}

export async function saveDiscoverySources(prisma: PrismaClient, sources: DiscoverySourceInput[]) {
  const model = (prisma as any).discoverySource
  if (!model?.createMany) {
    throw new Error('Discovery sources table not available. Run prisma db:push and prisma generate.')
  }

  const cleaned = sources
    .map(source => ({
      host: source.host.trim(),
      displayName: source.displayName?.trim() || null,
      enabled: source.enabled ?? true,
      sitemapUrls: (source.sitemapUrls || []).map(s => s.trim()).filter(Boolean),
      rssUrls: (source.rssUrls || []).map(s => s.trim()).filter(Boolean),
      weight: source.weight ?? 1,
    }))
    .filter(source => source.host)

  await prisma.$transaction(async (tx) => {
    await tx.discoverySource.deleteMany({})
    if (cleaned.length > 0) {
      await tx.discoverySource.createMany({
        data: cleaned.map(source => ({
          host: source.host,
          displayName: source.displayName,
          enabled: source.enabled,
          sitemapUrls: source.sitemapUrls,
          rssUrls: source.rssUrls,
          weight: source.weight ?? 1,
        })),
      })
    }
  })
}
