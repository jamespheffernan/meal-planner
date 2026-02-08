'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shoppingLists, mealPlans, orders } from '@/lib/api'
import { format, addDays, startOfWeek } from 'date-fns'
import { useState } from 'react'
import { ShoppingCart, Check, RefreshCw, Package } from 'lucide-react'
import clsx from 'clsx'
import type { ShoppingList, ShoppingListItem, PreparedOrder, AddToCartResult, OrderReviewResult } from '@/lib/api'
import { formatIngredientQuantity } from '@/lib/units'

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  const maybe = e as { message?: unknown }
  if (maybe && typeof maybe.message === 'string') return maybe.message
  try {
    return JSON.stringify(e)
  } catch {
    return 'Unknown error'
  }
}

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
  const [orderModalOpen, setOrderModalOpen] = useState(false)
  const [prepared, setPrepared] = useState<PreparedOrder | null>(null)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [review, setReview] = useState<OrderReviewResult | null>(null)
  const [orderResult, setOrderResult] = useState<AddToCartResult | null>(null)
  const [orderAnalysis, setOrderAnalysis] = useState<any>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [slots, setSlots] = useState<Array<{ date: string; time: string; price: string; fullText: string }> | null>(null)
  const [orderInfo, setOrderInfo] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [dryRunUrl, setDryRunUrl] = useState<string | null>(null)

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

  const prepareOrderMutation = useMutation({
    mutationFn: () => shoppingLists.prepareOrder(list.id, 'ocado', 5),
    onSuccess: (data) => {
      setPrepared(data)
      // Initialize selections for auto-mapped items (none needed) and empty for needsChoice.
      const initial: Record<string, string> = {}
      data.needsChoice.forEach(nc => {
        if (nc.candidates[0]) initial[nc.ingredientId] = nc.candidates[0].storeProductId
      })
      setSelections(initial)
      // Seed quantity overrides for all needed items; piece-like units keep their rounded quantity,
      // everything else defaults to 1 (since store pack sizes vary).
      const q: Record<string, number> = {}
      const neededIngredientIds = new Set<string>([
        ...data.autoMapped.map(a => a.ingredientId),
        ...data.needsChoice.map(nc => nc.ingredientId),
      ])
      list.items.forEach(i => {
        if (!neededIngredientIds.has(i.ingredientId)) return
        const u = String(i.unit || '').toLowerCase()
        const base = Number(i.quantity) || 1
        const qty = (u === 'piece' || u === 'pc' || u === 'pcs') ? Math.max(1, Math.round(base)) : 1
        q[i.ingredientId] = qty
      })
      setQuantities(q)
      setOrderResult(null)
      setOrderAnalysis(null)
      setReview(null)
      setOrderError(null)
      setOrderInfo(null)
      setSlots(null)
      setCheckoutUrl(null)
      setDryRunUrl(null)
      setOrderModalOpen(true)
    },
    onError: (err: unknown) => {
      setOrderError(errorMessage(err) || 'Failed to prepare order')
      setOrderModalOpen(true)
    },
  })

  const confirmMappingsMutation = useMutation({
    mutationFn: async () => {
      if (!prepared) return { ok: true, mappings: [] }
      const mappings = prepared.needsChoice.map(nc => ({
        ingredientId: nc.ingredientId,
        storeProductId: selections[nc.ingredientId],
        isDefault: true,
      })).filter(m => m.storeProductId)
      if (mappings.length === 0) return { ok: true, mappings: [] }
      return shoppingLists.confirmMappings(list.id, mappings)
    },
  })

  const addToCartMutation = useMutation({
    mutationFn: () => shoppingLists.addToCartWithQuantities(list.id, 'ocado', quantities),
    onSuccess: async (data) => {
      setOrderResult(data)
      setOrderAnalysis(null)
      setOrderError(null)
      setOrderInfo('Added mapped items to cart.')
      setReview(null)
      queryClient.invalidateQueries({ queryKey: ['shoppingLists'] })
      if (data.purchaseOrderId) {
        try {
          const analysis = await orders.analysis(data.purchaseOrderId)
          setOrderAnalysis(analysis)
        } catch {
          // non-blocking
        }
      }
    },
    onError: (err: unknown) => {
      setOrderResult(null)
      setOrderAnalysis(null)
      setOrderError(errorMessage(err) || 'Failed to add to cart')
    },
  })

  const reviewMutation = useMutation({
    mutationFn: () => shoppingLists.reviewOrder(list.id, 'ocado', quantities),
    onSuccess: (data) => {
      setReview(data)
      setOrderError(null)
      setOrderInfo('Review ready. Confirm to add to cart.')
    },
    onError: (err: unknown) => {
      setReview(null)
      setOrderError(errorMessage(err) || 'Failed to review order')
    },
  })

  const checkoutDryRunMutation = useMutation({
    mutationFn: () => shoppingLists.checkoutDryRun(list.id, 'ocado'),
    onSuccess: (data) => {
      setSlots(data.slots || [])
      setCheckoutUrl(data.url || 'https://www.ocado.com')
      setOrderInfo('Fetched delivery slots (dry-run).')
    },
    onError: (err: unknown) => {
      setSlots(null)
      setOrderError(errorMessage(err) || 'Failed to get delivery slots')
    },
  })

  const placeOrderDryRunMutation = useMutation({
    mutationFn: () => shoppingLists.placeOrderDryRun(list.id, 'ocado'),
    onSuccess: (data) => {
      setOrderError(null)
      setOrderInfo(data.message || 'Checkout dry run completed.')
      setDryRunUrl(data.url || null)
      setSlots((prev) => prev ?? [])
    },
    onError: (err: unknown) => {
      setOrderError(errorMessage(err) || 'Failed to run place-order dry run')
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
        <div className="flex items-center gap-2">
          {list.status !== 'completed' && (
            <button
              onClick={() => prepareOrderMutation.mutate()}
              disabled={prepareOrderMutation.isPending}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              title="Maps items to Ocado products and adds them to your cart"
            >
              {prepareOrderMutation.isPending ? 'Preparing...' : 'Order on Ocado'}
            </button>
          )}
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

      {orderModalOpen && (
        <OrderOnOcadoModal
          prepared={prepared}
          selections={selections}
          setSelections={(next) => { setSelections(next); setReview(null) }}
          quantities={quantities}
          setQuantities={(next) => { setQuantities(next); setReview(null) }}
          error={orderError}
          info={orderInfo}
	          review={review}
	          reviewPending={reviewMutation.isPending}
	          result={orderResult}
	          analysis={orderAnalysis}
	          slots={slots}
	          checkoutUrl={checkoutUrl}
	          dryRunUrl={dryRunUrl}
          confirmMappingsPending={confirmMappingsMutation.isPending}
          addToCartPending={addToCartMutation.isPending}
          onClose={() => setOrderModalOpen(false)}
          onReview={async () => {
            setOrderError(null)
            try {
              await confirmMappingsMutation.mutateAsync()
              await reviewMutation.mutateAsync()
            } catch (e: unknown) {
              setOrderError(errorMessage(e) || 'Failed to review order')
            }
          }}
          onAddToCart={async () => {
            setOrderError(null)
            try {
              await addToCartMutation.mutateAsync()
            } catch (e: unknown) {
              setOrderError(errorMessage(e) || 'Failed to add to cart')
            }
          }}
          onCheckoutDryRun={() => checkoutDryRunMutation.mutate()}
          checkoutDryRunPending={checkoutDryRunMutation.isPending}
          onPlaceOrderDryRun={() => placeOrderDryRunMutation.mutate()}
          placeOrderDryRunPending={placeOrderDryRunMutation.isPending}
        />
      )}
    </div>
  )
}

function OrderOnOcadoModal({
  prepared,
  selections,
  setSelections,
  quantities,
  setQuantities,
  error,
  info,
  review,
  reviewPending,
  result,
  slots,
  checkoutUrl,
  dryRunUrl,
  confirmMappingsPending,
  addToCartPending,
  onClose,
  onReview,
  onAddToCart,
  onCheckoutDryRun,
  checkoutDryRunPending,
  onPlaceOrderDryRun,
  placeOrderDryRunPending,
}: {
  prepared: PreparedOrder | null
  selections: Record<string, string>
  setSelections: (next: Record<string, string>) => void
  quantities: Record<string, number>
  setQuantities: (next: Record<string, number>) => void
  error: string | null
  info: string | null
  review: OrderReviewResult | null
  reviewPending: boolean
  result: AddToCartResult | null
  slots: Array<{ date: string; time: string; price: string; fullText: string }> | null
  checkoutUrl: string | null
  dryRunUrl: string | null
  confirmMappingsPending: boolean
  addToCartPending: boolean
  onClose: () => void
  onReview: () => void
  onAddToCart: () => void
  onCheckoutDryRun: () => void
  checkoutDryRunPending: boolean
  onPlaceOrderDryRun: () => void
  placeOrderDryRunPending: boolean
}) {
  const needsChoice = prepared?.needsChoice || []
  const autoMapped = prepared?.autoMapped || []
  const isBusy = confirmMappingsPending || addToCartPending || reviewPending
  const missingSelection = needsChoice.some(nc => !selections[nc.ingredientId])
  const orderCount = autoMapped.length + needsChoice.length

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Order on Ocado</h3>
            <p className="text-sm text-gray-600">
              Choose a product for any unmapped ingredients, then we’ll add items to your Ocado cart.
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">
            Close
          </button>
        </div>

        <div className="p-4 space-y-6 max-h-[70vh] overflow-auto">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}
          {info && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
              {info}
            </div>
          )}

          {!prepared ? (
            <p className="text-sm text-gray-600">Preparing…</p>
          ) : (
            <>
              <div className="text-sm text-gray-700">
                Will order <span className="font-semibold">{orderCount}</span> items (skips anything marked Have/Purchased).
              </div>

              {autoMapped.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
                  <p className="font-medium text-gray-900">Already mapped</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {autoMapped.map(a => (
                      <div key={a.itemId} className="bg-white border border-gray-200 rounded-lg p-2 flex items-start gap-2">
                        {a.storeProduct.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.storeProduct.imageUrl} alt="" className="w-12 h-12 rounded object-cover bg-gray-100" />
                        ) : (
                          <div className="w-12 h-12 rounded bg-gray-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">{a.ingredientName}</p>
                          <p className="text-xs text-gray-600 truncate">{a.storeProduct.name}</p>
                          <p className="text-xs text-gray-500">
                            {a.storeProduct.lastSeenPrice !== null && a.storeProduct.lastSeenPrice !== undefined
                              ? `Last seen: £${Number(a.storeProduct.lastSeenPrice).toFixed(2)}`
                              : 'Last seen price: unknown'}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <label className="text-[11px] text-gray-600">Qty</label>
                          <input
                            type="number"
                            min={1}
                            value={quantities[a.ingredientId] || 1}
                            onChange={(e) => setQuantities({ ...quantities, [a.ingredientId]: Math.max(1, parseInt(e.target.value || '1')) })}
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {needsChoice.length > 0 ? (
                <div className="space-y-4">
                  {needsChoice.map(item => (
                    <div key={item.itemId} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{item.ingredientName}</p>
                          <p className="text-xs text-gray-600">Search: {item.query}</p>
                        </div>
                        <span className="text-xs text-gray-500">{item.candidates.length} candidates</span>
                      </div>

                      <div className="flex items-center justify-between gap-3 mb-3">
                        <label className="text-xs text-gray-600">
                          Quantity override
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={quantities[item.ingredientId] || 1}
                          onChange={(e) => setQuantities({ ...quantities, [item.ingredientId]: Math.max(1, parseInt(e.target.value || '1')) })}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {item.candidates.map(c => {
                          const selected = selections[item.ingredientId] === c.storeProductId
                          return (
                            <button
                              key={c.storeProductId}
                              type="button"
                              onClick={() => setSelections({ ...selections, [item.ingredientId]: c.storeProductId })}
                              className={clsx(
                                'border rounded-lg p-2 text-left flex gap-2 items-start hover:bg-gray-50',
                                selected ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
                              )}
                            >
                              {c.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.imageUrl} alt="" className="w-12 h-12 rounded object-cover bg-gray-100" />
                              ) : (
                                <div className="w-12 h-12 rounded bg-gray-100" />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                                <p className="text-xs text-gray-600">
                                  {c.price !== null ? `£${c.price.toFixed(2)}` : 'Price unknown'}
                                </p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-600">All items are already mapped.</p>
              )}

              {result && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Added to cart.</p>
                    <a
                      href="https://www.ocado.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline"
                    >
                      Open Ocado
                    </a>
                  </div>
                  <p>
                    Cart total: {result.cart.total !== null ? `£${result.cart.total.toFixed(2)}` : 'unknown'} ({result.cart.items.length} items detected)
                  </p>
                  {result.skippedAlreadyInCart && result.skippedAlreadyInCart.length > 0 && (
                    <p className="text-green-900">
                      Skipped {result.skippedAlreadyInCart.length} items already in cart (idempotent add).
                    </p>
                  )}
                  {result.missingMappings.length > 0 && (
                    <p className="text-amber-800">
                      Missing mappings for: {result.missingMappings.map(m => m.ingredientName).join(', ')}
                    </p>
                  )}
                </div>
              )}

              {review && (
                <div className={clsx(
                  'p-3 rounded-lg border text-sm space-y-2',
                  review.minimum?.below ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-gray-200 text-gray-800'
                )}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">Order review</p>
                    <p className="text-xs text-gray-600">
                      Intended: {review.intendedCount} · Will add: {review.willAdd.length} · Already in cart: {review.alreadyInCart.length}
                    </p>
                  </div>
                  <p className="text-sm">
                    Cart total: {review.cart.total !== null ? `£${review.cart.total.toFixed(2)}` : 'unknown'}
                  </p>
                  {review.minimum?.below && (
                    <p className="text-sm">
                      Warning: below minimum order value (min £{review.minimum.threshold.toFixed(2)}).
                    </p>
                  )}
                  {review.willAdd.length > 0 && (
                    <div>
                      <p className="text-sm font-medium">Will add</p>
                      <ul className="list-disc pl-5 text-sm">
                        {review.willAdd.slice(0, 12).map((it) => (
                          <li key={it.ingredientId}>
                            {it.ingredientName}: want {it.desiredQuantity}, in cart {it.cartQuantity}, adding {it.delta}
                          </li>
                        ))}
                      </ul>
                      {review.willAdd.length > 12 && <p className="text-xs text-gray-600 mt-1">Showing first 12.</p>}
                    </div>
                  )}
                  {review.alreadyInCart.length > 0 && (
                    <div>
                      <p className="text-sm font-medium">Already in cart (will skip)</p>
                      <ul className="list-disc pl-5 text-sm">
                        {review.alreadyInCart.slice(0, 12).map((it) => (
                          <li key={it.ingredientId}>
                            {it.ingredientName}: want {it.desiredQuantity}, in cart {it.cartQuantity}
                          </li>
                        ))}
                      </ul>
                      {review.alreadyInCart.length > 12 && <p className="text-xs text-gray-600 mt-1">Showing first 12.</p>}
                    </div>
                  )}
                  {review.missingMappings.length > 0 && (
                    <p className="text-sm">
                      Missing mappings for: {review.missingMappings.map(m => m.ingredientName).join(', ')}
                    </p>
                  )}
                </div>
              )}

              {slots && (
                <div className="p-3 rounded-lg border border-gray-200 bg-white text-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900">Delivery slots (dry-run)</p>
                    {checkoutUrl && (
                      <a href={checkoutUrl} target="_blank" rel="noreferrer" className="text-sm underline text-gray-700">
                        Open checkout
                      </a>
                    )}
                  </div>
                  {slots.length === 0 ? (
                    <p className="text-gray-600">No slots detected. Open Ocado to pick a slot manually.</p>
                  ) : (
                    <ul className="text-gray-700 list-disc pl-5">
                      {slots.slice(0, 8).map((s, idx) => (
                        <li key={idx}>
                          {s.fullText} ({s.price})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {dryRunUrl && (
                <div className="p-3 rounded-lg border border-gray-200 bg-white text-sm">
                  <a href={dryRunUrl} target="_blank" rel="noreferrer" className="underline text-gray-700">
                    Open last checkout dry-run page
                  </a>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isBusy}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={onCheckoutDryRun}
            disabled={!prepared || isBusy || checkoutDryRunPending}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Find delivery slots (safe: does not place an order)"
          >
            {checkoutDryRunPending ? 'Checking…' : 'Check Delivery Slots'}
          </button>
          <button
            onClick={onPlaceOrderDryRun}
            disabled={!prepared || isBusy || placeOrderDryRunPending}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Try stepping through checkout (safe: stops before placing order)"
          >
            {placeOrderDryRunPending ? 'Running…' : 'Checkout Dry Run'}
          </button>
          <button
            onClick={onReview}
            disabled={!prepared || isBusy || missingSelection}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {reviewPending || confirmMappingsPending ? 'Reviewing…' : (review ? 'Re-run Review' : 'Review Order')}
          </button>
          <button
            onClick={onAddToCart}
            disabled={!prepared || isBusy || missingSelection || !review}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            title={!review ? 'Run review first' : 'Adds items to your cart (idempotent)'}
          >
            {addToCartPending ? 'Adding…' : 'Add to Cart'}
          </button>
        </div>
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
