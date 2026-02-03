import { describe, it, expect } from 'vitest'
import { parseIngredientString } from '../services/ingredient-parser.js'

describe('parseIngredientString', () => {
  describe('basic quantities and units', () => {
    it('should parse "2 cups flour"', () => {
      const result = parseIngredientString('2 cups flour')
      expect(result.quantity).toBe(2)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('flour')
    })

    it('should parse "1 tablespoon olive oil"', () => {
      const result = parseIngredientString('1 tablespoon olive oil')
      expect(result.quantity).toBe(1)
      expect(result.unit).toBe('tbsp')
      expect(result.name).toBe('olive oil')
    })

    it('should parse "500g chicken breast"', () => {
      const result = parseIngredientString('500 g chicken breast')
      expect(result.quantity).toBe(500)
      expect(result.unit).toBe('g')
      expect(result.name).toBe('chicken breast')
    })

    it('should parse "2 oz butter"', () => {
      const result = parseIngredientString('2 oz butter')
      expect(result.quantity).toBe(2)
      expect(result.unit).toBe('oz')
      expect(result.name).toBe('butter')
    })
  })

  describe('fractions', () => {
    it('should parse "1/2 cup sugar"', () => {
      const result = parseIngredientString('1/2 cup sugar')
      expect(result.quantity).toBe(0.5)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('sugar')
    })

    it('should parse "1 1/2 cups milk"', () => {
      const result = parseIngredientString('1 1/2 cups milk')
      expect(result.quantity).toBe(1.5)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('milk')
    })

    it('should parse "3/4 teaspoon salt"', () => {
      const result = parseIngredientString('3/4 teaspoon salt')
      expect(result.quantity).toBe(0.75)
      expect(result.unit).toBe('tsp')
      expect(result.name).toBe('salt')
    })
  })

  describe('unicode fractions', () => {
    it('should parse "½ cup sugar"', () => {
      const result = parseIngredientString('½ cup sugar')
      expect(result.quantity).toBe(0.5)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('sugar')
    })

    it('should parse "1½ cups flour"', () => {
      const result = parseIngredientString('1½ cups flour')
      expect(result.quantity).toBe(1.5)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('flour')
    })

    it('should parse "¼ tsp pepper"', () => {
      const result = parseIngredientString('¼ tsp pepper')
      expect(result.quantity).toBe(0.25)
      expect(result.unit).toBe('tsp')
      expect(result.name).toBe('pepper')
    })
  })

  describe('ranges', () => {
    it('should take higher value from "2-3 cloves garlic"', () => {
      const result = parseIngredientString('2-3 cloves garlic')
      expect(result.quantity).toBe(3)
      expect(result.unit).toBe('clove')
      expect(result.name).toBe('garlic')
    })
  })

  describe('countable nouns', () => {
    it('should assign piece unit to "3 eggs"', () => {
      const result = parseIngredientString('3 eggs')
      expect(result.quantity).toBe(3)
      expect(result.unit).toBe('piece')
      expect(result.name).toBe('eggs')
    })

    it('should assign piece unit to "1 onion"', () => {
      const result = parseIngredientString('1 onion')
      expect(result.quantity).toBe(1)
      expect(result.unit).toBe('piece')
      expect(result.name).toBe('onion')
    })
  })

  describe('to taste / as needed', () => {
    it('should parse "salt to taste"', () => {
      const result = parseIngredientString('salt to taste')
      expect(result.quantity).toBeNull()
      expect(result.unit).toBe('to_taste')
      expect(result.name).toBe('salt')
    })

    it('should parse "pepper, as needed"', () => {
      const result = parseIngredientString('pepper, as needed')
      expect(result.quantity).toBeNull()
      expect(result.unit).toBe('to_taste')
      expect(result.name).toContain('pepper')
    })

    it('should parse "fresh herbs for garnish"', () => {
      const result = parseIngredientString('fresh herbs for garnish')
      expect(result.quantity).toBeNull()
      expect(result.unit).toBe('to_taste')
    })
  })

  describe('parenthetical notes', () => {
    it('should extract notes from "1 cup flour (sifted)"', () => {
      const result = parseIngredientString('1 cup flour (sifted)')
      expect(result.quantity).toBe(1)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('flour')
      expect(result.notes).toBe('sifted')
    })

    it('should extract comma-separated notes', () => {
      const result = parseIngredientString('2 cups chicken broth, preferably homemade')
      expect(result.quantity).toBe(2)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('chicken broth')
      expect(result.notes).toBe('preferably homemade')
    })
  })

  describe('unit of', () => {
    it('should handle "1 cup of rice"', () => {
      const result = parseIngredientString('1 cup of rice')
      expect(result.quantity).toBe(1)
      expect(result.unit).toBe('cup')
      expect(result.name).toBe('rice')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = parseIngredientString('')
      expect(result.quantity).toBeNull()
      expect(result.unit).toBeNull()
      expect(result.name).toBe('')
    })

    it('should handle just a name with no quantity', () => {
      const result = parseIngredientString('butter')
      expect(result.quantity).toBeNull()
      expect(result.unit).toBeNull()
      expect(result.name).toBe('butter')
    })

    it('should handle decimals', () => {
      const result = parseIngredientString('1.5 tbsp soy sauce')
      expect(result.quantity).toBe(1.5)
      expect(result.unit).toBe('tbsp')
      expect(result.name).toBe('soy sauce')
    })
  })
})
