'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shoppingLists, mealPlans } from '@/lib/api'
import { format, addDays, startOfWeek } from 'date-fns'
import { useState } from 'react'
import { ShoppingCart, Check, RefreshCw, Package } from 'lucide-react'
import clsx from 'clsx'
import type { ShoppingList, ShoppingListItem } from '@/lib/api'
import { formatIngredientQuantity } from '@/lib/units'

export default function ShoppingPage() {
  const queryClient = useQueryClient()
  const [activeListId, setActiveListId] = useState<string | null>(null)

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekEnd = addDays(weekStart, 6)

  const { data: lists, isLoading: listsLoading } = useQuery({
    queryKey: ['shoppingLists'],
    queryFn: () => shoppingLists.list(),
  })

  const { data: weekMealPlans } = useQuery({
    queryKey: ['mealPlans', 'forShopping'],
    queryFn: () => mealPlans.list({
      fromDate: format(weekStart, 'yyyy-MM-dd'),
      toDate: format(weekEnd, 'yyyy-MM-dd'),
    }),
  })

  const generateMutation = useMutation({
    mutationFn: () => {
      const mealPlanIds = weekMealPlans?.filter(mp => mp.status === 'planned').map(mp => mp.id) || []
      return shoppingLists.generate(mealPlanIds)
    },
    onSuccess: (newList) => {
      queryClient.invalidateQueries({ queryKey: ['shoppingLists'] })
      setActiveListId(newList.id)
    },
  })

  const activeList = lists?.find(l => l.id === activeListId) || lists?.[0]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Shopping List</h1>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || !weekMealPlans?.length}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={clsx('w-4 h-4', generateMutation.isPending && 'animate-spin')} />
          Generate from Meal Plan
        </button>
      </div>

      {listsLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : lists && lists.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List Selector */}
          <div className="lg:col-span-1 space-y-2">
            <h2 className="text-sm font-medium text-gray-500 mb-2">Shopping Lists</h2>
            {lists.map(list => (
              <button
                key={list.id}
                onClick={() => setActiveListId(list.id)}
                className={clsx(
                  'w-full p-3 rounded-lg text-left transition-colors',
                  activeList?.id === list.id ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'
                )}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{format(new Date(list.createdDate), 'MMM d, yyyy')}</span>
                  <StatusBadge status={list.status} />
                </div>
                <p className={clsx('text-sm', activeList?.id === list.id ? 'text-gray-300' : 'text-gray-500')}>
                  {list.items.length} items
                  {list.totalEstimatedCost && ` · £${Number(list.totalEstimatedCost).toFixed(2)}`}
                </p>
              </button>
            ))}
          </div>

          {/* Active List */}
          <div className="lg:col-span-2">
            {activeList ? (
              <ShoppingListView list={activeList} />
            ) : (
              <p className="text-gray-500">Select a list to view</p>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">No shopping lists yet.</p>
          <p className="text-gray-500 text-sm mb-4">
            Plan some meals first, then generate a shopping list.
          </p>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !weekMealPlans?.length}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            Generate Shopping List
          </button>
        </div>
      )}
    </div>
  )
}

function ShoppingListView({ list }: { list: ShoppingList }) {
  const queryClient = useQueryClient()

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: { purchased?: boolean; userOverride?: 'need' | 'have' | null } }) =>
      shoppingLists.updateItem(list.id, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shoppingLists'] })
    },
  })

  const completeMutation = useMutation({
    mutationFn: () => shoppingLists.complete(list.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shoppingLists'] })
      queryClient.invalidateQueries({ queryKey: ['pantry'] })
    },
  })

  // Group items by category
  const groupedItems = list.items.reduce((acc, item) => {
    const category = item.ingredient.category
    if (!acc[category]) acc[category] = []
    acc[category].push(item)
    return acc
  }, {} as Record<string, ShoppingListItem[]>)

  const needItems = list.items.filter(item => {
    if (item.userOverride === 'have') return false
    if (item.userOverride === 'need') return true
    return !item.assumedHave
  })

  const purchasedCount = list.items.filter(i => i.purchased).length

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">
            {format(new Date(list.createdDate), 'MMMM d, yyyy')}
          </h2>
          <p className="text-sm text-gray-500">
            {purchasedCount} of {needItems.length} items purchased
          </p>
        </div>
        {list.status !== 'completed' && (
          <button
            onClick={() => completeMutation.mutate()}
            disabled={completeMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <Package className="w-4 h-4" />
            Complete & Update Pantry
          </button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {Object.entries(groupedItems).map(([category, items]) => (
          <div key={category} className="p-4">
            <h3 className="text-sm font-medium text-gray-500 uppercase mb-3">{category}</h3>
            <div className="space-y-2">
              {items.map(item => {
                const isNeeded = item.userOverride === 'need' || (!item.userOverride && !item.assumedHave)
                return (
                  <div
                    key={item.id}
                    className={clsx(
                      'flex items-center gap-3 p-2 rounded-lg',
                      item.purchased ? 'bg-green-50' :
                      !isNeeded ? 'bg-gray-50 opacity-60' : 'bg-white'
                    )}
                  >
                    <button
                      onClick={() => updateItemMutation.mutate({
                        itemId: item.id,
                        data: { purchased: !item.purchased }
                      })}
                      className={clsx(
                        'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors',
                        item.purchased ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-gray-400'
                      )}
                    >
                      {item.purchased && <Check className="w-4 h-4" />}
                    </button>

                    <div className="flex-1">
                      <p className={clsx('font-medium', item.purchased && 'line-through text-gray-500')}>
                        {item.ingredient.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {formatIngredientQuantity(Number(item.quantity), item.unit)}
                        {item.estimatedCost && ` · £${Number(item.estimatedCost).toFixed(2)}`}
                      </p>
                    </div>

                    <div className="flex gap-1">
                      <button
                        onClick={() => updateItemMutation.mutate({
                          itemId: item.id,
                          data: { userOverride: item.userOverride === 'have' ? null : 'have' }
                        })}
                        className={clsx(
                          'px-2 py-1 text-xs rounded transition-colors',
                          item.userOverride === 'have' || (item.assumedHave && !item.userOverride)
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        )}
                      >
                        Have
                      </button>
                      <button
                        onClick={() => updateItemMutation.mutate({
                          itemId: item.id,
                          data: { userOverride: item.userOverride === 'need' ? null : 'need' }
                        })}
                        className={clsx(
                          'px-2 py-1 text-xs rounded transition-colors',
                          item.userOverride === 'need' || (!item.assumedHave && !item.userOverride)
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        )}
                      >
                        Need
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    ready: 'bg-blue-100 text-blue-700',
    shopping: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
  }

  return (
    <span className={clsx('px-2 py-0.5 text-xs rounded-full capitalize', colors[status] || colors.draft)}>
      {status}
    </span>
  )
}
