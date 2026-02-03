export type CanonicalUnit =
  | 'cup' | 'tbsp' | 'tsp' | 'ml' | 'l'
  | 'g' | 'kg' | 'oz' | 'lb'
  | 'piece' | 'dozen'
  | 'pinch' | 'dash'
  | 'bunch' | 'clove' | 'can' | 'jar' | 'sprig'
  | 'to_taste'

export type UnitKind = 'volume' | 'weight' | 'count' | 'other'

export type MeasurementSystem = 'us' | 'metric'

const UNIT_KIND_MAP: Record<CanonicalUnit, UnitKind> = {
  cup: 'volume', tbsp: 'volume', tsp: 'volume', ml: 'volume', l: 'volume',
  g: 'weight', kg: 'weight', oz: 'weight', lb: 'weight',
  piece: 'count', dozen: 'count',
  pinch: 'other', dash: 'other', bunch: 'other', clove: 'other',
  can: 'other', jar: 'other', sprig: 'other', to_taste: 'other',
}

// ~80 alias entries mapping common strings to canonical units
const UNIT_ALIASES: Record<string, CanonicalUnit> = {
  // volume - cups
  cup: 'cup', cups: 'cup', c: 'cup',
  // volume - tablespoons
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', t: 'tbsp',
  // volume - teaspoons
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  // volume - ml/l
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  // weight - grams
  g: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  // weight - kilograms
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kilogramme: 'kg', kilogrammes: 'kg', kilo: 'kg', kilos: 'kg',
  // weight - ounces
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  // weight - pounds
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  // count
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', each: 'piece',
  dozen: 'dozen', dozens: 'dozen', doz: 'dozen',
  // other
  pinch: 'pinch', pinches: 'pinch',
  dash: 'dash', dashes: 'dash',
  bunch: 'bunch', bunches: 'bunch',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  jar: 'jar', jars: 'jar',
  sprig: 'sprig', sprigs: 'sprig',
  to_taste: 'to_taste',
  // common abbreviation variants
  'fl oz': 'oz',
  'fluid ounce': 'oz',
  'fluid ounces': 'oz',
  package: 'piece', packages: 'piece', pack: 'piece', packs: 'piece',
  slice: 'piece', slices: 'piece',
  handful: 'piece', handfuls: 'piece',
  stick: 'piece', sticks: 'piece',
  head: 'piece', heads: 'piece',
  stalk: 'piece', stalks: 'piece',
  ear: 'piece', ears: 'piece',
  fillet: 'piece', fillets: 'piece',
  breast: 'piece', breasts: 'piece',
  thigh: 'piece', thighs: 'piece',
  strip: 'piece', strips: 'piece',
  leaf: 'piece', leaves: 'piece',
}

// Conversion to base: volume -> ml, weight -> g
const TO_ML: Partial<Record<CanonicalUnit, number>> = {
  tsp: 4.929,
  tbsp: 14.787,
  cup: 236.588,
  ml: 1,
  l: 1000,
}

const TO_G: Partial<Record<CanonicalUnit, number>> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
}

export function canonicalizeUnit(raw: string): CanonicalUnit {
  const normalized = raw.trim().toLowerCase().replace(/\.$/, '')
  return UNIT_ALIASES[normalized] ?? (normalized as CanonicalUnit)
}

export function isCanonicalUnit(unit: string): unit is CanonicalUnit {
  return unit in UNIT_KIND_MAP
}

export function getUnitKind(unit: CanonicalUnit): UnitKind {
  return UNIT_KIND_MAP[unit] ?? 'other'
}

export function toBaseUnit(qty: number, unit: CanonicalUnit): { qty: number; unit: 'ml' | 'g' | CanonicalUnit } {
  const mlFactor = TO_ML[unit]
  if (mlFactor !== undefined) return { qty: qty * mlFactor, unit: 'ml' }

  const gFactor = TO_G[unit]
  if (gFactor !== undefined) return { qty: qty * gFactor, unit: 'g' }

  // count: convert dozen to pieces
  if (unit === 'dozen') return { qty: qty * 12, unit: 'piece' }

  return { qty, unit }
}

export function fromBaseUnit(qty: number, baseUnit: 'ml' | 'g', targetUnit: CanonicalUnit): number {
  if (baseUnit === 'ml') {
    const factor = TO_ML[targetUnit]
    if (factor) return qty / factor
  }
  if (baseUnit === 'g') {
    const factor = TO_G[targetUnit]
    if (factor) return qty / factor
  }
  return qty
}

export function convertQuantity(qty: number, from: CanonicalUnit, to: CanonicalUnit): number | null {
  if (from === to) return qty

  const fromKind = getUnitKind(from)
  const toKind = getUnitKind(to)

  // Allow dozen <-> piece
  if ((from === 'dozen' && to === 'piece') || (from === 'piece' && to === 'dozen')) {
    return from === 'dozen' ? qty * 12 : qty / 12
  }

  // Only convert within same kind (volume or weight)
  if (fromKind !== toKind) return null
  if (fromKind !== 'volume' && fromKind !== 'weight') return null

  const base = toBaseUnit(qty, from)
  return fromBaseUnit(base.qty, base.unit as 'ml' | 'g', to)
}

// Human-friendly display thresholds
const VOLUME_DISPLAY: { unit: CanonicalUnit; min: number; system: MeasurementSystem }[] = [
  // US
  { unit: 'tsp', min: 0, system: 'us' },
  { unit: 'tbsp', min: 14.787, system: 'us' },     // >= 1 tbsp
  { unit: 'cup', min: 236.588, system: 'us' },      // >= 1 cup
  // Metric
  { unit: 'ml', min: 0, system: 'metric' },
  { unit: 'l', min: 1000, system: 'metric' },        // >= 1L
]

const WEIGHT_DISPLAY: { unit: CanonicalUnit; min: number; system: MeasurementSystem }[] = [
  // US
  { unit: 'oz', min: 0, system: 'us' },
  { unit: 'lb', min: 453.592, system: 'us' },        // >= 1 lb
  // Metric
  { unit: 'g', min: 0, system: 'metric' },
  { unit: 'kg', min: 1000, system: 'metric' },       // >= 1 kg
]

export function getBestDisplayUnit(
  qty: number,
  kind: UnitKind,
  system: MeasurementSystem
): { qty: number; unit: CanonicalUnit } {
  if (kind !== 'volume' && kind !== 'weight') {
    return { qty, unit: kind === 'count' ? 'piece' : 'piece' }
  }

  const table = kind === 'volume' ? VOLUME_DISPLAY : WEIGHT_DISPLAY
  const candidates = table.filter(e => e.system === system)

  // qty is already in base (ml or g)
  let best = candidates[0]
  for (const candidate of candidates) {
    if (qty >= candidate.min) {
      best = candidate
    }
  }

  const factor = kind === 'volume' ? TO_ML[best.unit]! : TO_G[best.unit]!
  return { qty: qty / factor, unit: best.unit }
}

// Export aliases for use by normalizer
export const UNIT_ALIAS_KEYS = new Set(Object.keys(UNIT_ALIASES))
