'use client'

import { useQuery } from '@tanstack/react-query'
import { recipes } from '@/lib/api'
import { useState } from 'react'
import Link from 'next/link'
import { Clock, Users, Plus, Search, Filter } from 'lucide-react'
import clsx from 'clsx'

const MEAL_TYPES = ['all', 'breakfast', 'lunch', 'dinner', 'snack'] as const
const APPROVAL_STATUSES = ['approved', 'pending', 'rejected', 'archived'] as const

export default function RecipesPage() {
  const [mealType, setMealType] = useState<string>('all')
  const [approvalStatus, setApprovalStatus] = useState<string>('approved')
  const [search, setSearch] = useState('')

  const { data: recipeList, isLoading } = useQuery({
    queryKey: ['recipes', { mealType, approvalStatus }],
    queryFn: () => recipes.list({
      mealType: mealType !== 'all' ? mealType : undefined,
      approvalStatus,
    }),
  })

  const filteredRecipes = recipeList?.filter(recipe =>
    !search || recipe.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Recipes</h1>
        <Link
          href="/recipes/new"
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          <Plus className="w-4 h-4" />
          Add Recipe
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          {/* Meal Type Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <div className="flex gap-1">
              {MEAL_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setMealType(type)}
                  className={clsx(
                    'px-3 py-1 text-sm rounded-full capitalize transition-colors',
                    mealType === type
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div className="flex gap-1">
            {APPROVAL_STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => setApprovalStatus(status)}
                className={clsx(
                  'px-3 py-1 text-sm rounded-full capitalize transition-colors',
                  approvalStatus === status
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recipe Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-500">Loading recipes...</p>
        </div>
      ) : filteredRecipes && filteredRecipes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No recipes found</p>
          <Link href="/import" className="text-blue-600 hover:underline">
            Import some recipes
          </Link>
        </div>
      )}
    </div>
  )
}

function RecipeCard({ recipe }: { recipe: ReturnType<typeof recipes.list> extends Promise<(infer R)[]> ? R : never }) {
  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="bg-white rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden"
    >
      {recipe.photoUrl ? (
        <img
          src={recipe.photoUrl}
          alt={recipe.name}
          className="w-full h-48 object-cover"
        />
      ) : (
        <div className="w-full h-48 bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center">
          <span className="text-white text-4xl">🍽️</span>
        </div>
      )}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-1 line-clamp-1">{recipe.name}</h3>
        {recipe.description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-2">{recipe.description}</p>
        )}
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {recipe.totalTimeMinutes || recipe.cookTimeMinutes} min
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-4 h-4" />
            {recipe.servings}
          </span>
        </div>
        <div className="flex gap-2 mt-3">
          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full capitalize">
            {recipe.mealType}
          </span>
          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full capitalize">
            {recipe.cookingStyle.replace('_', ' ')}
          </span>
        </div>
      </div>
    </Link>
  )
}
