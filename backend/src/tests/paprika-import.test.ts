import { describe, it, expect } from 'vitest'
import { parsePaprikaExport, parsePaprikaRecipe, deduplicateRecipes } from '../services/paprika-import.js'

describe('Paprika Import', () => {
  describe('parsePaprikaRecipe', () => {
    it('should parse a basic Paprika recipe JSON', () => {
      const json = JSON.stringify({
        name: 'Test Recipe',
        description: 'A test recipe description',
        source: 'Cookbook Page 42',
        servings: '4 servings',
        cook_time: '30 minutes',
        prep_time: '15 minutes',
        ingredients: 'flour\nsugar\neggs',
        directions: '1. Mix dry ingredients\n2. Add eggs\n3. Bake',
      })

      const result = parsePaprikaRecipe(json)

      expect(result.name).toBe('Test Recipe')
      expect(result.description).toBe('A test recipe description')
      expect(result.source).toBe('Cookbook Page 42')
      expect(result.servings).toBe(4)
      expect(result.cookTimeMinutes).toBe(30)
      expect(result.prepTimeMinutes).toBe(15)
      expect(result.ingredients).toEqual(['flour', 'sugar', 'eggs'])
      expect(result.instructions).toEqual([
        'Mix dry ingredients',
        'Add eggs',
        'Bake',
      ])
    })

    it('should handle recipes with hours in cook time', () => {
      const json = JSON.stringify({
        name: 'Slow Cooked Dish',
        cook_time: '2 hours 30 minutes',
        ingredients: 'meat',
        directions: 'Cook slowly',
      })

      const result = parsePaprikaRecipe(json)

      expect(result.cookTimeMinutes).toBe(150) // 2h30m = 150 minutes
    })

    it('should handle missing optional fields', () => {
      const json = JSON.stringify({
        name: 'Minimal Recipe',
        ingredients: 'something',
        directions: 'do something',
      })

      const result = parsePaprikaRecipe(json)

      expect(result.name).toBe('Minimal Recipe')
      expect(result.description).toBeUndefined()
      expect(result.servings).toBeUndefined()
      expect(result.cookTimeMinutes).toBeUndefined()
    })

    it('should parse categories', () => {
      const json = JSON.stringify({
        name: 'Categorized Recipe',
        categories: ['Desserts', 'Quick Meals'],
        ingredients: 'stuff',
        directions: 'make it',
      })

      const result = parsePaprikaRecipe(json)

      expect(result.categories).toEqual(['Desserts', 'Quick Meals'])
    })
  })

  describe('parsePaprikaExport', () => {
    it('should parse array of recipes', async () => {
      const data = JSON.stringify([
        { name: 'Recipe 1', ingredients: 'a', directions: 'b' },
        { name: 'Recipe 2', ingredients: 'c', directions: 'd' },
      ])

      const results = await parsePaprikaExport(data)

      expect(results).toHaveLength(2)
      expect(results[0].name).toBe('Recipe 1')
      expect(results[1].name).toBe('Recipe 2')
    })

    it('should handle single recipe object', async () => {
      const data = JSON.stringify({
        name: 'Single Recipe',
        ingredients: 'ingredient',
        directions: 'direction',
      })

      const results = await parsePaprikaExport(data)

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Single Recipe')
    })

    it('should handle buffer input', async () => {
      const data = Buffer.from(
        JSON.stringify({ name: 'Buffer Recipe', ingredients: 'x', directions: 'y' })
      )

      const results = await parsePaprikaExport(data)

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Buffer Recipe')
    })
  })

  describe('deduplicateRecipes', () => {
    it('should identify duplicate recipes', () => {
      const newRecipes = [
        { name: 'Recipe A', ingredients: [], instructions: [] },
        { name: 'Recipe B', ingredients: [], instructions: [] },
        { name: 'recipe a', ingredients: [], instructions: [] }, // case-insensitive dup
        { name: 'Recipe C', ingredients: [], instructions: [] },
      ]

      const existingNames = ['Recipe B', 'Recipe D']

      const { unique, duplicates } = deduplicateRecipes(newRecipes, existingNames)

      expect(unique).toHaveLength(2) // A and C
      expect(duplicates).toHaveLength(2) // B (exists) and lowercase a (internal dup)

      expect(unique.map(r => r.name)).toContain('Recipe A')
      expect(unique.map(r => r.name)).toContain('Recipe C')
    })

    it('should handle empty inputs', () => {
      const { unique, duplicates } = deduplicateRecipes([], [])

      expect(unique).toHaveLength(0)
      expect(duplicates).toHaveLength(0)
    })

    it('should handle no duplicates', () => {
      const newRecipes = [
        { name: 'Unique 1', ingredients: [], instructions: [] },
        { name: 'Unique 2', ingredients: [], instructions: [] },
      ]

      const { unique, duplicates } = deduplicateRecipes(newRecipes, ['Other Recipe'])

      expect(unique).toHaveLength(2)
      expect(duplicates).toHaveLength(0)
    })
  })
})
