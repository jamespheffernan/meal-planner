'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mealPlans, recipes, shoppingLists } from '@/lib/api'
import { format, addDays, startOfWeek, isSameDay } from 'date-fns'
import { useState } from 'react'
import { Check, X, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import type { Recipe, MealPlan } from '@/lib/api'
import { MealProgressTracker } from '@/components/MealProgressTracker'
import { RecipePoolSidebar } from '@/components/RecipePoolSidebar'
import { ServingPickerModal } from '@/components/ServingPickerModal'
import { StagedMealsList, type StagedMeal } from '@/components/StagedMealsList'
import { CompletionCelebration } from '@/components/CompletionCelebration'
import { RecipePreviewModal } from '@/components/RecipePreviewModal'
import { useRouter } from 'next/navigation'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const

export default function MealPlanPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [stagedMeals, setStagedMeals] = useState<StagedMeal[]>([])
  const [sidebarTab, setSidebarTab] = useState<'pool' | 'staged'>('pool')
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [previewRecipe, setPreviewRecipe] = useState<Recipe | null>(null)
  const [draggedStagedMeal, setDraggedStagedMeal] = useState<StagedMeal | null>(null)
  const [draggedMealPlan, setDraggedMealPlan] = useState<MealPlan | null>(null)
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null)

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd = addDays(weekStart, 6)

  const { data: weekMealPlans, isLoading } = useQuery({
    queryKey: ['mealPlans', format(weekStart, 'yyyy-MM-dd')],
    queryFn: () => mealPlans.list({
      fromDate: format(weekStart, 'yyyy-MM-dd'),
      toDate: format(weekEnd, 'yyyy-MM-dd'),
    }),
  })

  const generateShoppingListMutation = useMutation({
    mutationFn: async () => {
      const ids = (weekMealPlans || []).filter(mp => mp.status === 'planned').map(mp => mp.id)
      return shoppingLists.generate(ids)
    },
    onSuccess: (newList) => {
      queryClient.invalidateQueries({ queryKey: ['shoppingLists'] })
      router.push(`/shopping?listId=${encodeURIComponent(newList.id)}`)
    },
  })

  const { data: approvedRecipes } = useQuery({
    queryKey: ['recipes', 'approved'],
    queryFn: () => recipes.list({ approvalStatus: 'approved' }),
  })

  const bulkAssignMutation = useMutation({
    mutationFn: mealPlans.bulkAssign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealPlans'] })
      setStagedMeals([])
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

  const handleDeleteMeal = (meal: MealPlan) => {
    // Check if this recipe already exists in staged meals
    setStagedMeals(prev => {
      const existingMealIndex = prev.findIndex(m => m.recipe.id === meal.recipeId)
      
      if (existingMealIndex !== -1) {
        // Recipe already exists - add servings to existing entry
        const updated = [...prev]
        updated[existingMealIndex] = {
          ...updated[existingMealIndex],
          servings: updated[existingMealIndex].servings + meal.servingsPlanned,
        }
        return updated
      } else {
        // Recipe doesn't exist - create new staged meal
        const newStagedMeal: StagedMeal = {
          id: `${meal.recipeId}-${Date.now()}`,
          recipe: meal.recipe!,
          servings: meal.servingsPlanned,
        }
        return [...prev, newStagedMeal]
      }
    })
    
    // Delete from calendar
    deleteMutation.mutate(meal.id)
  }

  const createMealPlanMutation = useMutation({
    mutationFn: mealPlans.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealPlans'] })
    },
  })

  const updateMealPlanMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ recipeId: string; plannedDate: string; mealType: string; servingsPlanned: number }> }) => 
      mealPlans.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealPlans'] })
    },
  })

  // Calculate progress
  const progress = {
    breakfast: { filled: 0, needed: 14 },
    lunch: { filled: 0, needed: 14 },
    dinner: { filled: 0, needed: 14 },
  }

  weekMealPlans?.forEach(mp => {
    if (mp.mealType in progress) {
      progress[mp.mealType as keyof typeof progress].filled += mp.servingsPlanned
    }
  })

  const getMealForSlot = (date: Date, mealType: string): MealPlan | undefined => {
    return weekMealPlans?.find(
      mp => isSameDay(new Date(mp.plannedDate), date) && mp.mealType === mealType
    )
  }

  const handleAddRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe)
  }

  const handlePreviewRecipe = (recipe: Recipe) => {
    setPreviewRecipe(recipe)
  }

  const handleConfirmServings = (servings: number) => {
    if (!selectedRecipe) return
    
    const newMeal: StagedMeal = {
      id: `${selectedRecipe.id}-${Date.now()}`,
      recipe: selectedRecipe,
      servings,
    }
    
    setStagedMeals(prev => [...prev, newMeal])
    setSelectedRecipe(null)
  }

  const handleUpdateServings = (id: string, delta: number) => {
    setStagedMeals(prev =>
      prev.map(meal =>
        meal.id === id
          ? { ...meal, servings: Math.max(1, meal.servings + delta) }
          : meal
      )
    )
  }

  const handleRemoveStagedMeal = (id: string) => {
    setStagedMeals(prev => prev.filter(meal => meal.id !== id))
  }

  // Drag and drop handlers
  const handleDragStartStagedMeal = (meal: StagedMeal) => {
    setDraggedStagedMeal(meal)
  }

  const handleDragStartMealPlan = (mealPlan: MealPlan) => {
    setDraggedMealPlan(mealPlan)
  }

  const handleDragEnd = () => {
    setDraggedStagedMeal(null)
    setDraggedMealPlan(null)
    setDragOverSlot(null)
  }

  const handleDropOnSlot = (date: Date, mealType: string) => {
    const existingMeal = getMealForSlot(date, mealType)
    const PEOPLE_COUNT = 2

    if (draggedStagedMeal) {
      // Dropping from staged meals
      if (existingMeal) {
        // Slot is occupied - swap by moving existing meal back to staged
        // Check if this recipe already exists in staged meals
        setStagedMeals(prev => {
          const existingIndex = prev.findIndex(m => m.recipe.id === existingMeal.recipeId)
          
          if (existingIndex !== -1) {
            // Recipe already exists - add servings to existing entry
            const updated = [...prev]
            updated[existingIndex] = {
              ...updated[existingIndex],
              servings: updated[existingIndex].servings + existingMeal.servingsPlanned,
            }
            return updated
          } else {
            // Recipe doesn't exist - create new staged meal
            const newStagedMeal: StagedMeal = {
              id: `${existingMeal.recipeId}-${Date.now()}`,
              recipe: existingMeal.recipe!,
              servings: existingMeal.servingsPlanned,
            }
            return [...prev, newStagedMeal]
          }
        })
        
        // Delete existing meal
        deleteMutation.mutate(existingMeal.id)
      }
      
      // Create new meal plan
      createMealPlanMutation.mutate({
        recipeId: draggedStagedMeal.recipe.id,
        plannedDate: format(date, 'yyyy-MM-dd'),
        mealType,
        servingsPlanned: PEOPLE_COUNT,
      })
      
      // Reduce servings in staged meal
      const remainingServings = draggedStagedMeal.servings - PEOPLE_COUNT
      if (remainingServings > 0) {
        handleUpdateServings(draggedStagedMeal.id, -PEOPLE_COUNT)
      } else {
        handleRemoveStagedMeal(draggedStagedMeal.id)
      }
    } else if (draggedMealPlan) {
      // Moving existing meal plan to new slot
      if (existingMeal && existingMeal.id === draggedMealPlan.id) {
        // Dropping on same slot - do nothing
        return
      }
      
      if (existingMeal) {
        // Slot is occupied - swap the two meals
        const draggedDate = new Date(draggedMealPlan.plannedDate)
        const draggedMealType = draggedMealPlan.mealType
        
        // Delete both meals
        deleteMutation.mutate(draggedMealPlan.id)
        deleteMutation.mutate(existingMeal.id)
        
        // Create them in swapped positions
        createMealPlanMutation.mutate({
          recipeId: draggedMealPlan.recipeId,
          plannedDate: format(date, 'yyyy-MM-dd'),
          mealType,
          servingsPlanned: draggedMealPlan.servingsPlanned,
        })
        
        createMealPlanMutation.mutate({
          recipeId: existingMeal.recipeId,
          plannedDate: format(draggedDate, 'yyyy-MM-dd'),
          mealType: draggedMealType,
          servingsPlanned: existingMeal.servingsPlanned,
        })
      } else {
        // Slot is empty - just update the existing meal plan
        updateMealPlanMutation.mutate({
          id: draggedMealPlan.id,
          data: {
            plannedDate: format(date, 'yyyy-MM-dd'),
            mealType,
          }
        })
      }
    }
  }

  const handleAutoAssign = () => {
    // Build assignments by distributing servings across available slots
    const assignments: Array<{
      recipeId: string
      mealType: string
      servings: number
      dates: string[]
    }> = []

    // Track slots that have been claimed in this batch to avoid double-booking
    const claimedSlots = new Set<string>()

    stagedMeals.forEach(meal => {
      const mealType = meal.recipe.mealType
      const PEOPLE_COUNT = 2 // Number of people eating
      const servingsPerMeal = PEOPLE_COUNT // 2 people = 2 servings per meal
      const totalMeals = meal.servings / servingsPerMeal
      
      // Determine which meal types this recipe can fill
      // Lunch and dinner are interchangeable, breakfast is separate
      const compatibleMealTypes = mealType === 'breakfast' 
        ? ['breakfast'] 
        : ['lunch', 'dinner']
      
      // Find empty slots for compatible meal types
      const emptySlots: Array<{ date: string; mealType: string }> = []
      weekDays.forEach(day => {
        compatibleMealTypes.forEach(compatibleType => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const slotKey = `${dateStr}-${compatibleType}`
          
          // Check if slot is already filled in DB or claimed in this batch
          const existingMeal = getMealForSlot(day, compatibleType)
          if (!existingMeal && !claimedSlots.has(slotKey)) {
            emptySlots.push({ 
              date: dateStr, 
              mealType: compatibleType 
            })
          }
        })
      })

      // Assign to available slots (each slot needs servings for 2 people)
      const slotsToAssign = emptySlots.slice(0, Math.ceil(totalMeals))
      
      if (slotsToAssign.length === 0) return
      
      // Mark these slots as claimed
      slotsToAssign.forEach(slot => {
        claimedSlots.add(`${slot.date}-${slot.mealType}`)
      })
      
      // Each slot gets servings for 2 people
      const servingsPerSlot = servingsPerMeal
      
      // Group by meal type for the API
      const slotsByMealType: Record<string, string[]> = {}
      slotsToAssign.forEach(slot => {
        if (!slotsByMealType[slot.mealType]) {
          slotsByMealType[slot.mealType] = []
        }
        slotsByMealType[slot.mealType].push(slot.date)
      })
      
      // Create assignments for each meal type
      Object.entries(slotsByMealType).forEach(([assignedMealType, dates]) => {
        if (dates.length > 0) {
          assignments.push({
            recipeId: meal.recipe.id,
            mealType: assignedMealType,
            servings: servingsPerSlot,
            dates,
          })
        }
      })
    })

    if (assignments.length > 0) {
      bulkAssignMutation.mutate({ assignments })
    }
  }

  return (
    <div className="h-[calc(100vh-5rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Meal Plan</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => generateShoppingListMutation.mutate()}
            disabled={generateShoppingListMutation.isPending || !(weekMealPlans || []).some(mp => mp.status === 'planned')}
            className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Create a grocery list from planned meals this week"
          >
            <RefreshCw className={`w-4 h-4 ${generateShoppingListMutation.isPending ? 'animate-spin' : ''}`} />
            Grocery list
          </button>
          <button
            onClick={() => setWeekStart(d => addDays(d, -7))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-gray-600 min-w-[200px] text-center">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </span>
          <button
            onClick={() => setWeekStart(d => addDays(d, 7))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="flex-1 grid grid-cols-12 gap-4 overflow-hidden">
        {/* Left: Sidebar Tabs (Pool / Staged) */}
        <div className="col-span-3 overflow-hidden flex flex-col">
          <div className="bg-white rounded-lg shadow overflow-hidden flex flex-col h-full">
            <div className="p-2 border-b border-gray-200">
              <div className="grid grid-cols-2 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setSidebarTab('pool')}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    sidebarTab === 'pool'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Recipe Pool
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab('staged')}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    sidebarTab === 'staged'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Planned ({stagedMeals.length})
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {sidebarTab === 'pool' ? (
                <div className="h-full">
                  <RecipePoolSidebar
                    recipes={approvedRecipes || []}
                    onAddRecipe={handleAddRecipe}
                    onPreviewRecipe={handlePreviewRecipe}
                  />
                </div>
              ) : (
                <div className="h-full">
                  <StagedMealsList
                    stagedMeals={stagedMeals}
                    onUpdateServings={handleUpdateServings}
                    onRemove={handleRemoveStagedMeal}
                    onAutoAssign={handleAutoAssign}
                    isAssigning={bulkAssignMutation.isPending}
                    onDragStart={handleDragStartStagedMeal}
                    onDragEnd={handleDragEnd}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Main content area */}
        <div className="col-span-9 flex flex-col gap-4 overflow-hidden">
          {/* Progress Tracker */}
          <MealProgressTracker progress={progress} />

          {/* Weekly Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center flex-1">
              <p className="text-gray-500">Loading meal plan...</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-auto flex-1">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[140px_1fr] sticky top-0 bg-white z-10 border-b border-gray-200">
                  <div className="p-3 text-xs font-medium text-gray-500">Day</div>
                  <div className="grid grid-cols-3 gap-3 p-3 text-xs font-medium text-gray-500">
                    <div>Breakfast</div>
                    <div>Lunch</div>
                    <div>Dinner</div>
                  </div>
                </div>

                {weekDays.map((day) => {
                  const dayStr = format(day, 'yyyy-MM-dd')
                  return (
                    <div key={dayStr} className="grid grid-cols-[140px_1fr] border-b border-gray-100">
                      <div className="p-3">
                        <div className="text-sm font-semibold text-gray-900">{format(day, 'EEE')}</div>
                        <div className="text-xs text-gray-500">{format(day, 'MMM d')}</div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 p-3">
                        {MEAL_TYPES.map((mealType) => {
                          const meal = getMealForSlot(day, mealType)
                          const slotKey = `${dayStr}-${mealType}`
                          const isDragOver = dragOverSlot === slotKey

                          return (
                            <div
                              key={slotKey}
                              className="min-w-0"
                              onDragOver={(e) => {
                                e.preventDefault()
                                setDragOverSlot(slotKey)
                              }}
                              onDragLeave={() => setDragOverSlot(null)}
                              onDrop={(e) => {
                                e.preventDefault()
                                handleDropOnSlot(day, mealType)
                                setDragOverSlot(null)
                              }}
                            >
                              {meal ? (
                                <MealCard
                                  meal={meal}
                                  onMarkCooked={() => markCookedMutation.mutate({ id: meal.id })}
                                  onDelete={() => handleDeleteMeal(meal)}
                                  onDragStart={() => handleDragStartMealPlan(meal)}
                                  onDragEnd={handleDragEnd}
                                  isDragOver={isDragOver && (draggedStagedMeal !== null || draggedMealPlan !== null)}
                                />
                              ) : (
                                <div className={`w-full h-16 border-2 border-dashed rounded-lg flex items-center justify-center transition-colors ${
                                  isDragOver && (draggedStagedMeal || draggedMealPlan)
                                    ? 'border-blue-400 bg-blue-50 text-blue-600'
                                    : 'border-gray-200 text-gray-400'
                                }`}>
                                  <Plus className="w-5 h-5" />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Serving Picker Modal */}
      {selectedRecipe && (
        <ServingPickerModal
          recipe={selectedRecipe}
          onConfirm={handleConfirmServings}
          onClose={() => setSelectedRecipe(null)}
        />
      )}

      {/* Recipe Preview Modal */}
      {previewRecipe && (
        <RecipePreviewModal
          recipeId={previewRecipe.id}
          initialRecipe={previewRecipe}
          onClose={() => setPreviewRecipe(null)}
          onAdd={(r) => {
            setPreviewRecipe(null)
            handleAddRecipe(r)
          }}
        />
      )}

      {/* Completion Celebrations */}
      <CompletionCelebration 
        isComplete={progress.breakfast.filled >= progress.breakfast.needed}
        mealType="Breakfast"
      />
      <CompletionCelebration 
        isComplete={progress.lunch.filled >= progress.lunch.needed}
        mealType="Lunch"
      />
      <CompletionCelebration 
        isComplete={progress.dinner.filled >= progress.dinner.needed}
        mealType="Dinner"
      />
    </div>
  )
}

function MealCard({ meal, onMarkCooked, onDelete, onDragStart, onDragEnd, isDragOver }: {
  meal: MealPlan
  onMarkCooked: () => void
  onDelete: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
  isDragOver?: boolean
}) {
  const baseClasses = "p-2 rounded-lg text-sm transition-all cursor-move"
  const statusClasses = meal.status === 'cooked' 
    ? 'bg-green-50 border-2 border-green-200' 
    : meal.isLeftover 
      ? 'bg-amber-50 border-2 border-amber-200' 
      : 'bg-blue-50 border-2 border-blue-200'
  
  const dragOverClasses = isDragOver ? 'ring-2 ring-blue-400 ring-offset-2' : ''

  return (
    <div 
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`${baseClasses} ${statusClasses} ${dragOverClasses} hover:shadow-md active:opacity-50`}
    >
      <p className="font-medium text-gray-900 truncate">{meal.recipe?.name}</p>
      <p className="text-xs text-gray-500">{meal.servingsPlanned} servings</p>
      {meal.isLeftover && (
        <span className="inline-block mt-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
          Leftover
        </span>
      )}
      {meal.status === 'cooked' && (
        <span className="inline-block mt-1 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
          ✓ Cooked
        </span>
      )}
      <div className="flex gap-1 mt-2">
        {meal.status === 'planned' && (
          <button
            onClick={onMarkCooked}
            className="p-1 bg-green-100 hover:bg-green-200 rounded text-green-700 transition-colors"
            title="Mark as cooked"
          >
            <Check className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1 bg-red-100 hover:bg-red-200 rounded text-red-700 transition-colors"
          title="Remove"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
