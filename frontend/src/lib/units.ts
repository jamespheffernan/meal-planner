// Display formatting for quantities and units

const DECIMAL_TO_FRACTION: [number, string][] = [
  [0.125, '\u215B'],   // ⅛
  [0.25, '\u00BC'],    // ¼
  [1/3, '\u2153'],     // ⅓
  [0.375, '\u215C'],   // ⅜
  [0.5, '\u00BD'],     // ½
  [0.625, '\u215D'],   // ⅝
  [2/3, '\u2154'],     // ⅔
  [0.75, '\u00BE'],    // ¾
  [0.875, '\u215E'],   // ⅞
]

const FRACTION_TOLERANCE = 0.03

export function formatQuantity(qty: number): string {
  if (qty === 0) return '0'

  const whole = Math.floor(qty)
  const decimal = qty - whole

  // Check if it's close to a common fraction
  for (const [frac, char] of DECIMAL_TO_FRACTION) {
    if (Math.abs(decimal - frac) < FRACTION_TOLERANCE) {
      return whole > 0 ? `${whole}${char}` : char
    }
  }

  // If very close to whole number
  if (decimal < FRACTION_TOLERANCE) {
    return whole.toString()
  }

  // Fall back to decimal
  return Number(qty.toFixed(2)).toString()
}

const UNIT_PLURAL: Record<string, string> = {
  cup: 'cups',
  tbsp: 'tbsp',
  tsp: 'tsp',
  ml: 'ml',
  l: 'L',
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lbs',
  piece: '',
  dozen: 'dozen',
  pinch: 'pinches',
  dash: 'dashes',
  bunch: 'bunches',
  clove: 'cloves',
  can: 'cans',
  jar: 'jars',
  sprig: 'sprigs',
}

const UNIT_SINGULAR: Record<string, string> = {
  cup: 'cup',
  tbsp: 'tbsp',
  tsp: 'tsp',
  ml: 'ml',
  l: 'L',
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lb',
  piece: '',
  dozen: 'dozen',
  pinch: 'pinch',
  dash: 'dash',
  bunch: 'bunch',
  clove: 'clove',
  can: 'can',
  jar: 'jar',
  sprig: 'sprig',
}

export function formatUnit(unit: string, qty: number): string {
  if (unit === 'to_taste') return ''
  if (unit === 'piece') return ''

  if (qty > 1) {
    return UNIT_PLURAL[unit] ?? unit
  }
  return UNIT_SINGULAR[unit] ?? unit
}

export function formatIngredientQuantity(qty: number | null | undefined, unit: string | null | undefined): string {
  if (unit === 'to_taste') return 'to taste'
  if (qty === null || qty === undefined) return ''

  const formattedQty = formatQuantity(qty)
  const effectiveUnit = unit || 'piece'
  const formattedUnit = formatUnit(effectiveUnit, qty)

  if (!formattedUnit) {
    return formattedQty
  }

  return `${formattedQty} ${formattedUnit}`
}
