'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pantry, ingredients } from '@/lib/api'
import { format } from 'date-fns'
import { useState } from 'react'
import { Plus, Package, AlertTriangle, Check, X } from 'lucide-react'
import clsx from 'clsx'
import type { PantryItem, Ingredient } from '@/lib/api'
import { formatIngredientQuantity } from '@/lib/units'

export default function PantryPage() {
  const queryClient = useQueryClient()
  const [showAddModal, setShowAddModal] = useState(false)
  const [filter, setFilter] = useState<'all' | 'stocked' | 'running_low' | 'depleted'>('all')

  const { data: pantryItems, isLoading } = useQuery({
    queryKey: ['pantry', filter],
    queryFn: () => pantry.list(filter === 'all' ? undefined : { status: filter }),
  })

  const { data: expiringItems } = useQuery({
    queryKey: ['pantry', 'expiring'],
    queryFn: () => pantry.expiring(7),
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      pantry.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] })
    },
  })

  // Group items by category
  const groupedItems = pantryItems?.reduce((acc, item) => {
    const category = item.ingredient.category
    if (!acc[category]) acc[category] = []
    acc[category].push(item)
    return acc
  }, {} as Record<string, PantryItem[]>) || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Pantry</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          <Plus className="w-4 h-4" />
          Add Item
        </button>
      </div>

      {/* Expiring Alert */}
      {expiringItems && expiringItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-amber-800 mb-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Items expiring soon</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {expiringItems.map(item => (
              <span key={item.id} className="px-2 py-1 bg-amber-100 text-amber-800 rounded text-sm">
                {item.ingredient.name}
                {item.expirationDate && ` - ${format(new Date(item.expirationDate), 'MMM d')}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(['all', 'stocked', 'running_low', 'depleted'] as const).map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
              filter === status
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            {status.replace('_', ' ')}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading pantry...</p>
      ) : pantryItems && pantryItems.length > 0 ? (
        <div className="space-y-6">
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category} className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-100">
                <h2 className="text-sm font-medium text-gray-500 uppercase">{category}</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map(item => (
                  <PantryItemRow
                    key={item.id}
                    item={item}
                    onUpdateStatus={(status) => updateStatusMutation.mutate({ id: item.id, status })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">Your pantry is empty.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            Add Your First Item
          </button>
        </div>
      )}

      {showAddModal && (
        <AddPantryItemModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  )
}

function PantryItemRow({ item, onUpdateStatus }: {
  item: PantryItem
  onUpdateStatus: (status: string) => void
}) {
  const statusColors: Record<string, string> = {
    stocked: 'bg-green-100 text-green-800',
    running_low: 'bg-amber-100 text-amber-800',
    depleted: 'bg-red-100 text-red-800',
  }

  const isExpiringSoon = item.expirationDate && new Date(item.expirationDate) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  return (
    <div className={clsx('p-4 flex items-center justify-between', isExpiringSoon && 'bg-amber-50')}>
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900">{item.ingredient.name}</p>
          {isExpiringSoon && (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          )}
        </div>
        <p className="text-sm text-gray-500">
          {formatIngredientQuantity(Number(item.quantity), item.unit)}
          {item.expirationDate && ` · Expires ${format(new Date(item.expirationDate), 'MMM d')}`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className={clsx('px-2 py-1 text-xs rounded-full capitalize', statusColors[item.status])}>
          {item.status.replace('_', ' ')}
        </span>

        <div className="flex gap-1">
          {item.status !== 'stocked' && (
            <button
              onClick={() => onUpdateStatus('stocked')}
              className="p-1 bg-green-100 hover:bg-green-200 rounded text-green-700"
              title="Mark as stocked"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          {item.status !== 'depleted' && (
            <button
              onClick={() => onUpdateStatus('depleted')}
              className="p-1 bg-red-100 hover:bg-red-200 rounded text-red-700"
              title="Mark as depleted"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AddPantryItemModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [expirationDate, setExpirationDate] = useState('')

  const { data: ingredientList } = useQuery({
    queryKey: ['ingredients', search],
    queryFn: () => ingredients.list({ search }),
    enabled: search.length > 0,
  })

  const createMutation = useMutation({
    mutationFn: pantry.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] })
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedIngredient || !quantity) return

    createMutation.mutate({
      ingredientId: selectedIngredient.id,
      quantity: parseFloat(quantity),
      unit: unit || selectedIngredient.typicalUnit,
      expirationDate: expirationDate || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Add Pantry Item</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {!selectedIngredient ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search Ingredient
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              {ingredientList && ingredientList.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                  {ingredientList.map(ing => (
                    <button
                      key={ing.id}
                      type="button"
                      onClick={() => {
                        setSelectedIngredient(ing)
                        setUnit(ing.typicalUnit)
                      }}
                      className="w-full p-2 text-left hover:bg-gray-50"
                    >
                      <p className="font-medium">{ing.name}</p>
                      <p className="text-xs text-gray-500">{ing.category}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="p-3 bg-gray-50 rounded-lg flex justify-between items-center">
                <div>
                  <p className="font-medium">{selectedIngredient.name}</p>
                  <p className="text-xs text-gray-500">{selectedIngredient.category}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIngredient(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Unit
                  </label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiration Date (optional)
                </label>
                <input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>

              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Adding...' : 'Add to Pantry'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
