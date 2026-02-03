'use client'

import { Plus, Minus, X, Sparkles, GripVertical } from 'lucide-react'
import type { Recipe } from '@/lib/api'
import RecipePhoto from './RecipePhoto'

export interface StagedMeal {
  id: string
  recipe: Recipe
  servings: number
}

interface StagedMealsListProps {
  stagedMeals: StagedMeal[]
  onUpdateServings: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onAutoAssign: () => void
  isAssigning?: boolean
  onDragStart?: (meal: StagedMeal) => void
  onDragEnd?: () => void
}

export function StagedMealsList({ 
  stagedMeals, 
  onUpdateServings, 
  onRemove, 
  onAutoAssign,
  isAssigning = false,
  onDragStart,
  onDragEnd
}: StagedMealsListProps) {
  const totalServings = stagedMeals.reduce((sum, meal) => sum + meal.servings, 0)
  
  return (
    <div className="bg-white rounded-lg shadow h-full overflow-hidden flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">This Week's Meals</h2>
          {stagedMeals.length > 0 && (
            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {totalServings} servings
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500">
          {stagedMeals.length === 0 
            ? 'Add recipes from the pool to get started'
            : `Drag to calendar or auto-fill`
          }
        </p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {stagedMeals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-500 text-sm">
              Select recipes from the pool to start planning your week
            </p>
          </div>
        ) : (
          stagedMeals.map(meal => (
            <StagedMealCard
              key={meal.id}
              meal={meal}
              onUpdateServings={onUpdateServings}
              onRemove={onRemove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
      
      {stagedMeals.length > 0 && (
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={onAutoAssign}
            disabled={isAssigning}
            className="w-full px-4 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium flex items-center justify-center gap-2 shadow-lg hover:shadow-xl"
          >
            <Sparkles className={`w-5 h-5 ${!isAssigning && 'animate-pulse'}`} />
            {isAssigning ? 'Assigning...' : 'Auto-Fill Week'}
          </button>
        </div>
      )}
    </div>
  )
}

interface StagedMealCardProps {
  meal: StagedMeal
  onUpdateServings: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onDragStart?: (meal: StagedMeal) => void
  onDragEnd?: () => void
}

function StagedMealCard({ meal, onUpdateServings, onRemove, onDragStart, onDragEnd }: StagedMealCardProps) {
  const mealTypeColors = {
    breakfast: 'bg-orange-50 border-orange-200',
    lunch: 'bg-green-50 border-green-200',
    dinner: 'bg-blue-50 border-blue-200',
    snack: 'bg-purple-50 border-purple-200',
  }
  
  const bgColor = mealTypeColors[meal.recipe.mealType as keyof typeof mealTypeColors] || 'bg-gray-50 border-gray-200'
  
  return (
    <div 
      draggable
      onDragStart={() => onDragStart?.(meal)}
      onDragEnd={() => onDragEnd?.()}
      className={`border-2 ${bgColor} rounded-lg p-3 transition-all animate-fade-in-up cursor-move hover:shadow-md active:opacity-50`}
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center text-gray-400 cursor-move">
          <GripVertical className="w-4 h-4" />
        </div>
        <RecipePhoto
          recipeId={meal.recipe.id}
          photoUrl={meal.recipe.photoUrl}
          recipeName={meal.recipe.name}
          size="sm"
          editable={false}
        />
        
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 text-sm mb-1 truncate">
            {meal.recipe.name}
          </h3>
          <p className="text-xs text-gray-500 capitalize mb-2">
            {meal.recipe.mealType} · {meal.recipe.cookTimeMinutes} min
          </p>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdateServings(meal.id, -1)}
              disabled={meal.servings <= 1}
              className="p-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            
            <span className="text-sm font-semibold text-gray-900 min-w-[60px] text-center">
              {meal.servings} servings
            </span>
            
            <button
              onClick={() => onUpdateServings(meal.id, 1)}
              className="p-1 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
        
        <button
          onClick={() => onRemove(meal.id)}
          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          title="Remove"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
