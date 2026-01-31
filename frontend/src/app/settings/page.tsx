'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { preferences, ingredients } from '@/lib/api'
import { useState } from 'react'
import { Save, X, Plus, Trash2 } from 'lucide-react'
import type { UserPreferences, Ingredient } from '@/lib/api'

const DAYS_OF_WEEK = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
]

export default function SettingsPage() {
  const queryClient = useQueryClient()

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['preferences'],
    queryFn: preferences.get,
  })

  const { data: dislikedIngredients } = useQuery({
    queryKey: ['preferences', 'disliked'],
    queryFn: preferences.getDislikedIngredients,
  })

  const [formData, setFormData] = useState<Partial<UserPreferences>>({})
  const [showDislikeModal, setShowDislikeModal] = useState(false)

  const updateMutation = useMutation({
    mutationFn: preferences.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const removeDislikeMutation = useMutation({
    mutationFn: preferences.removeDislike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const handleSave = () => {
    updateMutation.mutate(formData)
  }

  const handleChange = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  if (isLoading) {
    return <p className="text-gray-500">Loading settings...</p>
  }

  const currentPrefs = { ...prefs, ...formData }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending || Object.keys(formData).length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>

      {/* Budget & Nutrition */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Budget & Nutrition</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Weekly Budget (£)
            </label>
            <input
              type="number"
              value={currentPrefs.budgetTargetWeekly || ''}
              onChange={(e) => handleChange('budgetTargetWeekly', e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="e.g., 100"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Daily Calories
            </label>
            <input
              type="number"
              value={currentPrefs.calorieTargetDaily || ''}
              onChange={(e) => handleChange('calorieTargetDaily', e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="e.g., 2000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>
      </section>

      {/* Shopping */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Shopping</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Default Shopping Day
          </label>
          <select
            value={currentPrefs.defaultShoppingDay || ''}
            onChange={(e) => handleChange('defaultShoppingDay', e.target.value || undefined)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          >
            <option value="">No preference</option>
            {DAYS_OF_WEEK.map(day => (
              <option key={day.value} value={day.value}>{day.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Dietary Restrictions */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Dietary Restrictions</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Restrictions (comma-separated)
          </label>
          <input
            type="text"
            value={(currentPrefs.dietaryRestrictions || []).join(', ')}
            onChange={(e) => handleChange('dietaryRestrictions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="e.g., vegetarian, gluten-free, nut allergy"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Preferred Cuisines (comma-separated)
          </label>
          <input
            type="text"
            value={(currentPrefs.preferredCuisines || []).join(', ')}
            onChange={(e) => handleChange('preferredCuisines', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="e.g., Italian, Mexican, Japanese"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>
      </section>

      {/* Disliked Ingredients */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Disliked Ingredients</h2>
          <button
            onClick={() => setShowDislikeModal(true)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {dislikedIngredients && dislikedIngredients.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {dislikedIngredients.map(ing => (
              <span
                key={ing.id}
                className="flex items-center gap-1 px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm"
              >
                {ing.name}
                <button
                  onClick={() => removeDislikeMutation.mutate(ing.id)}
                  className="p-0.5 hover:bg-red-100 rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No disliked ingredients. Recipes containing these will be ranked lower.</p>
        )}
      </section>

      {/* Recommendation Weights */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Recommendation Priorities</h2>
        <p className="text-sm text-gray-500">
          Adjust how much each factor matters when suggesting recipes. Higher = more important.
        </p>

        <div className="space-y-3">
          {[
            { key: 'variety', label: 'Variety', desc: 'Prefer recipes you haven\'t made recently' },
            { key: 'expiration', label: 'Use Expiring', desc: 'Prioritize ingredients expiring soon' },
            { key: 'pantry', label: 'Pantry Match', desc: 'Prefer recipes using ingredients you have' },
            { key: 'budget', label: 'Budget', desc: 'Stay within your weekly budget' },
            { key: 'calorie', label: 'Calories', desc: 'Match your daily calorie target' },
            { key: 'time', label: 'Cooking Time', desc: 'Quick meals on weekdays, longer on weekends' },
            { key: 'rating', label: 'Past Ratings', desc: 'Prefer recipes you\'ve liked before' },
          ].map(({ key, label, desc }) => (
            <WeightSlider
              key={key}
              label={label}
              description={desc}
              value={(currentPrefs.priorityWeights as Record<string, number>)?.[key] ?? 0.15}
              onChange={(value) => {
                const weights = { ...(currentPrefs.priorityWeights || {}), [key]: value }
                handleChange('priorityWeights', weights as UserPreferences['priorityWeights'])
              }}
            />
          ))}
        </div>
      </section>

      {/* Add Dislike Modal */}
      {showDislikeModal && (
        <AddDislikeModal onClose={() => setShowDislikeModal(false)} />
      )}
    </div>
  )
}

function WeightSlider({ label, description, value, onChange }: {
  label: string
  description: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <input
        type="range"
        min="0"
        max="0.5"
        step="0.05"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-32"
      />
      <span className="text-sm text-gray-600 w-8">{Math.round(value * 100)}%</span>
    </div>
  )
}

function AddDislikeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: ingredientList } = useQuery({
    queryKey: ['ingredients', search],
    queryFn: () => ingredients.list({ search }),
    enabled: search.length > 0,
  })

  const addMutation = useMutation({
    mutationFn: preferences.addDislike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Add Disliked Ingredient</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients..."
            autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />

          {ingredientList && ingredientList.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
              {ingredientList.map(ing => (
                <button
                  key={ing.id}
                  onClick={() => addMutation.mutate(ing.id)}
                  disabled={addMutation.isPending}
                  className="w-full p-2 text-left hover:bg-gray-50 disabled:opacity-50"
                >
                  <p className="font-medium">{ing.name}</p>
                  <p className="text-xs text-gray-500">{ing.category}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
