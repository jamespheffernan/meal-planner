'use client'

import { X, Clock, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { recipes as recipesApi, type Recipe } from '@/lib/api'
import RecipePhoto from './RecipePhoto'

export function RecipePreviewModal({
  recipeId,
  initialRecipe,
  onClose,
  onAdd,
}: {
  recipeId: string
  initialRecipe?: Recipe | null
  onClose: () => void
  onAdd?: (recipe: Recipe) => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipesApi.get(recipeId),
    initialData: initialRecipe ?? undefined,
  })

  const recipe = data

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {recipe?.name || 'Recipe'}
            </h2>
            {recipe && (
              <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {recipe.cookTimeMinutes} min
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {recipe.servings} servings
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close preview"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 overflow-auto">
          {error ? (
            <p className="text-sm text-red-600">Failed to load recipe.</p>
          ) : isLoading && !recipe ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : recipe ? (
            <div className="space-y-6">
              <RecipePhoto
                recipeId={recipe.id}
                photoUrl={recipe.photoUrl}
                recipeName={recipe.name}
                size="lg"
                editable={false}
              />

              {recipe.description && recipe.description.trim() && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Description</h3>
                  <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{recipe.description}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Ingredients</h3>
                  {recipe.recipeIngredients && recipe.recipeIngredients.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {recipe.recipeIngredients.map(ri => (
                        <li key={ri.id} className="flex gap-2">
                          <span className="text-gray-900">
                            {ri.quantity} {ri.unit}
                          </span>
                          <span className="min-w-0">
                            {ri.ingredient?.name || 'Ingredient'}
                            {ri.notes ? <span className="text-gray-500"> ({ri.notes})</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">No ingredients.</p>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Instructions</h3>
                  {recipe.recipeInstructions && recipe.recipeInstructions.length > 0 ? (
                    <ol className="mt-2 space-y-2 text-sm text-gray-700 list-decimal list-inside">
                      {recipe.recipeInstructions
                        .slice()
                        .sort((a, b) => a.stepNumber - b.stepNumber)
                        .map(step => (
                          <li key={step.id}>
                            <span className="whitespace-pre-wrap">{step.instructionText}</span>
                          </li>
                        ))}
                    </ol>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">No instructions.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {recipe && onAdd && (
          <div className="p-4 border-t border-gray-200 flex justify-end">
            <button
              onClick={() => onAdd(recipe)}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              Add to week
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

