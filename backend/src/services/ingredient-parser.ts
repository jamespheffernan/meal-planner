import { canonicalizeUnit, isCanonicalUnit, type CanonicalUnit, UNIT_ALIAS_KEYS } from './units.js'

export interface ParsedIngredient {
  quantity: number | null
  unit: CanonicalUnit | null
  name: string
  notes: string | null
}

// Unicode fraction map
const UNICODE_FRACTIONS: Record<string, number> = {
  '\u00BC': 0.25,   // ¼
  '\u00BD': 0.5,    // ½
  '\u00BE': 0.75,   // ¾
  '\u2153': 1 / 3,  // ⅓
  '\u2154': 2 / 3,  // ⅔
  '\u215B': 0.125,  // ⅛
  '\u215C': 0.375,  // ⅜
  '\u215D': 0.625,  // ⅝
  '\u215E': 0.875,  // ⅞
}

const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('')

// Countable nouns that don't need a unit
const COUNTABLE_NOUNS = new Set([
  'egg', 'eggs', 'onion', 'onions', 'tomato', 'tomatoes', 'potato', 'potatoes',
  'carrot', 'carrots', 'pepper', 'peppers', 'banana', 'bananas', 'apple', 'apples',
  'lemon', 'lemons', 'lime', 'limes', 'orange', 'oranges', 'avocado', 'avocados',
  'garlic', 'shallot', 'shallots', 'chili', 'chilis', 'chilies', 'chile', 'chiles',
  'tortilla', 'tortillas', 'bun', 'buns', 'roll', 'rolls',
  'chicken breast', 'chicken breasts', 'chicken thigh', 'chicken thighs',
  'sausage', 'sausages', 'steak', 'steaks',
  'zucchini', 'cucumber', 'cucumbers', 'beet', 'beets',
  'mushroom', 'mushrooms', 'radish', 'radishes',
  'pear', 'pears', 'peach', 'peaches', 'plum', 'plums', 'mango', 'mangos', 'mangoes',
  'sweet potato', 'sweet potatoes',
])

const TO_TASTE_PHRASES = ['to taste', 'as needed', 'to garnish', 'for garnish', 'for serving']

function parseFraction(s: string): number | null {
  // Simple fraction: "1/2"
  const match = s.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (match) {
    const denom = parseInt(match[2])
    if (denom === 0) return null
    return parseInt(match[1]) / denom
  }
  return null
}

function parseQuantityString(s: string): number | null {
  s = s.trim()
  if (!s) return null

  // Replace unicode fractions with decimal equivalents
  for (const [char, val] of Object.entries(UNICODE_FRACTIONS)) {
    if (s.includes(char)) {
      // Handle "1½" -> 1.5
      const before = s.substring(0, s.indexOf(char)).trim()
      const after = s.substring(s.indexOf(char) + 1).trim()
      if (after) return null // unexpected trailing content
      const whole = before ? parseFloat(before) : 0
      if (isNaN(whole)) return null
      return whole + val
    }
  }

  // Range: "2-3" or "2 - 3" or "2 to 3" → take higher value
  const rangeMatch = s.match(/^([\d./]+)\s*[-–—]\s*([\d./]+)$/) || s.match(/^([\d./]+)\s+to\s+([\d./]+)$/)
  if (rangeMatch) {
    const high = parseFraction(rangeMatch[2]) ?? parseFloat(rangeMatch[2])
    return isNaN(high) ? null : high
  }

  // Mixed number: "1 1/2"
  const mixedMatch = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixedMatch) {
    const denom = parseInt(mixedMatch[3])
    if (denom === 0) return null
    return parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / denom
  }

  // Simple fraction: "1/2"
  const frac = parseFraction(s)
  if (frac !== null) return frac

  // Plain number
  const num = parseFloat(s)
  return isNaN(num) ? null : num
}

export function parseIngredientString(raw: string): ParsedIngredient {
  let s = raw.trim()
  if (!s) return { quantity: null, unit: null, name: '', notes: null }

  // Check for "to taste" / "as needed" early
  const lowerRaw = s.toLowerCase()
  for (const phrase of TO_TASTE_PHRASES) {
    if (lowerRaw.includes(phrase)) {
      const nameWithout = s.replace(new RegExp(phrase, 'gi'), '').replace(/[,;]\s*$/, '').trim()
      // Also strip quantity/unit if present
      const cleaned = stripLeadingQuantityAndUnit(nameWithout)
      return {
        quantity: null,
        unit: 'to_taste',
        name: cleaned || nameWithout,
        notes: null,
      }
    }
  }

  // Extract parenthetical notes
  let notes: string | null = null
  const parenMatch = s.match(/\(([^)]+)\)/g)
  if (parenMatch) {
    notes = parenMatch.map(p => p.slice(1, -1)).join('; ')
    s = s.replace(/\([^)]*\)/g, '').trim()
  }

  // Also extract trailing comma-delimited notes
  const commaIdx = s.indexOf(',')
  if (commaIdx > 0) {
    const afterComma = s.substring(commaIdx + 1).trim()
    if (afterComma) {
      notes = notes ? `${notes}; ${afterComma}` : afterComma
    }
    s = s.substring(0, commaIdx).trim()
  }

  // Extract leading quantity
  const qtyRegex = new RegExp(`^([\\d${UNICODE_FRACTION_CHARS}][\\d\\s${UNICODE_FRACTION_CHARS}./-]*)`)
  const qtyMatch = s.match(qtyRegex)
  let quantity: number | null = null
  if (qtyMatch) {
    quantity = parseQuantityString(qtyMatch[1])
    s = s.substring(qtyMatch[0].length).trim()
  }

  // Extract unit token (try two-word units first, then single)
  let unit: CanonicalUnit | null = null
  const words = s.split(/\s+/)

  if (words.length >= 2) {
    const twoWord = `${words[0]} ${words[1]}`.toLowerCase()
    if (UNIT_ALIAS_KEYS.has(twoWord)) {
      unit = canonicalizeUnit(twoWord)
      s = words.slice(2).join(' ').trim()
    }
  }

  if (!unit && words.length >= 1) {
    const oneWord = words[0].toLowerCase().replace(/\.$/, '')
    if (UNIT_ALIAS_KEYS.has(oneWord)) {
      unit = canonicalizeUnit(oneWord)
      s = words.slice(1).join(' ').trim()
    }
  }

  // Strip leading "of "
  s = s.replace(/^of\s+/i, '')

  // If no unit but has quantity and first word is countable, use 'piece'
  if (!unit && quantity !== null) {
    const lowerName = s.toLowerCase()
    if (COUNTABLE_NOUNS.has(lowerName) || COUNTABLE_NOUNS.has(lowerName.replace(/s$/, ''))) {
      unit = 'piece'
    }
  }

  // If quantity but no unit found, and the name starts with something that looks like
  // a countable item, default to piece
  if (!unit && quantity !== null) {
    unit = 'piece'
  }

  return {
    quantity,
    unit,
    name: s.toLowerCase().trim() || raw.toLowerCase().trim(),
    notes,
  }
}

// Helper to strip quantity and unit prefix from a name string
function stripLeadingQuantityAndUnit(s: string): string {
  const qtyRegex = new RegExp(`^[\\d${UNICODE_FRACTION_CHARS}][\\d\\s${UNICODE_FRACTION_CHARS}./-]*`)
  s = s.replace(qtyRegex, '').trim()
  const words = s.split(/\s+/)
  if (words.length > 0 && UNIT_ALIAS_KEYS.has(words[0].toLowerCase())) {
    s = words.slice(1).join(' ').trim()
  }
  return s.replace(/^of\s+/i, '').trim()
}
