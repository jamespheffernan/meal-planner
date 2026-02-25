import { describe, it, expect } from 'vitest'
import { normalizeRecipeName, recipeContentSignature } from '../services/recipe-dedupe.js'

describe('recipe-dedupe', () => {
  it('normalizes recipe names consistently', () => {
    expect(normalizeRecipeName('  Chicken & Rice  ')).toBe('chicken rice')
    expect(normalizeRecipeName('CHICKEN—RICE')).toBe('chicken rice')
  })

  it('builds stable content signatures (ingredient order-insensitive)', () => {
    const a = recipeContentSignature({
      name: 'Pasta',
      ingredients: ['Olive Oil', 'Salt', 'Pasta'],
      instructions: ['Boil water', 'Cook pasta'],
    })
    const b = recipeContentSignature({
      name: 'pasta',
      ingredients: ['pasta', 'salt', 'olive oil'],
      instructions: ['Boil water', 'Cook pasta'],
    })
    expect(a).toBe(b)
  })
})
