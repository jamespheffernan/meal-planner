import { PrismaClient } from '@prisma/client'
import { isProbablyUrl, normalizeRecipeName, recipeContentSignature, scoreRecipeForMerge } from '../services/recipe-dedupe.js'

type Mode = 'dry-run' | 'apply'
type Strategy = 'conservative' | 'name-only'

function parseMode(argv: string[]): Mode {
  if (argv.includes('--apply')) return 'apply'
  return 'dry-run'
}

function parseLimit(argv: string[]): number | undefined {
  const idx = argv.findIndex(a => a === '--limit')
  if (idx === -1) return undefined
  const raw = argv[idx + 1]
  const n = raw ? Number(raw) : NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

function shouldStrictMatch(argv: string[]): boolean {
  // Strict match: require same normalized name AND same content signature.
  // Loose match (default): also merges exact source URL collisions.
  return argv.includes('--strict')
}

function parseStrategy(argv: string[]): Strategy {
  if (argv.includes('--name-only')) return 'name-only'
  return 'conservative'
}

async function main() {
  const mode = parseMode(process.argv)
  const limit = parseLimit(process.argv)
  const strict = shouldStrictMatch(process.argv)
  const strategy = parseStrategy(process.argv)

  const prisma = new PrismaClient()

  const recipes = await prisma.recipe.findMany({
    select: {
      id: true,
      name: true,
      source: true,
      approvalStatus: true,
      timesCooked: true,
      photoUrl: true,
      description: true,
      createdAt: true,
      recipeIngredients: {
        select: { ingredient: { select: { name: true } }, notes: true },
      },
      recipeInstructions: {
        select: { stepNumber: true, instructionText: true },
        orderBy: { stepNumber: 'asc' },
      },
    },
  })

  const bySourceUrl = new Map<string, string[]>() // sourceUrl -> recipeIds
  const byName = new Map<string, string[]>() // normalizedName -> recipeIds
  const byId = new Map(recipes.map(r => [r.id, r]))

  for (const r of recipes) {
    const n = normalizeRecipeName(r.name)
    if (n) {
      const arr = byName.get(n) || []
      arr.push(r.id)
      byName.set(n, arr)
    }
    if (!strict && isProbablyUrl(r.source)) {
      const key = r.source!.trim()
      const arr = bySourceUrl.get(key) || []
      arr.push(r.id)
      bySourceUrl.set(key, arr)
    }
  }

  const groups: string[][] = []

  // 1) Exact source URL collisions (safe).
  if (!strict && strategy === 'conservative') {
    for (const ids of bySourceUrl.values()) {
      if (ids.length >= 2) groups.push(ids)
    }
  }

  // 2) By normalized name only (user-expected, but can be false-positive).
  if (strategy === 'name-only') {
    for (const ids of byName.values()) {
      if (ids.length >= 2) groups.push(ids)
    }
  } else {
    // 2) Name+content signature collisions (conservative).
    for (const ids of byName.values()) {
      if (ids.length < 2) continue

      const bySig = new Map<string, string[]>()
      for (const id of ids) {
        const r = byId.get(id)
        if (!r) continue
        const ingredients = r.recipeIngredients.map(ri => ri.ingredient.name)
        const instructions = r.recipeInstructions.map(i => i.instructionText)
        const sig = recipeContentSignature({ name: r.name, ingredients, instructions })
        const arr = bySig.get(sig) || []
        arr.push(id)
        bySig.set(sig, arr)
      }
      for (const sigIds of bySig.values()) {
        if (sigIds.length >= 2) groups.push(sigIds)
      }
    }
  }

  // De-duplicate identical groups (can overlap due to source+signature grouping)
  const seenGroupKey = new Set<string>()
  const dedupedGroups: string[][] = []
  for (const g of groups) {
    const key = Array.from(new Set(g)).sort().join(',')
    if (!key || seenGroupKey.has(key)) continue
    seenGroupKey.add(key)
    dedupedGroups.push(key.split(','))
  }

  let totalLosers = 0
  const plan = []
  for (const g of dedupedGroups) {
    const rows = g.map(id => byId.get(id)).filter(Boolean) as typeof recipes
    if (rows.length < 2) continue

    rows.sort((a, b) => scoreRecipeForMerge({
      approvalStatus: a.approvalStatus,
      timesCooked: a.timesCooked,
      hasPhoto: Boolean(a.photoUrl),
      hasDescription: Boolean(a.description && a.description.trim()),
      createdAt: a.createdAt,
    }) - scoreRecipeForMerge({
      approvalStatus: b.approvalStatus,
      timesCooked: b.timesCooked,
      hasPhoto: Boolean(b.photoUrl),
      hasDescription: Boolean(b.description && b.description.trim()),
      createdAt: b.createdAt,
    }))
    const winner = rows[rows.length - 1]
    const losers = rows.slice(0, -1)
    totalLosers += losers.length
    plan.push({ winnerId: winner.id, loserIds: losers.map(l => l.id), name: winner.name })
  }

  const limitedPlan = typeof limit === 'number' ? plan.slice(0, limit) : plan

  console.log(JSON.stringify({
    mode,
    strategy,
    strict,
    recipeCount: recipes.length,
    duplicateGroups: plan.length,
    plannedMerges: limitedPlan.length,
    plannedDeletes: limitedPlan.reduce((sum, p) => sum + p.loserIds.length, 0),
    sample: limitedPlan.slice(0, 5),
  }, null, 2))

  if (mode !== 'apply') {
    await prisma.$disconnect()
    return
  }

  for (const merge of limitedPlan) {
    await prisma.$transaction(async (tx) => {
      const winnerId = merge.winnerId
      for (const loserId of merge.loserIds) {
        // Move any references pointing at the loser.
        await tx.recipeIngredient.updateMany({ where: { recipeId: loserId }, data: { recipeId: winnerId } })
        await tx.recipeInstruction.updateMany({ where: { recipeId: loserId }, data: { recipeId: winnerId } })
        await tx.cookingHistory.updateMany({ where: { recipeId: loserId }, data: { recipeId: winnerId } })
        await tx.mealPlan.updateMany({ where: { recipeId: loserId }, data: { recipeId: winnerId } })
        await tx.recipeCandidate.updateMany({ where: { recipeId: loserId }, data: { recipeId: winnerId } })

        // Delete the loser recipe (cascades should clean up any remaining children).
        await tx.recipe.delete({ where: { id: loserId } })
      }
    })
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
