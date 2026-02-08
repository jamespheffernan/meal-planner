'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { recipes, discovery, pantry, type Recipe, type RecipeCandidate } from '@/lib/api'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { ThumbsUp, ThumbsDown, Clock, Users, Search, LayoutGrid, SquareCheckBig, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import RecipePhoto from '@/components/RecipePhoto'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export default function DiscoverPage() {
  const queryClient = useQueryClient()

  const [sourceTab, setSourceTab] = useState<'theme' | 'pending'>('theme')
  const [reviewMode, setReviewMode] = useState<'swipe' | 'batch'>('swipe')

  const [themeQuery, setThemeQuery] = useState('')
  const [themeMealType, setThemeMealType] = useState<string>('')
  const [themeMaxTime, setThemeMaxTime] = useState('')
  const [themeLimit, setThemeLimit] = useState(20)
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)

  const [pendingIndex, setPendingIndex] = useState(0)
  const [candidateIndex, setCandidateIndex] = useState(0)

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [sortBy, setSortBy] = useState<'pantry' | 'time' | 'ingredients'>('pantry')

  useEffect(() => {
    setSelectedIds({})
  }, [sourceTab])

  const { data: pendingRecipes, isLoading: pendingLoading } = useQuery({
    queryKey: ['recipes', 'discover'],
    queryFn: () => recipes.discover(20),
  })

  const { data: candidateData, isLoading: candidateLoading } = useQuery({
    queryKey: ['discovery', 'batch', activeBatchId, 'candidates'],
    queryFn: () => discovery.listCandidates(activeBatchId!, 'pending'),
    enabled: Boolean(activeBatchId),
  })

  const { data: pantryItems } = useQuery({
    queryKey: ['pantry', 'discover'],
    queryFn: () => pantry.list(),
  })

  const pantrySet = useMemo(() => {
    const set = new Set<string>()
    pantryItems?.forEach(item => {
      if (item.status !== 'depleted') {
        set.add(normalizeName(item.ingredient.name))
      }
    })
    return set
  }, [pantryItems])

  const searchMutation = useMutation({
    mutationFn: () => discovery.search({
      query: themeQuery.trim(),
      limit: themeLimit,
      mealType: themeMealType || undefined,
      maxTimeMinutes: themeMaxTime ? parseInt(themeMaxTime, 10) : undefined,
    }),
    onSuccess: (data) => {
      setActiveBatchId(data.batchId)
      setSourceTab('theme')
      setCandidateIndex(0)
      setSelectedIds({})
      queryClient.invalidateQueries({ queryKey: ['discovery', 'batch', data.batchId, 'candidates'] })
    },
  })

  const candidateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' }) =>
      discovery.updateCandidateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery'] })
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  const candidateBulkMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: 'approved' | 'rejected' }) =>
      discovery.bulkUpdate(ids, status),
    onSuccess: () => {
      setSelectedIds({})
      queryClient.invalidateQueries({ queryKey: ['discovery'] })
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  const pendingStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' }) =>
      recipes.updateApproval(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  const candidates = candidateData?.candidates || []
  const pending = pendingRecipes || []

  const activeSwipeItem = sourceTab === 'theme'
    ? candidates[candidateIndex]
    : pending[pendingIndex]

  const isSwipeLoading = sourceTab === 'theme' ? candidateLoading : pendingLoading

  const swipeRemaining = sourceTab === 'theme'
    ? Math.max(0, candidates.length - candidateIndex - 1)
    : Math.max(0, pending.length - pendingIndex - 1)

  const sortedCandidates = useMemo(() => {
    const list = [...candidates]
    if (sortBy === 'pantry') {
      list.sort((a, b) => (b.insights?.pantryMatchCount || 0) - (a.insights?.pantryMatchCount || 0))
    } else if (sortBy === 'time') {
      list.sort((a, b) => (a.totalTimeMinutes || a.cookTimeMinutes || 999) - (b.totalTimeMinutes || b.cookTimeMinutes || 999))
    } else {
      list.sort((a, b) => (a.insights?.ingredientCount || a.ingredients.length) - (b.insights?.ingredientCount || b.ingredients.length))
    }
    return list
  }, [candidates, sortBy])

  const sortedPending = useMemo(() => {
    const list = [...pending]
    if (sortBy === 'pantry') {
      list.sort((a, b) => pantryMatchCount(b, pantrySet) - pantryMatchCount(a, pantrySet))
    } else if (sortBy === 'time') {
      list.sort((a, b) => (a.totalTimeMinutes || a.cookTimeMinutes || 999) - (b.totalTimeMinutes || b.cookTimeMinutes || 999))
    } else {
      list.sort((a, b) => (b.recipeIngredients?.length || 0) - (a.recipeIngredients?.length || 0))
    }
    return list
  }, [pending, sortBy, pantrySet])

  const handleSwipe = (status: 'approved' | 'rejected') => {
    if (sourceTab === 'theme') {
      if (!candidates || candidateIndex >= candidates.length) return
      const candidate = candidates[candidateIndex]
      candidateStatusMutation.mutate({ id: candidate.id, status })
      setCandidateIndex(prev => prev + 1)
      return
    }

    if (!pending || pendingIndex >= pending.length) return
    const recipe = pending[pendingIndex]
    pendingStatusMutation.mutate({ id: recipe.id, status })
    setPendingIndex(prev => prev + 1)
  }

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const clearSelection = () => setSelectedIds({})

  const selectAll = (ids: string[]) => {
    const next: Record<string, boolean> = {}
    ids.forEach(id => { next[id] = true })
    setSelectedIds(next)
  }

  const selectedList = Object.keys(selectedIds).filter(id => selectedIds[id])

  const handleBulk = (status: 'approved' | 'rejected') => {
    if (selectedList.length === 0) return

    if (sourceTab === 'theme') {
      candidateBulkMutation.mutate({ ids: selectedList, status })
      return
    }

    selectedList.forEach(id => {
      pendingStatusMutation.mutate({ id, status })
    })
    clearSelection()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Discover Recipes</h1>
        <div className="flex items-center gap-2">
          <ToggleButton
            active={reviewMode === 'swipe'}
            onClick={() => setReviewMode('swipe')}
            icon={SquareCheckBig}
            label="Swipe"
          />
          <ToggleButton
            active={reviewMode === 'batch'}
            onClick={() => setReviewMode('batch')}
            icon={LayoutGrid}
            label="Batch"
          />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!themeQuery.trim()) return
          searchMutation.mutate()
        }}
        className="bg-white rounded-xl shadow p-4 space-y-4"
      >
        <div className="flex items-center gap-3">
          <Search className="w-5 h-5 text-gray-500" />
          <input
            value={themeQuery}
            onChange={(e) => setThemeQuery(e.target.value)}
            placeholder="Theme, ingredient, dish, or idea"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!themeQuery.trim() || searchMutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {searchMutation.isPending ? 'Searching...' : 'Find Recipes'}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={themeMealType}
            onChange={(e) => setThemeMealType(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="">Any meal type</option>
            {MEAL_TYPES.map(type => (
              <option key={type} value={type}>{capitalize(type)}</option>
            ))}
          </select>
          <input
            type="number"
            min={5}
            value={themeMaxTime}
            onChange={(e) => setThemeMaxTime(e.target.value)}
            placeholder="Max minutes"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            type="number"
            min={5}
            value={themeLimit}
            onChange={(e) => setThemeLimit(parseInt(e.target.value || '20', 10))}
            placeholder="Result limit"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        {searchMutation.data && (
          <p className="text-sm text-gray-600">
            Found {searchMutation.data.createdCount} recipes (skipped {searchMutation.data.skippedDuplicates} duplicates).
          </p>
        )}
      </form>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TabButton
            active={sourceTab === 'theme'}
            onClick={() => setSourceTab('theme')}
            label="Theme Results"
          />
          <TabButton
            active={sourceTab === 'pending'}
            onClick={() => setSourceTab('pending')}
            label="Pending Imports"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Sort by</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'pantry' | 'time' | 'ingredients')}
            className="px-2 py-1 border border-gray-200 rounded-md text-xs"
          >
            <option value="pantry">Pantry match</option>
            <option value="time">Time</option>
            <option value="ingredients">Ingredient count</option>
          </select>
        </div>
      </div>

      {reviewMode === 'swipe' ? (
        <div className="max-w-md mx-auto">
          {isSwipeLoading && (
            <div className="flex items-center justify-center min-h-[400px]">
              <p className="text-gray-500">Loading recipes...</p>
            </div>
          )}

          {!isSwipeLoading && !activeSwipeItem && sourceTab === 'theme' && !activeBatchId && (
            <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
              <p className="text-xl font-medium text-gray-900 mb-2">Search for a theme</p>
              <p className="text-gray-500">Run a theme search to populate the review queue.</p>
            </div>
          )}

          {!isSwipeLoading && !activeSwipeItem && !(sourceTab === 'theme' && !activeBatchId) && (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
              <p className="text-xl font-medium text-gray-900 mb-2">All caught up!</p>
              <p className="text-gray-500">No more recipes to review.</p>
            </div>
          )}

          {!isSwipeLoading && activeSwipeItem && sourceTab === 'theme' && (
            <CandidateSwipeCard
              candidate={activeSwipeItem as RecipeCandidate}
              onApprove={() => handleSwipe('approved')}
              onReject={() => handleSwipe('rejected')}
              disabled={candidateStatusMutation.isPending}
            />
          )}

          {!isSwipeLoading && activeSwipeItem && sourceTab === 'pending' && (
            <PendingSwipeCard
              recipe={activeSwipeItem as Recipe}
              pantrySet={pantrySet}
              onApprove={() => handleSwipe('approved')}
              onReject={() => handleSwipe('rejected')}
              disabled={pendingStatusMutation.isPending}
            />
          )}

          {!isSwipeLoading && activeSwipeItem && (
            <p className="text-center text-sm text-gray-500 mt-4">
              {swipeRemaining} recipes remaining
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {sourceTab === 'theme' && !activeBatchId && (
            <p className="text-sm text-gray-500">Run a theme search to load candidates.</p>
          )}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedList.length} selected
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulk('rejected')}
                disabled={selectedList.length === 0 || candidateBulkMutation.isPending || pendingStatusMutation.isPending}
                className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50"
              >
                Reject Selected
              </button>
              <button
                onClick={() => handleBulk('approved')}
                disabled={selectedList.length === 0 || candidateBulkMutation.isPending || pendingStatusMutation.isPending}
                className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
              >
                Approve Selected
              </button>
              <button
                onClick={() => clearSelection()}
                className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => selectAll(sourceTab === 'theme' ? sortedCandidates.map(c => c.id) : sortedPending.map(r => r.id))}
              className="text-xs text-gray-500 underline"
            >
              Select all
            </button>
          </div>

          {sourceTab === 'theme' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sortedCandidates.map(candidate => (
                <CandidateBatchCard
                  key={candidate.id}
                  candidate={candidate}
                  selected={Boolean(selectedIds[candidate.id])}
                  onToggle={() => toggleSelection(candidate.id)}
                />
              ))}
            </div>
          )}

          {sourceTab === 'pending' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sortedPending.map(recipe => (
                <PendingBatchCard
                  key={recipe.id}
                  recipe={recipe}
                  pantrySet={pantrySet}
                  selected={Boolean(selectedIds[recipe.id])}
                  onToggle={() => toggleSelection(recipe.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CandidateSwipeCard({
  candidate,
  onApprove,
  onReject,
  disabled,
}: {
  candidate: RecipeCandidate
  onApprove: () => void
  onReject: () => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const startYRef = useRef<number | null>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    startYRef.current = e.clientY
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startYRef.current === null) return
    const delta = e.clientY - startYRef.current
    if (delta > 40) setExpanded(true)
    if (delta < -40) setExpanded(false)
    startYRef.current = null
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {candidate.imageUrl ? (
        <img src={candidate.imageUrl} alt={candidate.name} className="w-full h-64 object-cover" />
      ) : (
        <div className="w-full h-64 bg-gray-100 flex items-center justify-center text-gray-400">No image</div>
      )}

      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 py-2 bg-gray-50"
      >
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {expanded ? 'Swipe up to collapse' : 'Swipe down for full recipe'}
      </button>

      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{candidate.name}</h2>
        {candidate.description && (
          <p className="text-gray-600 mb-4 line-clamp-2">{candidate.description}</p>
        )}

        <div className="grid grid-cols-3 gap-4 mb-4">
          <Stat icon={Clock} label="Time" value={`${candidate.totalTimeMinutes || candidate.cookTimeMinutes || '-'} min`} />
          <Stat icon={Users} label="Servings" value={candidate.servings ? candidate.servings.toString() : '-'} />
          <Stat icon={SquareCheckBig} label="Ingredients" value={`${candidate.insights?.ingredientCount || candidate.ingredients.length}`} />
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          <Tag>{candidate.sourceName}</Tag>
        </div>

        {candidate.insights && (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-gray-700">Pantry Match</h3>
              <p className="text-sm text-gray-600">
                You have {candidate.insights.pantryMatchCount}/{candidate.insights.ingredientCount} ingredients
              </p>
              {candidate.insights.pantryMatchNames.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  On hand: {candidate.insights.pantryMatchNames.join(', ')}
                </p>
              )}
            </div>
            {candidate.insights.unusualIngredients.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700">Unusual Ingredients</h3>
                <div className="flex flex-wrap gap-2 mt-1">
                  {candidate.insights.unusualIngredients.map(item => (
                    <Tag key={item} variant="secondary">{item}</Tag>
                  ))}
                </div>
              </div>
            )}
            {candidate.insights.reasons.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {candidate.insights.reasons.map(reason => (
                  <span key={reason} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full">
                    {reason}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-gray-100 p-6 bg-gray-50 space-y-4 max-h-[420px] overflow-y-auto">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Ingredients</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              {candidate.ingredients.map((ing, idx) => (
                <li key={`${ing}-${idx}`}>• {ing}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Instructions</h3>
            <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
              {candidate.instructions.map((step, idx) => (
                <li key={`${idx}-${step}`}>{step}</li>
              ))}
            </ol>
            {candidate.instructions.length === 0 && (
              <p className="text-sm text-gray-500">No instructions available.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex border-t border-gray-100">
        <button
          onClick={onReject}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <ThumbsDown className="w-6 h-6" />
          <span className="font-medium">Pass</span>
        </button>
        <button
          onClick={onApprove}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50 border-l border-gray-100"
        >
          <ThumbsUp className="w-6 h-6" />
          <span className="font-medium">Approve</span>
        </button>
      </div>
    </div>
  )
}

function PendingSwipeCard({
  recipe,
  pantrySet,
  onApprove,
  onReject,
  disabled,
}: {
  recipe: Recipe
  pantrySet: Set<string>
  onApprove: () => void
  onReject: () => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const startYRef = useRef<number | null>(null)

  const { data: fullRecipe } = useQuery({
    queryKey: ['recipe', recipe.id, 'full'],
    queryFn: () => recipes.get(recipe.id),
    enabled: expanded,
  })

  const matchCount = pantryMatchCount(recipe, pantrySet)
  const matchNames = pantryMatchNames(recipe, pantrySet)
  const ingredientCount = recipe.recipeIngredients?.length || 0
  const reasons: string[] = []
  const timeValue = recipe.totalTimeMinutes || recipe.cookTimeMinutes
  if (matchCount >= 2) reasons.push(`Uses ${matchCount} pantry items`)
  if (timeValue && timeValue <= 30) reasons.push('Quick (<30 min)')
  if (ingredientCount <= 7) reasons.push('Few ingredients')

  const handlePointerDown = (e: React.PointerEvent) => {
    startYRef.current = e.clientY
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startYRef.current === null) return
    const delta = e.clientY - startYRef.current
    if (delta > 40) setExpanded(true)
    if (delta < -40) setExpanded(false)
    startYRef.current = null
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      <RecipePhoto
        recipeId={recipe.id}
        photoUrl={recipe.photoUrl}
        recipeName={recipe.name}
        size="lg"
        editable={true}
      />

      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 py-2 bg-gray-50"
      >
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {expanded ? 'Swipe up to collapse' : 'Swipe down for full recipe'}
      </button>

      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{recipe.name}</h2>
        {recipe.description && (
          <p className="text-gray-600 mb-4 line-clamp-2">{recipe.description}</p>
        )}

        <div className="grid grid-cols-3 gap-4 mb-4">
          <Stat icon={Clock} label="Time" value={`${recipe.totalTimeMinutes || recipe.cookTimeMinutes} min`} />
          <Stat icon={Users} label="Servings" value={recipe.servings.toString()} />
          <Stat icon={SquareCheckBig} label="Ingredients" value={`${ingredientCount}`} />
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          {recipe.source && <Tag variant="secondary">{recipe.source}</Tag>}
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium text-gray-700">Pantry Match</h3>
            <p className="text-sm text-gray-600">You have {matchCount}/{ingredientCount} ingredients</p>
            {matchNames.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                On hand: {matchNames.join(', ')}
              </p>
            )}
          </div>
          {reasons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {reasons.map(reason => (
                <span key={reason} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full">
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 p-6 bg-gray-50 space-y-4 max-h-[420px] overflow-y-auto">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Ingredients</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              {(fullRecipe?.recipeIngredients || recipe.recipeIngredients || []).map((ri, idx) => (
                <li key={`${ri.ingredient.name}-${idx}`}>• {ri.ingredient.name}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Instructions</h3>
            <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
              {(fullRecipe?.recipeInstructions || []).map((step, idx) => (
                <li key={`${idx}-${step.instructionText}`}>{step.instructionText}</li>
              ))}
            </ol>
            {!fullRecipe?.recipeInstructions?.length && (
              <p className="text-sm text-gray-500">No instructions available.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex border-t border-gray-100">
        <button
          onClick={onReject}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <ThumbsDown className="w-6 h-6" />
          <span className="font-medium">Pass</span>
        </button>
        <button
          onClick={onApprove}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50 border-l border-gray-100"
        >
          <ThumbsUp className="w-6 h-6" />
          <span className="font-medium">Approve</span>
        </button>
      </div>
    </div>
  )
}

function CandidateBatchCard({
  candidate,
  selected,
  onToggle,
}: {
  candidate: RecipeCandidate
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div className={clsx('bg-white rounded-lg border p-4 space-y-3', selected ? 'border-green-400' : 'border-gray-200')}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{candidate.name}</p>
          <p className="text-xs text-gray-500">{candidate.sourceName}</p>
        </div>
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-600">
        <span>{candidate.totalTimeMinutes || candidate.cookTimeMinutes || '-'} min</span>
        <span>{candidate.insights?.ingredientCount || candidate.ingredients.length} ingredients</span>
        <span>{candidate.insights?.pantryMatchCount || 0} pantry</span>
      </div>
      {candidate.insights?.reasons?.length ? (
        <div className="flex flex-wrap gap-2">
          {candidate.insights.reasons.slice(0, 3).map(reason => (
            <span key={reason} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
              {reason}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PendingBatchCard({
  recipe,
  pantrySet,
  selected,
  onToggle,
}: {
  recipe: Recipe
  pantrySet: Set<string>
  selected: boolean
  onToggle: () => void
}) {
  const matchCount = pantryMatchCount(recipe, pantrySet)
  const ingredientCount = recipe.recipeIngredients?.length || 0

  return (
    <div className={clsx('bg-white rounded-lg border p-4 space-y-3', selected ? 'border-green-400' : 'border-gray-200')}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{recipe.name}</p>
          <p className="text-xs text-gray-500">{recipe.source || 'Imported'}</p>
        </div>
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-600">
        <span>{recipe.totalTimeMinutes || recipe.cookTimeMinutes || '-'} min</span>
        <span>{ingredientCount} ingredients</span>
        <span>{matchCount} pantry</span>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-gray-400" />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-medium text-gray-900">{value}</p>
      </div>
    </div>
  )
}

function Tag({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <span className={clsx(
      'px-2 py-1 text-xs rounded-full capitalize',
      variant === 'primary' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
    )}>
      {children}
    </span>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-4 py-2 text-sm rounded-full border',
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
      )}
    >
      {label}
    </button>
  )
}

function ToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm',
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function pantryMatchCount(recipe: Recipe, pantrySet: Set<string>) {
  const ingredientNames = recipe.recipeIngredients?.map(ri => normalizeName(ri.ingredient.name)) || []
  const unique = new Set(ingredientNames)
  let count = 0
  unique.forEach(name => {
    if (pantrySet.has(name)) count += 1
  })
  return count
}

function pantryMatchNames(recipe: Recipe, pantrySet: Set<string>) {
  const names: string[] = []
  const seen = new Set<string>()
  recipe.recipeIngredients?.forEach(ri => {
    const normalized = normalizeName(ri.ingredient.name)
    if (pantrySet.has(normalized) && !seen.has(normalized)) {
      seen.add(normalized)
      if (names.length < 5) names.push(ri.ingredient.name)
    }
  })
  return names
}
