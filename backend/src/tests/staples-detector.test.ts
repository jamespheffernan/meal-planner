import { describe, it, expect } from 'vitest'
import { normalizeProductName } from '../services/staples/detector.js'

describe('Staples detector', () => {
  it('normalizes common product strings', () => {
    expect(normalizeProductName('Free Range Eggs x6')).toBe('eggs')
    expect(normalizeProductName('Organic Milk 2L')).toBe('milk')
    expect(normalizeProductName('Oatly Barista Oat Milk 1L')).toBe('oatly oat milk')
  })
})

