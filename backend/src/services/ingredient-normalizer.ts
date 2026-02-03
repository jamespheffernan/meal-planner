import { UNIT_ALIAS_KEYS } from './units.js'
import { parseIngredientString } from './ingredient-parser.js'

const LEADING_MODIFIERS = new Set([
  'fresh', 'dried', 'boneless', 'skinless', 'large', 'small', 'medium', 'extra', 'lean',
  'low-fat', 'lowfat', 'fat-free', 'fatfree', 'ground', 'minced', 'chopped', 'sliced',
  'diced', 'crushed', 'grated', 'shredded', 'ripe', 'baby',
])

export function normalizeIngredientName(input: string): string {
  // Use the parser to extract the ingredient name
  const parsed = parseIngredientString(input)
  let name = parsed.name

  if (!name) {
    return input.toLowerCase().trim().slice(0, 100)
  }

  // Strip leading modifiers for normalization
  const tokens = name.split(/\s+/).filter(Boolean)
  while (tokens.length && LEADING_MODIFIERS.has(tokens[0])) {
    tokens.shift()
  }

  name = tokens.join(' ').replace(/\s+/g, ' ').trim()

  if (!name) {
    return input.toLowerCase().trim().slice(0, 100)
  }

  return name.slice(0, 100)
}
