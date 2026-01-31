'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { recipes, ingredients } from '@/lib/api'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Trash2 } from 'lucide-react'
import type { Ingredient } from '@/lib/api'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
const COOKING_STYLES = ['quick_weeknight', 'batch_cook', 'special_occasion'] as const

interface RecipeIngredientInput {
  ingredient: Ingredient
  quantity: string
  unit: string
  notes: string
  optional: boolean
}

interface InstructionInput {
  stepNumber: number
  instructionText: string
}

export default function NewRecipePage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState('')
  const [servings, setServings] = useState('4')
  const [cookTimeMinutes, setCookTimeMinutes] = useState('')
  const [prepTimeMinutes, setPrepTimeMinutes] = useState('')
  const [mealType, setMealType] = useState<typeof MEAL_TYPES[number]>('dinner')
  const [cookingStyle, setCookingStyle] = useState<typeof COOKING_STYLES[number]>('quick_weeknight')

  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredientInput[]>([])
  const [instructions, setInstructions] = useState<InstructionInput[]>([])

  const [ingredientSearch, setIngredientSearch] = useState('')
  const [showIngredientSearch, setShowIngredientSearch] = useState(false)

  const { data: ingredientList } = useQuery({
    queryKey: ['ingredients', ingredientSearch],
    queryFn: () => ingredients.list({ search: ingredientSearch }),
    enabled: ingredientSearch.length > 0,
  })

  const createMutation = useMutation({
    mutationFn: recipes.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      router.push('/discover')
    },
  })

  const addIngredient = (ingredient: Ingredient) => {
    setRecipeIngredients(prev => [
      ...prev,
      {
        ingredient,
        quantity: '',
        unit: ingredient.typicalUnit,
        notes: '',
        optional: false,
      },
    ])
    setIngredientSearch('')
    setShowIngredientSearch(false)
  }

  const updateIngredient = (index: number, updates: Partial<RecipeIngredientInput>) => {
    setRecipeIngredients(prev => prev.map((ing, i) =>
      i === index ? { ...ing, ...updates } : ing
    ))
  }

  const removeIngredient = (index: number) => {
    setRecipeIngredients(prev => prev.filter((_, i) => i !== index))
  }

  const addInstruction = () => {
    setInstructions(prev => [
      ...prev,
      { stepNumber: prev.length + 1, instructionText: '' },
    ])
  }

  const updateInstruction = (index: number, text: string) => {
    setInstructions(prev => prev.map((inst, i) =>
      i === index ? { ...inst, instructionText: text } : inst
    ))
  }

  const removeInstruction = (index: number) => {
    setInstructions(prev =>
      prev.filter((_, i) => i !== index)
        .map((inst, i) => ({ ...inst, stepNumber: i + 1 }))
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    createMutation.mutate({
      name,
      description: description || undefined,
      source: source || undefined,
      servings: parseInt(servings),
      cookTimeMinutes: parseInt(cookTimeMinutes),
      prepTimeMinutes: prepTimeMinutes ? parseInt(prepTimeMinutes) : undefined,
      mealType,
      cookingStyle,
      ingredients: recipeIngredients.map(ri => ({
        ingredientId: ri.ingredient.id,
        quantity: parseFloat(ri.quantity),
        unit: ri.unit,
        notes: ri.notes || undefined,
        optional: ri.optional,
      })),
      instructions: instructions.length > 0 ? instructions : undefined,
    })
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add New Recipe</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Basic Information</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recipe Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Source (cookbook, URL, etc.)
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Servings *
              </label>
              <input
                type="number"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                required
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cook Time (min) *
              </label>
              <input
                type="number"
                value={cookTimeMinutes}
                onChange={(e) => setCookTimeMinutes(e.target.value)}
                required
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Prep Time (min)
              </label>
              <input
                type="number"
                value={prepTimeMinutes}
                onChange={(e) => setPrepTimeMinutes(e.target.value)}
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Meal Type *
              </label>
              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value as typeof MEAL_TYPES[number])}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              >
                {MEAL_TYPES.map(type => (
                  <option key={type} value={type} className="capitalize">
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cooking Style *
              </label>
              <select
                value={cookingStyle}
                onChange={(e) => setCookingStyle(e.target.value as typeof COOKING_STYLES[number])}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              >
                {COOKING_STYLES.map(style => (
                  <option key={style} value={style}>
                    {style.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Ingredients */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">Ingredients</h2>
            <button
              type="button"
              onClick={() => setShowIngredientSearch(true)}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <Plus className="w-4 h-4" /> Add Ingredient
            </button>
          </div>

          {showIngredientSearch && (
            <div className="border border-gray-200 rounded-lg p-3">
              <input
                type="text"
                value={ingredientSearch}
                onChange={(e) => setIngredientSearch(e.target.value)}
                placeholder="Search ingredients..."
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              {ingredientList && ingredientList.length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto">
                  {ingredientList.map(ing => (
                    <button
                      key={ing.id}
                      type="button"
                      onClick={() => addIngredient(ing)}
                      className="w-full p-2 text-left hover:bg-gray-50 rounded"
                    >
                      <span className="font-medium">{ing.name}</span>
                      <span className="text-gray-500 text-sm ml-2">({ing.category})</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowIngredientSearch(false)}
                className="mt-2 text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}

          {recipeIngredients.length > 0 ? (
            <div className="space-y-3">
              {recipeIngredients.map((ri, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 grid grid-cols-4 gap-2">
                    <span className="font-medium text-gray-900 col-span-2">{ri.ingredient.name}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={ri.quantity}
                      onChange={(e) => updateIngredient(index, { quantity: e.target.value })}
                      placeholder="Qty"
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <input
                      type="text"
                      value={ri.unit}
                      onChange={(e) => updateIngredient(index, { unit: e.target.value })}
                      placeholder="Unit"
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-1 text-sm text-gray-500">
                    <input
                      type="checkbox"
                      checked={ri.optional}
                      onChange={(e) => updateIngredient(index, { optional: e.target.checked })}
                      className="rounded"
                    />
                    Optional
                  </label>
                  <button
                    type="button"
                    onClick={() => removeIngredient(index)}
                    className="p-1 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No ingredients added yet.</p>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">Instructions (optional)</h2>
            <button
              type="button"
              onClick={addInstruction}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <Plus className="w-4 h-4" /> Add Step
            </button>
          </div>

          {instructions.length > 0 ? (
            <div className="space-y-3">
              {instructions.map((inst, index) => (
                <div key={index} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium">
                    {inst.stepNumber}
                  </span>
                  <textarea
                    value={inst.instructionText}
                    onChange={(e) => updateInstruction(index, e.target.value)}
                    rows={2}
                    placeholder={`Step ${inst.stepNumber}...`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => removeInstruction(index)}
                    className="p-1 text-red-500 hover:text-red-700 self-start"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No instructions added. You can add them later.</p>
          )}
        </div>

        {/* Submit */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending || !name || !cookTimeMinutes}
            className="flex-1 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Recipe'}
          </button>
        </div>
      </form>
    </div>
  )
}
