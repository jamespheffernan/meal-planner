import { describe, it, expect, vi, beforeEach } from 'vitest'

// Create mock prisma client
const mockPrisma = {
  userPreferences: {
    findFirst: vi.fn(),
  },
  recipe: {
    findMany: vi.fn(),
  },
  pantryInventory: {
    findMany: vi.fn(),
  },
}

// Mock the prisma module
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}))

const { RecommendationEngine } = await import('../services/recommendation-engine.js')

describe('Recommendation Engine', () => {
  let engine: InstanceType<typeof RecommendationEngine>

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new RecommendationEngine(mockPrisma as any)
  })

  describe('Variety Score', () => {
    it('should give max score to never-cooked recipes', async () => {
      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([])
      mockPrisma.recipe.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'New Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 30,
          totalTimeMinutes: 30,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [],
        },
      ])

      const results = await engine.getRecommendations({ limit: 1 })

      expect(results).toHaveLength(1)
      expect(results[0].scores.variety).toBe(100)
    })

    it('should penalize recently cooked recipes', async () => {
      const twoDaysAgo = new Date()
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([])
      mockPrisma.recipe.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'Recent Recipe',
          approvalStatus: 'approved',
          lastCookedDate: twoDaysAgo,
          cookTimeMinutes: 30,
          totalTimeMinutes: 30,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [],
        },
      ])

      const results = await engine.getRecommendations({ limit: 1 })

      expect(results[0].scores.variety).toBe(0) // Cooked in last 3 days
    })
  })

  describe('Expiration Score', () => {
    it('should prioritize recipes using expiring ingredients', async () => {
      const expirationDate = new Date()
      expirationDate.setDate(expirationDate.getDate() + 3)

      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([
        { ingredientId: 'ing-1', status: 'stocked', expirationDate },
      ])
      mockPrisma.recipe.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'Uses Expiring',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 30,
          totalTimeMinutes: 30,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [{ ingredientId: 'ing-1' }],
          cookingHistory: [],
        },
        {
          id: '2',
          name: 'No Expiring',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 30,
          totalTimeMinutes: 30,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [{ ingredientId: 'ing-2' }],
          cookingHistory: [],
        },
      ])

      const results = await engine.getRecommendations({ limit: 2 })

      // Recipe using expiring ingredient should have higher expiration score
      const usesExpiring = results.find(r => r.recipe.id === '1')
      const noExpiring = results.find(r => r.recipe.id === '2')

      expect(usesExpiring!.scores.expiration).toBeGreaterThan(noExpiring!.scores.expiration)
    })
  })

  describe('Time Score', () => {
    it('should prefer quick recipes on weekdays', async () => {
      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([])
      mockPrisma.recipe.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'Quick Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 20,
          totalTimeMinutes: 25,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [],
        },
        {
          id: '2',
          name: 'Long Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 90,
          totalTimeMinutes: 120,
          cookingStyle: 'special_occasion',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [],
        },
      ])

      // Monday = weekday (1)
      const results = await engine.getRecommendations({ dayOfWeek: 1 })

      const quick = results.find(r => r.recipe.id === '1')
      const long = results.find(r => r.recipe.id === '2')

      expect(quick!.scores.time).toBeGreaterThan(long!.scores.time)
    })

    it('should prefer batch cooking on weekends', async () => {
      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([])
      mockPrisma.recipe.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'Quick Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 20,
          totalTimeMinutes: 25,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [],
        },
        {
          id: '2',
          name: 'Batch Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 60,
          totalTimeMinutes: 90,
          cookingStyle: 'batch_cook',
          servings: 8,
          recipeIngredients: [],
          cookingHistory: [],
        },
      ])

      // Sunday = weekend (0)
      const results = await engine.getRecommendations({ dayOfWeek: 0 })

      const quick = results.find(r => r.recipe.id === '1')
      const batch = results.find(r => r.recipe.id === '2')

      expect(batch!.scores.time).toBe(100) // Batch cook preferred on weekends
    })
  })

  describe('Rating Score', () => {
    it('should boost recipes with positive ratings', async () => {
      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([])
      mockPrisma.recipe.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'Liked Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 30,
          totalTimeMinutes: 30,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [
            { rating: 'thumbs_up', wouldMakeAgain: true },
            { rating: 'thumbs_up', wouldMakeAgain: true },
          ],
        },
        {
          id: '2',
          name: 'Disliked Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 30,
          totalTimeMinutes: 30,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [
            { rating: 'thumbs_down', wouldMakeAgain: false },
          ],
        },
      ])

      const results = await engine.getRecommendations({ limit: 2 })

      const liked = results.find(r => r.recipe.id === '1')
      const disliked = results.find(r => r.recipe.id === '2')

      expect(liked!.scores.rating).toBeGreaterThan(disliked!.scores.rating)
    })
  })

  describe('suggestRecipe', () => {
    it('should return null when no recipes available', async () => {
      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([])
      mockPrisma.recipe.findMany.mockResolvedValue([])

      const suggestion = await engine.suggestRecipe()

      expect(suggestion).toBeNull()
    })

    it('should return top recommendation', async () => {
      mockPrisma.userPreferences.findFirst.mockResolvedValue(null)
      mockPrisma.pantryInventory.findMany.mockResolvedValue([])
      mockPrisma.recipe.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'Best Recipe',
          approvalStatus: 'approved',
          lastCookedDate: null,
          cookTimeMinutes: 30,
          totalTimeMinutes: 30,
          cookingStyle: 'quick_weeknight',
          servings: 4,
          recipeIngredients: [],
          cookingHistory: [{ rating: 'thumbs_up', wouldMakeAgain: true }],
        },
      ])

      const suggestion = await engine.suggestRecipe({ mealType: 'dinner' })

      expect(suggestion).not.toBeNull()
      expect(suggestion!.recipe.name).toBe('Best Recipe')
    })
  })
})
