'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mealPlans, recipes } from '@/lib/api'
import { format, addDays, startOfWeek, isSameDay } from 'date-fns'
import { useState } from 'react'
import { Plus, Check, X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Recipe, MealPlan } from '@/lib/api'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export default function MealPlanPage() {
  const queryClient = useQueryClient()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; mealType: string } | null>(null)

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd = addDays(weekStart, 6)

  const { data: weekMealPlans, isLoading } = useQuery({
    queryKey: ['mealPlans', format(weekStart, 'yyyy-MM-dd')],
    queryFn: () => mealPlans.list({
      fromDate: format(weekStart, 'yyyy-MM-dd'),
      toDate: format(weekEnd, 'yyyy-MM-dd'),
    }),
  })

  const { data: approvedRecipes } = useQuery({
    queryKey: ['recipes', 'approved'],
    queryFn: () => recipes.list({ approvalStatus: 'approved' }),
  })

  const createMutation = useMutation({
    mutationFn: mealPlans.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealPlans'] })
      setShowAddModal(false)
      setSelectedSlot(null)
    },
  })

  const markCookedMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => mealPlans.markCooked(id, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealPlans'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: mealPlans.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealPlans'] })
    },
  })

  const getMealForSlot = (date: Date, mealType: string): MealPlan | undefined => {
    return weekMealPlans?.find(
      mp => isSameDay(new Date(mp.plannedDate), date) && mp.mealType === mealType
    )
  }

  const openAddModal = (date: Date, mealType: string) => {
    setSelectedSlot({ date, mealType })
    setShowAddModal(true)
  }

  const handleAddMeal = (recipe: Recipe) => {
    if (!selectedSlot) return
    createMutation.mutate({
      recipeId: recipe.id,
      plannedDate: format(selectedSlot.date, 'yyyy-MM-dd'),
      mealType: selectedSlot.mealType,
      servingsPlanned: recipe.servings,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Meal Plan</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(d => addDays(d, -7))}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-gray-600">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </span>
          <button
            onClick={() => setWeekStart(d => addDays(d, 7))}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading meal plan...</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="p-3 text-left text-sm font-medium text-gray-500 w-24"></th>
                {weekDays.map(day => (
                  <th key={day.toISOString()} className="p-3 text-center text-sm font-medium text-gray-900">
                    <div>{format(day, 'EEE')}</div>
                    <div className="text-gray-500">{format(day, 'MMM d')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEAL_TYPES.map(mealType => (
                <tr key={mealType} className="border-b border-gray-100">
                  <td className="p-3 text-sm font-medium text-gray-500 capitalize">{mealType}</td>
                  {weekDays.map(day => {
                    const meal = getMealForSlot(day, mealType)
                    return (
                      <td key={day.toISOString()} className="p-2">
                        {meal ? (
                          <MealCard
                            meal={meal}
                            onMarkCooked={() => markCookedMutation.mutate({ id: meal.id })}
                            onDelete={() => deleteMutation.mutate(meal.id)}
                          />
                        ) : (
                          <button
                            onClick={() => openAddModal(day, mealType)}
                            className="w-full h-20 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <Plus className="w-5 h-5" />
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Meal Modal */}
      {showAddModal && selectedSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                Add {selectedSlot.mealType} for {format(selectedSlot.date, 'MMM d')}
              </h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {approvedRecipes && approvedRecipes.length > 0 ? (
                <div className="space-y-2">
                  {approvedRecipes
                    .filter(r => r.mealType === selectedSlot.mealType || selectedSlot.mealType === 'snack')
                    .map(recipe => (
                      <button
                        key={recipe.id}
                        onClick={() => handleAddMeal(recipe)}
                        disabled={createMutation.isPending}
                        className="w-full p-3 text-left bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <p className="font-medium text-gray-900">{recipe.name}</p>
                        <p className="text-sm text-gray-500">
                          {recipe.cookTimeMinutes} min · {recipe.servings} servings
                        </p>
                      </button>
                    ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  No approved recipes. Go to Discover to approve some recipes first.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MealCard({ meal, onMarkCooked, onDelete }: {
  meal: MealPlan
  onMarkCooked: () => void
  onDelete: () => void
}) {
  return (
    <div className={`p-2 rounded-lg text-sm ${
      meal.status === 'cooked' ? 'bg-green-50' :
      meal.isLeftover ? 'bg-amber-50' : 'bg-blue-50'
    }`}>
      <p className="font-medium text-gray-900 truncate">{meal.recipe?.name}</p>
      <p className="text-xs text-gray-500">{meal.servingsPlanned} servings</p>
      {meal.isLeftover && <p className="text-xs text-amber-600">Leftover</p>}
      <div className="flex gap-1 mt-1">
        {meal.status === 'planned' && (
          <button
            onClick={onMarkCooked}
            className="p-1 bg-green-100 hover:bg-green-200 rounded text-green-700"
            title="Mark as cooked"
          >
            <Check className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1 bg-red-100 hover:bg-red-200 rounded text-red-700"
          title="Remove"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
