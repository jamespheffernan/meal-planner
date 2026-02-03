import { describe, it, expect } from 'vitest'
import {
  canonicalizeUnit,
  getUnitKind,
  toBaseUnit,
  fromBaseUnit,
  convertQuantity,
  getBestDisplayUnit,
} from '../services/units.js'

describe('canonicalizeUnit', () => {
  it('should map plural to singular', () => {
    expect(canonicalizeUnit('cups')).toBe('cup')
    expect(canonicalizeUnit('tablespoons')).toBe('tbsp')
    expect(canonicalizeUnit('teaspoons')).toBe('tsp')
    expect(canonicalizeUnit('ounces')).toBe('oz')
    expect(canonicalizeUnit('pounds')).toBe('lb')
    expect(canonicalizeUnit('grams')).toBe('g')
    expect(canonicalizeUnit('liters')).toBe('l')
  })

  it('should map abbreviations', () => {
    expect(canonicalizeUnit('T')).toBe('tbsp')
    expect(canonicalizeUnit('c')).toBe('cup')
    expect(canonicalizeUnit('lbs')).toBe('lb')
    expect(canonicalizeUnit('tbsp')).toBe('tbsp')
    expect(canonicalizeUnit('tsp')).toBe('tsp')
  })

  it('should handle alternate spellings', () => {
    expect(canonicalizeUnit('grammes')).toBe('g')
    expect(canonicalizeUnit('kilogramme')).toBe('kg')
    expect(canonicalizeUnit('litre')).toBe('l')
    expect(canonicalizeUnit('millilitre')).toBe('ml')
  })

  it('should be case-insensitive', () => {
    expect(canonicalizeUnit('Cup')).toBe('cup')
    expect(canonicalizeUnit('TBSP')).toBe('tbsp')
    expect(canonicalizeUnit('Gram')).toBe('g')
  })

  it('should strip trailing periods', () => {
    expect(canonicalizeUnit('oz.')).toBe('oz')
    expect(canonicalizeUnit('tsp.')).toBe('tsp')
  })

  it('should map container types', () => {
    expect(canonicalizeUnit('cans')).toBe('can')
    expect(canonicalizeUnit('tin')).toBe('can')
    expect(canonicalizeUnit('jars')).toBe('jar')
  })

  it('should map slice/package to piece', () => {
    expect(canonicalizeUnit('slices')).toBe('piece')
    expect(canonicalizeUnit('package')).toBe('piece')
  })
})

describe('getUnitKind', () => {
  it('should return volume for volume units', () => {
    expect(getUnitKind('cup')).toBe('volume')
    expect(getUnitKind('tbsp')).toBe('volume')
    expect(getUnitKind('ml')).toBe('volume')
    expect(getUnitKind('l')).toBe('volume')
  })

  it('should return weight for weight units', () => {
    expect(getUnitKind('g')).toBe('weight')
    expect(getUnitKind('kg')).toBe('weight')
    expect(getUnitKind('oz')).toBe('weight')
    expect(getUnitKind('lb')).toBe('weight')
  })

  it('should return count for count units', () => {
    expect(getUnitKind('piece')).toBe('count')
    expect(getUnitKind('dozen')).toBe('count')
  })

  it('should return other for other units', () => {
    expect(getUnitKind('pinch')).toBe('other')
    expect(getUnitKind('to_taste')).toBe('other')
    expect(getUnitKind('clove')).toBe('other')
  })
})

describe('toBaseUnit', () => {
  it('should convert volume to ml', () => {
    expect(toBaseUnit(1, 'tsp').qty).toBeCloseTo(4.929)
    expect(toBaseUnit(1, 'tsp').unit).toBe('ml')
    expect(toBaseUnit(1, 'tbsp').qty).toBeCloseTo(14.787)
    expect(toBaseUnit(1, 'cup').qty).toBeCloseTo(236.588)
    expect(toBaseUnit(1, 'l').qty).toBe(1000)
  })

  it('should convert weight to g', () => {
    expect(toBaseUnit(1, 'oz').qty).toBeCloseTo(28.3495)
    expect(toBaseUnit(1, 'oz').unit).toBe('g')
    expect(toBaseUnit(1, 'lb').qty).toBeCloseTo(453.592)
    expect(toBaseUnit(1, 'kg').qty).toBe(1000)
  })

  it('should convert dozen to pieces', () => {
    expect(toBaseUnit(2, 'dozen')).toEqual({ qty: 24, unit: 'piece' })
  })

  it('should pass through non-convertible units', () => {
    expect(toBaseUnit(3, 'pinch')).toEqual({ qty: 3, unit: 'pinch' })
  })
})

describe('convertQuantity', () => {
  it('should convert between volume units', () => {
    // 1 cup = ~16 tbsp
    const result = convertQuantity(1, 'cup', 'tbsp')
    expect(result).toBeCloseTo(16, 0)
  })

  it('should convert between weight units', () => {
    // 1 lb = 16 oz
    const result = convertQuantity(1, 'lb', 'oz')
    expect(result).toBeCloseTo(16, 0)
  })

  it('should return null for incompatible units', () => {
    expect(convertQuantity(1, 'cup', 'g')).toBeNull()
    expect(convertQuantity(1, 'piece', 'ml')).toBeNull()
  })

  it('should return same qty for same unit', () => {
    expect(convertQuantity(5, 'g', 'g')).toBe(5)
  })

  it('should handle dozen <-> piece', () => {
    expect(convertQuantity(1, 'dozen', 'piece')).toBe(12)
    expect(convertQuantity(12, 'piece', 'dozen')).toBe(1)
  })
})

describe('getBestDisplayUnit', () => {
  it('should use cups for large volume in US', () => {
    const result = getBestDisplayUnit(750, 'volume', 'us') // 750 ml
    expect(result.unit).toBe('cup')
    expect(result.qty).toBeCloseTo(3.17, 1)
  })

  it('should use tbsp for small volume in US', () => {
    const result = getBestDisplayUnit(30, 'volume', 'us') // 30 ml
    expect(result.unit).toBe('tbsp')
  })

  it('should use ml for small volume in metric', () => {
    const result = getBestDisplayUnit(30, 'volume', 'metric')
    expect(result.unit).toBe('ml')
    expect(result.qty).toBe(30)
  })

  it('should use L for large volume in metric', () => {
    const result = getBestDisplayUnit(2000, 'volume', 'metric')
    expect(result.unit).toBe('l')
    expect(result.qty).toBe(2)
  })

  it('should use kg for large weight in metric', () => {
    const result = getBestDisplayUnit(1500, 'weight', 'metric')
    expect(result.unit).toBe('kg')
    expect(result.qty).toBe(1.5)
  })

  it('should use lb for large weight in US', () => {
    const result = getBestDisplayUnit(900, 'weight', 'us')
    expect(result.unit).toBe('lb')
    expect(result.qty).toBeCloseTo(1.98, 1)
  })
})
