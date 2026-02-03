'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { recipes, ingredients } from '@/lib/api'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Plus, X, Trash2, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
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

export default function EditRecipePage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const queryClient = useQueryClient()

  const { data: recipe, isLoading, error } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipes.get(id),
    enabled: !!id,
  })

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

  useEffect(() => {
    if (!recipe) return
    setName(recipe.name)
    setDescription(recipe.description || '')
    setSource(recipe.source || '')
    setServings(recipe.servings.toString())
    setCookTimeMinutes(recipe.cookTimeMinutes?.toString() || '')
    setPrepTimeMinutes(recipe.prepTimeMinutes?.toString() || '')
    setMealType(recipe.mealType as typeof MEAL_TYPES[number])
    setCookingStyle(recipe.cookingStyle as typeof COOKING_STYLES[number])
    setRecipeIngredients(
      (recipe.recipeIngredients || []).map((ri) => ({
        ingredient: ri.ingredient,
        quantity: ri.quantity?.toString() || '',
        unit: ri.unit || ri.ingredient.typicalUnit,
        notes: ri.notes || '',
        optional: ri.optional,
      }))
    )
    setInstructions(
      (recipe.recipeInstructions || []).map((inst) => ({
        stepNumber: inst.stepNumber,
        instructionText: inst.instructionText,
      }))
    )
  }, [recipe])

  const { data: ingredientList } = useQuery({
    queryKey: ['ingredients', ingredientSearch],
    queryFn: () => ingredients.list({ search: ingredientSearch }),
    enabled: ingredientSearch.length > 0,
  })

  const updateMutation = useMutation({
    mutationFn: (payload: Parameters<typeof recipes.update>[1]) => recipes.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['recipe', id] })
      router.push(`/recipes/${id}`)
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

    updateMutation.mutate({
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
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link
          href={`/recipes/${id}`}
          className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to recipe
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Edit Recipe</h1>
      </div>

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
              <label className="block text-sm font-medium text-gray-700 mb-1">Meal Type</label>
              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value as typeof MEAL_TYPES[number])}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              >
                {MEAL_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cooking Style</label>
              <select
                value={cookingStyle}
                onChange={(e) => setCookingStyle(e.target.value as typeof COOKING_STYLES[number])}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              >
                {COOKING_STYLES.map(style => (
                  <option key={style} value={style}>{style.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Ingredients */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Ingredients</h2>
            <button
              type="button"
              onClick={() => setShowIngredientSearch(true)}
              className="flex items-center gap-1 px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
            >
              <Plus className="w-4 h-4" />
              Add Ingredient
            </button>
          </div>

          {showIngredientSearch && (
            <div className="relative">
              <input
                type="text"
                value={ingredientSearch}
                onChange={(e) => setIngredientSearch(e.target.value)}
                placeholder="Search ingredients..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              {ingredientList && ingredientList.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {ingredientList.map((ingredient) => (
                    <button
                      key={ingredient.id}
                      type="button"
                      onClick={() => addIngredient(ingredient)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50"
                    >
                      {ingredient.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowIngredientSearch(false)}
                className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="space-y-3">
            {recipeIngredients.map((ingredient, index) => (
              <div key={`${ingredient.ingredient.id}-${index}`} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <p className="text-sm font-medium text-gray-900">{ingredient.ingredient.name}</p>
                </div>
                <input
                  type="number"
                  placeholder="Qty"
                  value={ingredient.quantity}
                  onChange={(e) => updateIngredient(index, { quantity: e.target.value })}
                  className="col-span-2 px-2 py-1 border border-gray-300 rounded"
                />
                <input
                  type="text"
                  placeholder="Unit"
                  value={ingredient.unit}
                  onChange={(e) => updateIngredient(index, { unit: e.target.value })}
                  className="col-span-2 px-2 py-1 border border-gray-300 rounded"
                />
                <input
                  type="text"
                  placeholder="Notes"
                  value={ingredient.notes}
                  onChange={(e) => updateIngredient(index, { notes: e.target.value })}
                  className="col-span-3 px-2 py-1 border border-gray-300 rounded"
                />
                <button
                  type="button"
                  onClick={() => removeIngredient(index)}
                  className="col-span-1 text-red-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {recipeIngredients.length === 0 && (
              <p className="text-sm text-gray-500">No ingredients added yet.</p>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Instructions</h2>
            <button
              type="button"
              onClick={addInstruction}
              className="flex items-center gap-1 px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
            >
              <Plus className="w-4 h-4" />
              Add Step
            </button>
          </div>

          <div className="space-y-3">
            {instructions.map((instruction, index) => (
              <div key={instruction.stepNumber} className="flex items-start gap-2">
                <span className="text-sm font-medium text-gray-700 mt-2">{index + 1}.</span>
                <textarea
                  rows={2}
                  value={instruction.instructionText}
                  onChange={(e) => updateInstruction(index, e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => removeInstruction(index)}
                  className="text-red-500 hover:text-red-600 mt-2"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {instructions.length === 0 && (
              <p className="text-sm text-gray-500">No instructions added yet.</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="w-full py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}
