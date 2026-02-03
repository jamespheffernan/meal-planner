'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { recipes } from '@/lib/api'
import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Clock, Users, Flame, DollarSign } from 'lucide-react'
import clsx from 'clsx'
import RecipePhoto from '@/components/RecipePhoto'

export default function DiscoverPage() {
  const queryClient = useQueryClient()
  const [currentIndex, setCurrentIndex] = useState(0)

  const { data: pendingRecipes, isLoading } = useQuery({
    queryKey: ['recipes', 'discover'],
    queryFn: () => recipes.discover(20),
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      recipes.updateApproval(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  const handleSwipe = (status: 'approved' | 'rejected') => {
    if (!pendingRecipes || currentIndex >= pendingRecipes.length) return

    const recipe = pendingRecipes[currentIndex]
    approveMutation.mutate({ id: recipe.id, status })
    setCurrentIndex(prev => prev + 1)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500">Loading recipes...</p>
      </div>
    )
  }

  if (!pendingRecipes || pendingRecipes.length === 0 || currentIndex >= pendingRecipes.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-xl font-medium text-gray-900 mb-2">All caught up!</p>
        <p className="text-gray-500">No more recipes to review. Add some recipes to get started.</p>
      </div>
    )
  }

  const recipe = pendingRecipes[currentIndex]

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Discover Recipes</h1>

      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Recipe Image - clickable to upload/find */}
        <RecipePhoto
          recipeId={recipe.id}
          photoUrl={recipe.photoUrl}
          recipeName={recipe.name}
          size="lg"
          editable={true}
        />

        {/* Recipe Details */}
        <div className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{recipe.name}</h2>

          {recipe.description && (
            <p className="text-gray-600 mb-4 line-clamp-2">{recipe.description}</p>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Stat icon={Clock} label="Time" value={`${recipe.totalTimeMinutes || recipe.cookTimeMinutes} min`} />
            <Stat icon={Users} label="Servings" value={recipe.servings.toString()} />
            {recipe.estimatedCaloriesPerServing && (
              <Stat icon={Flame} label="Calories" value={`${recipe.estimatedCaloriesPerServing} cal`} />
            )}
            {recipe.estimatedCostPerServing && (
              <Stat icon={DollarSign} label="Cost" value={`£${recipe.estimatedCostPerServing}`} />
            )}
          </div>

          <div className="flex gap-2 flex-wrap mb-4">
            <Tag>{recipe.mealType}</Tag>
            <Tag>{recipe.cookingStyle.replace('_', ' ')}</Tag>
            {recipe.source && <Tag variant="secondary">{recipe.source}</Tag>}
          </div>

          {/* Ingredients Preview */}
          {recipe.recipeIngredients && recipe.recipeIngredients.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Key Ingredients</h3>
              <p className="text-sm text-gray-600">
                {recipe.recipeIngredients.slice(0, 5).map(ri => ri.ingredient.name).join(', ')}
                {recipe.recipeIngredients.length > 5 && ` +${recipe.recipeIngredients.length - 5} more`}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex border-t border-gray-100">
          <button
            onClick={() => handleSwipe('rejected')}
            disabled={approveMutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-4 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <ThumbsDown className="w-6 h-6" />
            <span className="font-medium">Pass</span>
          </button>
          <button
            onClick={() => handleSwipe('approved')}
            disabled={approveMutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-4 text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50 border-l border-gray-100"
          >
            <ThumbsUp className="w-6 h-6" />
            <span className="font-medium">Approve</span>
          </button>
        </div>
      </div>

      <p className="text-center text-sm text-gray-500 mt-4">
        {pendingRecipes.length - currentIndex - 1} recipes remaining
      </p>
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
