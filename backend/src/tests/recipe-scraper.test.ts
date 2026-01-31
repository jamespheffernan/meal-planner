import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Import after mocking
const { scrapeRecipeFromUrl } = await import('../services/recipe-scraper.js')

describe('Recipe Scraper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should parse JSON-LD recipe from HTML', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "Recipe",
          "name": "Chocolate Chip Cookies",
          "description": "Delicious homemade cookies",
          "recipeYield": "24 cookies",
          "cookTime": "PT12M",
          "prepTime": "PT15M",
          "recipeIngredient": [
            "2 cups flour",
            "1 cup sugar",
            "1 cup chocolate chips"
          ],
          "recipeInstructions": [
            {"@type": "HowToStep", "text": "Preheat oven to 350°F"},
            {"@type": "HowToStep", "text": "Mix dry ingredients"},
            {"@type": "HowToStep", "text": "Bake for 12 minutes"}
          ],
          "image": "https://example.com/cookies.jpg"
        }
        </script>
      </head>
      <body></body>
      </html>
    `

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    })

    const result = await scrapeRecipeFromUrl('https://example.com/recipe')

    expect(result.name).toBe('Chocolate Chip Cookies')
    expect(result.description).toBe('Delicious homemade cookies')
    expect(result.servings).toBe(24)
    expect(result.cookTimeMinutes).toBe(12)
    expect(result.prepTimeMinutes).toBe(15)
    expect(result.ingredients).toHaveLength(3)
    expect(result.instructions).toHaveLength(3)
    expect(result.image).toBe('https://example.com/cookies.jpg')
    expect(result.source).toBe('https://example.com/recipe')
  })

  it('should parse recipe with @graph structure', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebPage",
              "name": "Recipe Page"
            },
            {
              "@type": "Recipe",
              "name": "Pasta Carbonara",
              "recipeYield": "4 servings",
              "cookTime": "PT20M",
              "recipeIngredient": ["pasta", "eggs", "bacon"],
              "recipeInstructions": ["Cook pasta", "Mix eggs", "Combine"]
            }
          ]
        }
        </script>
      </head>
      <body></body>
      </html>
    `

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    })

    const result = await scrapeRecipeFromUrl('https://example.com/pasta')

    expect(result.name).toBe('Pasta Carbonara')
    expect(result.servings).toBe(4)
    expect(result.cookTimeMinutes).toBe(20)
  })

  it('should fall back to HTML patterns when no JSON-LD', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="description" content="A tasty recipe">
        <meta property="og:image" content="https://example.com/image.jpg">
      </head>
      <body>
        <h1>Simple Salad</h1>
        <ul class="ingredients">
          <li>Lettuce</li>
          <li>Tomatoes</li>
          <li>Dressing</li>
        </ul>
        <ol class="instructions">
          <li>Wash vegetables</li>
          <li>Chop and mix</li>
          <li>Add dressing</li>
        </ol>
      </body>
      </html>
    `

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    })

    const result = await scrapeRecipeFromUrl('https://example.com/salad')

    expect(result.name).toBe('Simple Salad')
    expect(result.description).toBe('A tasty recipe')
    expect(result.ingredients).toHaveLength(3)
    expect(result.instructions).toHaveLength(3)
    expect(result.image).toBe('https://example.com/image.jpg')
  })

  it('should handle failed fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    })

    await expect(scrapeRecipeFromUrl('https://example.com/404')).rejects.toThrow(
      'Failed to fetch URL: 404'
    )
  })

  it('should parse ISO 8601 durations correctly', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script type="application/ld+json">
        {
          "@type": "Recipe",
          "name": "Long Recipe",
          "cookTime": "PT1H30M",
          "prepTime": "PT45M",
          "recipeIngredient": ["ingredient"],
          "recipeInstructions": ["step"]
        }
        </script>
      </head>
      <body></body>
      </html>
    `

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    })

    const result = await scrapeRecipeFromUrl('https://example.com/long')

    expect(result.cookTimeMinutes).toBe(90) // 1h30m = 90 minutes
    expect(result.prepTimeMinutes).toBe(45)
  })
})
