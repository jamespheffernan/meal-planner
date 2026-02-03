'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ingredients } from '@/lib/api'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useState } from 'react'

export default function IngredientDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const ingredientId = params.id
  const [offData, setOffData] = useState<{
    productName?: string
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    imageUrl?: string
  } | null>(null)

  const { data: ingredient, isLoading } = useQuery({
    queryKey: ['ingredient', ingredientId],
    queryFn: () => ingredients.get(ingredientId),
  })

  const refreshMutation = useMutation({
    mutationFn: () => ingredients.refreshOff(ingredientId),
    onSuccess: (data) => {
      setOffData(data.offData)
      queryClient.invalidateQueries({ queryKey: ['ingredient', ingredientId] })
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
    },
  })

  if (isLoading) {
    return <p className="text-gray-500">Loading ingredient...</p>
  }

  if (!ingredient) {
    return <p className="text-gray-500">Ingredient not found.</p>
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/ingredients')}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to ingredients
      </button>

      <div className="bg-white rounded-lg shadow p-6 flex gap-6">
        {ingredient.imageUrl ? (
          <img
            src={ingredient.imageUrl}
            alt={ingredient.name}
            className="w-32 h-32 object-cover rounded-lg border"
          />
        ) : (
          <div className="w-32 h-32 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
            No image
          </div>
        )}
        <div className="flex-1 space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">{ingredient.name}</h1>
          <p className="text-sm text-gray-500">
            Category: {ingredient.category} · Typical unit: {ingredient.typicalUnit}
          </p>
          <div className="text-sm text-gray-600">
            <p>Calories / unit: {ingredient.estimatedCaloriesPerUnit ?? '—'}</p>
            <p>Cost / unit: {ingredient.estimatedCostPerUnit ?? '—'}</p>
          </div>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Open Food Facts'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Brand Priorities</h2>
        {ingredient.brands && ingredient.brands.length > 0 ? (
          <div className="space-y-2">
            {ingredient.brands.map(brand => (
              <div key={brand.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded">
                <div>
                  <p className="text-sm font-medium text-gray-900">{brand.brandName}</p>
                  <p className="text-xs text-gray-500">{brand.preferenceLevel}{brand.notes ? ` · ${brand.notes}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No brand preferences yet.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Open Food Facts</h2>
        {offData ? (
          <div className="text-sm text-gray-600 space-y-1">
            {offData.productName && <p>Matched product: {offData.productName}</p>}
            <p>Calories (per 100g): {offData.calories ?? '—'}</p>
            <p>Protein (per 100g): {offData.protein ?? '—'}</p>
            <p>Carbs (per 100g): {offData.carbs ?? '—'}</p>
            <p>Fat (per 100g): {offData.fat ?? '—'}</p>
            {offData.imageUrl && (
              <a href={offData.imageUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                View product image
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Click “Refresh Open Food Facts” to pull the latest data.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Used In Recipes</h2>
        {ingredient.recipeIngredients && ingredient.recipeIngredients.length > 0 ? (
          <div className="space-y-2">
            {ingredient.recipeIngredients.map((ri: any) => (
              <div key={ri.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded">
                <div>
                  <p className="text-sm font-medium text-gray-900">{ri.recipe?.name}</p>
                  <p className="text-xs text-gray-500">{ri.quantity} {ri.unit}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Not linked to any recipes yet.</p>
        )}
      </div>
    </div>
  )
}
