'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { recipes } from '@/lib/api'
import { useParams, useRouter } from 'next/navigation'
import { Clock, Users, Flame, DollarSign, ChevronLeft, Calendar, Trash2, Edit, Check } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { Recipe } from '@/lib/api'
import RecipePhoto from '@/components/RecipePhoto'
import { formatIngredientQuantity } from '@/lib/units'

export default function RecipeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const id = params.id as string

  const { data: recipe, isLoading, error } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipes.get(id),
    enabled: !!id,
  })

  const deleteMutation = useMutation({
    mutationFn: () => recipes.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      router.push('/recipes')
    },
  })

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500">Loading recipe...</p>
      </div>
    )
  }

  if (error || !recipe) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-gray-500 mb-4">Recipe not found</p>
        <Link href="/recipes" className="text-blue-600 hover:underline">
          Back to recipes
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/recipes"
          className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to recipes
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/recipes/${id}/edit`}
            className="flex items-center gap-1 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <Edit className="w-4 h-4" />
            Edit
          </Link>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Recipe Card */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Image - clickable to upload/change */}
        <RecipePhoto
          recipeId={recipe.id}
          photoUrl={recipe.photoUrl}
          recipeName={recipe.name}
          size="lg"
          editable={true}
        />

        {/* Content */}
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{recipe.name}</h1>
              {recipe.description && (
                <p className="text-gray-600">{recipe.description}</p>
              )}
            </div>
            <ApprovalBadge status={recipe.approvalStatus} />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
            <Stat
              icon={Clock}
              label="Cook Time"
              value={`${recipe.cookTimeMinutes} min`}
            />
            {recipe.prepTimeMinutes && (
              <Stat
                icon={Clock}
                label="Prep Time"
                value={`${recipe.prepTimeMinutes} min`}
              />
            )}
            <Stat
              icon={Users}
              label="Servings"
              value={recipe.servings.toString()}
            />
            {recipe.estimatedCaloriesPerServing && (
              <Stat
                icon={Flame}
                label="Calories"
                value={`${recipe.estimatedCaloriesPerServing} cal`}
              />
            )}
            {recipe.estimatedCostPerServing && (
              <Stat
                icon={DollarSign}
                label="Cost/Serving"
                value={`£${recipe.estimatedCostPerServing}`}
              />
            )}
          </div>

          {/* Tags */}
          <div className="flex gap-2 flex-wrap mb-6">
            <Tag>{recipe.mealType}</Tag>
            <Tag>{recipe.cookingStyle.replace('_', ' ')}</Tag>
            {recipe.source && <Tag variant="secondary">{recipe.source}</Tag>}
            {recipe.timesCooked > 0 && (
              <Tag variant="secondary">Cooked {recipe.timesCooked}x</Tag>
            )}
          </div>

          {/* Ingredients */}
          {recipe.recipeIngredients && recipe.recipeIngredients.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Ingredients</h2>
              <ul className="space-y-2">
                {recipe.recipeIngredients.map((ri) => (
                  <li key={ri.id} className="flex items-center gap-3">
                    <span className="w-2 h-2 bg-orange-400 rounded-full flex-shrink-0" />
                    <span className="text-gray-700">
                      <strong>{formatIngredientQuantity(ri.quantity, ri.unit)}</strong> {ri.ingredient.name}
                      {ri.notes && <span className="text-gray-500"> ({ri.notes})</span>}
                      {ri.optional && <span className="text-gray-400 text-sm"> - optional</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Instructions */}
          {recipe.recipeInstructions && recipe.recipeInstructions.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Instructions</h2>
              <ol className="space-y-4">
                {recipe.recipeInstructions
                  .sort((a, b) => a.stepNumber - b.stepNumber)
                  .map((instruction) => (
                    <li key={instruction.id} className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-medium">
                        {instruction.stepNumber}
                      </span>
                      <p className="text-gray-700 pt-1">{instruction.instructionText}</p>
                    </li>
                  ))}
              </ol>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <Link
              href={`/meal-plan?recipeId=${recipe.id}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
            >
              <Calendar className="w-5 h-5" />
              Add to Meal Plan
            </Link>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Recipe?</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete &quot;{recipe.name}&quot;? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="text-center">
      <Icon className="w-5 h-5 text-gray-400 mx-auto mb-1" />
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}

function Tag({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <span className={`px-3 py-1 text-sm rounded-full capitalize ${
      variant === 'primary' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
    }`}>
      {children}
    </span>
  )
}

function ApprovalBadge({ status }: { status: Recipe['approvalStatus'] }) {
  const styles = {
    approved: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    rejected: 'bg-red-100 text-red-800',
    archived: 'bg-gray-100 text-gray-600',
  }

  return (
    <span className={`px-3 py-1 text-sm rounded-full capitalize ${styles[status]}`}>
      {status === 'approved' && <Check className="w-4 h-4 inline mr-1" />}
      {status}
    </span>
  )
}
