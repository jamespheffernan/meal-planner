// Utilities for detecting and merging duplicate recipes.
// Kept intentionally conservative to avoid false positives.

export function normalizeRecipeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    // drop diacritics
    .replace(/[\u0300-\u036f]/g, '')
    // keep alnum, spaces
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeLine(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isProbablyUrl(value: string | null | undefined): boolean {
  if (!value) return false
  return /^https?:\/\//i.test(value.trim())
}

export function recipeContentSignature(input: {
  name: string
  ingredients?: string[]
  instructions?: string[]
}): string {
  const name = normalizeRecipeName(input.name)
  const ingredients = (input.ingredients || [])
    .map(normalizeLine)
    .filter(Boolean)
    .sort()
    .join('|')
  const instructions = (input.instructions || [])
    .map(normalizeLine)
    .filter(Boolean)
    .join('|')
  return `n:${name}#i:${ingredients}#s:${instructions}`
}

export type DedupeWinnerScore = {
  approvalStatus: 'approved' | 'pending' | 'rejected' | 'archived' | string
  timesCooked: number
  hasPhoto: boolean
  hasDescription: boolean
  createdAt: Date
}

export function scoreRecipeForMerge(s: DedupeWinnerScore): number {
  const approval =
    s.approvalStatus === 'approved' ? 40 :
    s.approvalStatus === 'pending' ? 20 :
    s.approvalStatus === 'rejected' ? 5 :
    s.approvalStatus === 'archived' ? 0 : 10

  const cooked = Math.min(Math.max(s.timesCooked || 0, 0), 50)
  const photo = s.hasPhoto ? 4 : 0
  const desc = s.hasDescription ? 2 : 0
  // Prefer older as canonical when all else equal, to minimize churn in references.
  const age = -Math.floor((s.createdAt?.getTime?.() ?? Date.now()) / 1e9) / 1e6

  return approval + cooked + photo + desc + age
}

