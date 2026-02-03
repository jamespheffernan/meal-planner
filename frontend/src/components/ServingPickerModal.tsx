'use client'

import { X, Plus, Minus, Users } from 'lucide-react'
import type { Recipe } from '@/lib/api'
import { useState } from 'react'
import RecipePhoto from './RecipePhoto'

interface ServingPickerModalProps {
  recipe: Recipe
  onConfirm: (servings: number) => void
  onClose: () => void
}

export function ServingPickerModal({ recipe, onConfirm, onClose }: ServingPickerModalProps) {
  const [servings, setServings] = useState(recipe.servings)
  
  const PEOPLE_COUNT = 2 // Number of people eating
  const mealSlotsFilled = Math.floor(servings / PEOPLE_COUNT) // Each meal slot needs 2 servings
  const scaleFactor = servings / recipe.servings
  
  const handleIncrement = () => {
    setServings(prev => prev + 1)
  }
  
  const handleDecrement = () => {
    setServings(prev => Math.max(1, prev - 1))
  }
  
  const handleConfirm = () => {
    onConfirm(servings)
    onClose()
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">How many servings?</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        {/* Recipe Info */}
        <div className="p-6 space-y-4">
          <div className="flex gap-4">
            <RecipePhoto
              recipeId={recipe.id}
              photoUrl={recipe.photoUrl}
              recipeName={recipe.name}
              size="sm"
              editable={false}
            />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">{recipe.name}</h3>
              <p className="text-sm text-gray-500">
                {recipe.cookTimeMinutes} min · {recipe.mealType}
              </p>
            </div>
          </div>
          
          {/* Serving Stepper */}
          <div className="bg-gray-50 rounded-lg p-6">
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handleDecrement}
                disabled={servings <= 1}
                className="p-3 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Minus className="w-5 h-5 text-gray-700" />
              </button>
              
              <div className="text-center min-w-[120px]">
                <div className="text-4xl font-bold text-gray-900">{servings}</div>
                <div className="text-sm text-gray-500 mt-1">servings</div>
              </div>
              
              <button
                onClick={handleIncrement}
                className="p-3 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Plus className="w-5 h-5 text-gray-700" />
              </button>
            </div>
            
            <div className="mt-4 text-center">
              <div className="text-sm text-gray-600">
                Recipe originally makes {recipe.servings} servings
              </div>
              {scaleFactor !== 1 && (
                <div className="text-xs text-gray-500 mt-1">
                  {scaleFactor > 1 
                    ? `Scale up by ${scaleFactor.toFixed(1)}× (multiply ingredients by ${scaleFactor.toFixed(1)})`
                    : `Scale down by ${scaleFactor.toFixed(1)}× (multiply ingredients by ${scaleFactor.toFixed(1)})`
                  }
                </div>
              )}
            </div>
          </div>
          
          {/* Meal Slots Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-blue-900">
              <Users className="w-5 h-5" />
              <div>
                <div className="font-medium">
                  This fills <span className="text-xl font-bold">{mealSlotsFilled}</span> meal slots
                </div>
                <div className="text-sm text-blue-700 mt-1">
                  {mealSlotsFilled === 0 
                    ? 'Less than 1 meal (need 2 servings per meal for 2 people)'
                    : mealSlotsFilled === 1 
                      ? '1 meal for 2 people'
                      : `${mealSlotsFilled} meals for 2 people`
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="p-4 border-t border-gray-200 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Add to Week
          </button>
        </div>
      </div>
    </div>
  )
}
