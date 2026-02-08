'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { mappings, shoppingLists, stores, type IngredientMappingRow, type StoreProductResult } from '@/lib/api'
import { Link2, Search, X } from 'lucide-react'

function formatMoney(price: number | null | undefined, currency: string | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return 'Price unknown'
  const cur = currency || 'GBP'
  if (cur === 'GBP') return `£${price.toFixed(2)}`
  return `${cur} ${price.toFixed(2)}`
}

function ProductPill({ p, label }: { p: any; label: string }) {
  if (!p) {
    return (
      <div className="text-sm text-gray-500">
        <span className="font-medium text-gray-700">{label}:</span> None
      </div>
    )
  }
  return (
    <div className="flex items-start gap-3">
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="w-12 h-12 rounded object-cover bg-gray-100 border border-gray-200" />
      ) : (
        <div className="w-12 h-12 rounded bg-gray-100 border border-gray-200" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-medium text-gray-700">{label}:</span>{' '}
          <span className="font-semibold text-gray-900">{p.name}</span>
        </div>
        <div className="text-xs text-gray-600">
          {formatMoney(p.lastSeenPrice ?? null, p.currency ?? null)}
          {p.productUrl ? (
            <>
              {' '}
              <a className="underline hover:no-underline" href={p.productUrl} target="_blank" rel="noreferrer">
                View
              </a>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ProductSearchModal({
  open,
  onClose,
  title,
  initialQuery,
  onPick,
}: {
  open: boolean
  onClose: () => void
  title: string
  initialQuery: string
  onPick: (p: StoreProductResult) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<StoreProductResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const runSearch = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await stores.ocadoSearch(query, 10)
      setResults(data.results || [])
    } catch (e: any) {
      setResults([])
      setError(String(e?.message || e || 'Search failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 truncate">{title}</h3>
            <p className="text-sm text-gray-600">Search Ocado products and pick one.</p>
          </div>
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">Close</button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
            <button
              onClick={runSearch}
              disabled={!query.trim() || loading}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {results.map((r) => (
              <button
                key={r.storeProductId}
                onClick={() => onPick(r)}
                className="text-left p-3 rounded-lg border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-colors flex items-start gap-3"
              >
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt="" className="w-12 h-12 rounded object-cover bg-gray-100 border border-gray-200" />
                ) : (
                  <div className="w-12 h-12 rounded bg-gray-100 border border-gray-200" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 truncate">{r.name}</div>
                  <div className="text-xs text-gray-600">{formatMoney(r.price ?? null, r.currency)}</div>
                </div>
              </button>
            ))}
          </div>

          {!loading && results.length === 0 && (
            <div className="text-sm text-gray-500">No results yet. Try a search.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MappingsPage() {
  const queryClient = useQueryClient()

  const [q, setQ] = useState('')
  const [shoppingListId, setShoppingListId] = useState<string>('')

  const { data: lists } = useQuery({
    queryKey: ['shoppingLists', 'all'],
    queryFn: () => shoppingLists.list(),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['mappings', shoppingListId || null, q],
    queryFn: () => mappings.list({ shoppingListId: shoppingListId || undefined, q: q.trim() || undefined, limit: 200 }),
  })

  const items: IngredientMappingRow[] = data?.items || []

  const selectedListLabel = useMemo(() => {
    const list = (lists || []).find(l => l.id === shoppingListId)
    if (!list) return null
    return `List ${String(list.createdDate).slice(0, 10)}`
  }, [lists, shoppingListId])

  const setDefaultMutation = useMutation({
    mutationFn: (args: { ingredientId: string; storeProductId: string }) => mappings.setDefault(args.ingredientId, args.storeProductId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mappings'] }),
  })

  const clearDefaultMutation = useMutation({
    mutationFn: (ingredientId: string) => mappings.clearDefault(ingredientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mappings'] }),
  })

  const setOverrideMutation = useMutation({
    mutationFn: (args: { shoppingListId: string; ingredientId: string; storeProductId: string }) =>
      mappings.setOverride(args.shoppingListId, args.ingredientId, args.storeProductId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mappings'] }),
  })

  const clearOverrideMutation = useMutation({
    mutationFn: (args: { shoppingListId: string; ingredientId: string }) => mappings.clearOverride(args.shoppingListId, args.ingredientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mappings'] }),
  })

  const [modal, setModal] = useState<null | { mode: 'default' | 'override'; row: IngredientMappingRow }>(null)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Link2 className="w-6 h-6" />
            Mappings
          </h1>
          <p className="text-sm text-gray-600">
            Set a default mapping (forever) or override it for one shopping list without changing the default.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Filter ingredients</label>
            <div className="flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. milk"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              {q.trim() && (
                <button
                  onClick={() => setQ('')}
                  className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
                  title="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Per-list override</label>
            <select
              value={shoppingListId}
              onChange={(e) => setShoppingListId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
            >
              <option value="">None (defaults only)</option>
              {(lists || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {String(l.createdDate).slice(0, 10)}
                </option>
              ))}
            </select>
            {selectedListLabel && <div className="text-xs text-gray-500 mt-1">Editing: {selectedListLabel}</div>}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading mappings…</div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => (
            <div key={row.ingredientId} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-gray-900 truncate">{row.ingredientName}</div>
                  <div className="mt-2 space-y-2">
                    {shoppingListId ? (
                      <>
                        <ProductPill p={row.overrideMapping} label="This list" />
                        <ProductPill p={row.defaultMapping} label="Default" />
                      </>
                    ) : (
                      <ProductPill p={row.defaultMapping} label="Default" />
                    )}

                    {row.effectiveSource && (
                      <div className="text-xs text-gray-600">
                        Effective: <span className="font-medium">{row.effectiveSource === 'this_list' ? 'This list override' : 'Default mapping'}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => setModal({ mode: 'default', row })}
                    className="px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 text-sm"
                  >
                    Set default
                  </button>
                  {row.defaultMapping && (
                    <button
                      onClick={() => clearDefaultMutation.mutate(row.ingredientId)}
                      disabled={clearDefaultMutation.isPending}
                      className="px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50"
                    >
                      Unset default
                    </button>
                  )}

                  <div className="h-px bg-gray-200 my-1" />

                  <button
                    onClick={() => setModal({ mode: 'override', row })}
                    disabled={!shoppingListId}
                    className={clsx(
                      'px-3 py-2 rounded-lg text-sm',
                      shoppingListId
                        ? 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-900'
                        : 'bg-gray-50 border border-gray-100 text-gray-400 cursor-not-allowed'
                    )}
                    title={shoppingListId ? 'Set for this list only' : 'Select a shopping list to edit overrides'}
                  >
                    Set for this list
                  </button>
                  {shoppingListId && row.overrideMapping && (
                    <button
                      onClick={() => clearOverrideMutation.mutate({ shoppingListId, ingredientId: row.ingredientId })}
                      disabled={clearOverrideMutation.isPending}
                      className="px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50"
                    >
                      Unset for this list
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {items.length === 0 && (
            <div className="text-sm text-gray-500">No ingredients match that filter.</div>
          )}
        </div>
      )}

      <ProductSearchModal
        open={!!modal}
        onClose={() => setModal(null)}
        title={
          modal
            ? modal.mode === 'default'
              ? `Set default mapping for ${modal.row.ingredientName}`
              : `Set this-list override for ${modal.row.ingredientName}`
            : 'Search'
        }
        initialQuery={modal?.row.ingredientName || ''}
        onPick={(p) => {
          if (!modal) return
          if (modal.mode === 'default') {
            setDefaultMutation.mutate({ ingredientId: modal.row.ingredientId, storeProductId: p.storeProductId })
          } else {
            if (!shoppingListId) return
            setOverrideMutation.mutate({ shoppingListId, ingredientId: modal.row.ingredientId, storeProductId: p.storeProductId })
          }
          setModal(null)
        }}
      />
    </div>
  )
}

