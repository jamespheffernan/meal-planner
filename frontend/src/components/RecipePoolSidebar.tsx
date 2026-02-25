'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Clock } from 'lucide-react'
import type { Recipe } from '@/lib/api'
import RecipePhoto from './RecipePhoto'

interface RecipePoolSidebarProps {
  recipes: Recipe[]
  onAddRecipe: (recipe: Recipe) => void
  onPreviewRecipe?: (recipe: Recipe) => void
}

function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickBestRecipe(a: Recipe, b: Recipe): Recipe {
  const aScore =
    (a.approvalStatus === 'approved' ? 1000 : 0) +
    (a.timesCooked || 0) * 10 +
    (a.photoUrl ? 5 : 0) +
    (a.description && a.description.trim() ? 2 : 0)
  const bScore =
    (b.approvalStatus === 'approved' ? 1000 : 0) +
    (b.timesCooked || 0) * 10 +
    (b.photoUrl ? 5 : 0) +
    (b.description && b.description.trim() ? 2 : 0)
  if (aScore !== bScore) return aScore > bScore ? a : b
  // Stable tie-breaker so React keys don't churn.
  return a.id < b.id ? a : b
}

function dedupeByName(recipes: Recipe[]): Recipe[] {
  const byKey = new Map<string, Recipe>()
  for (const r of recipes) {
    const key = `${r.mealType}:${normalizeName(r.name)}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, r)
      continue
    }
    byKey.set(key, pickBestRecipe(existing, r))
  }
  return Array.from(byKey.values())
}

export function RecipePoolSidebar({ recipes, onAddRecipe, onPreviewRecipe }: RecipePoolSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['breakfast', 'lunch', 'dinner'])
  )
  
  // UI-level dedupe: users generally expect "same name" to appear once in the pool.
  const uniqueRecipes = dedupeByName(recipes)

  // Lunch and dinner recipes are interchangeable
  const lunchAndDinnerRecipes = uniqueRecipes.filter(r => r.mealType === 'lunch' || r.mealType === 'dinner')
  
  const recipesByType = {
    breakfast: uniqueRecipes.filter(r => r.mealType === 'breakfast'),
    lunch: lunchAndDinnerRecipes,
    dinner: lunchAndDinnerRecipes,
  }
  
  const toggleSection = (mealType: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(mealType)) {
        next.delete(mealType)
      } else {
        next.add(mealType)
      }
      return next
    })
  }
  
  return (
    <div className="bg-white h-full overflow-hidden flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Recipe Pool</h2>
        <p className="text-sm text-gray-500 mt-1">
          {uniqueRecipes.length} approved recipes
        </p>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <RecipeSection
          title="Breakfast"
          recipes={recipesByType.breakfast}
          isExpanded={expandedSections.has('breakfast')}
          onToggle={() => toggleSection('breakfast')}
          onAddRecipe={onAddRecipe}
          onPreviewRecipe={onPreviewRecipe}
          color="orange"
        />
        
        <RecipeSection
          title="Lunch"
          recipes={recipesByType.lunch}
          isExpanded={expandedSections.has('lunch')}
          onToggle={() => toggleSection('lunch')}
          onAddRecipe={onAddRecipe}
          onPreviewRecipe={onPreviewRecipe}
          color="green"
        />
        
        <RecipeSection
          title="Dinner"
          recipes={recipesByType.dinner}
          isExpanded={expandedSections.has('dinner')}
          onToggle={() => toggleSection('dinner')}
          onAddRecipe={onAddRecipe}
          onPreviewRecipe={onPreviewRecipe}
          color="blue"
        />
      </div>
    </div>
  )
}

interface RecipeSectionProps {
  title: string
  recipes: Recipe[]
  isExpanded: boolean
  onToggle: () => void
  onAddRecipe: (recipe: Recipe) => void
  onPreviewRecipe?: (recipe: Recipe) => void
  color: 'orange' | 'green' | 'blue'
}

function RecipeSection({ title, recipes, isExpanded, onToggle, onAddRecipe, onPreviewRecipe, color }: RecipeSectionProps) {
  const colorClasses = {
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  }
  
  return (
    <div className="border-b border-gray-100">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
          <span className="font-medium text-gray-900">{title}</span>
          <span className={`px-2 py-0.5 text-xs rounded-full ${colorClasses[color]}`}>
            {recipes.length}
          </span>
        </div>
      </button>
      
      {isExpanded && (
        <div className="px-2 pb-2 space-y-1">
          {recipes.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No {title.toLowerCase()} recipes
            </p>
          ) : (
            recipes.map(recipe => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onAdd={() => onAddRecipe(recipe)}
                onPreview={() => onPreviewRecipe?.(recipe)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface RecipeCardProps {
  recipe: Recipe
  onAdd: () => void
  onPreview?: () => void
}

function RecipeCard({ recipe, onAdd, onPreview }: RecipeCardProps) {
  return (
    <div className="group flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition-all hover:scale-[1.02] hover:shadow-sm">
      <button
        type="button"
        onClick={onPreview}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
        title="Preview recipe"
      >
        <RecipePhoto
          recipeId={recipe.id}
          photoUrl={recipe.photoUrl}
          recipeName={recipe.name}
          size="xs"
          editable={false}
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {recipe.name}
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            <span>{recipe.cookTimeMinutes} min</span>
            <span>·</span>
            <span>{recipe.servings} servings</span>
          </div>
        </div>
      </button>
      
      <button
        onClick={onAdd}
        className="p-1.5 bg-gray-900 text-white rounded-lg opacity-0 group-hover:opacity-100 hover:bg-gray-800 transition-all"
        title="Add to week"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}
