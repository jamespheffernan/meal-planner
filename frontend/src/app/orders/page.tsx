'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orders } from '@/lib/api'
import { format } from 'date-fns'
import clsx from 'clsx'
import Link from 'next/link'
import { useState } from 'react'

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return 'Unknown error'
  }
}

function money(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return `£${n.toFixed(2)}`
}

function actionsFor(status: string): Array<{ label: string; to: string }> {
  if (status === 'pending') return [{ label: 'Mark approved', to: 'approved' }, { label: 'Cancel', to: 'cancelled' }]
  if (status === 'approved') return [{ label: 'Mark placed', to: 'placed' }, { label: 'Cancel', to: 'cancelled' }]
  if (status === 'placed') return [{ label: 'Mark delivered', to: 'delivered' }, { label: 'Cancel', to: 'cancelled' }]
  return []
}

function StatusPill({ status }: { status: string }) {
  const classes: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-blue-100 text-blue-800',
    placed: 'bg-purple-100 text-purple-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-gray-100 text-gray-700',
  }
  return (
    <span className={clsx('px-2 py-0.5 text-xs rounded-full capitalize', classes[status] || classes.pending)}>
      {status}
    </span>
  )
}

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const [rowError, setRowError] = useState<Record<string, string | null>>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders'],
    queryFn: () => orders.list({ limit: 50 }),
  })

  const list = data?.orders || []

  const updateMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => orders.update(id, { status: to as any }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err: any, vars: any) => {
      const msg = err instanceof Error ? err.message : String(err || 'Failed to update')
      setRowError(prev => ({ ...prev, [vars.id]: msg }))
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : error ? (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {errorMessage(error) || 'Failed to load orders'}
        </div>
	      ) : list.length === 0 ? (
        <div className="p-6 bg-white rounded-lg shadow text-sm text-gray-600">
          No orders yet. When you add a shopping list to cart, we’ll snapshot it here.
        </div>
	      ) : (
	        <div className="space-y-3">
	          {list.map(o => (
	            <div key={o.id} className="bg-white rounded-lg shadow border border-gray-100">
	              <div className="p-4 flex items-start justify-between gap-3">
	                <div className="min-w-0">
	                  <div className="flex items-center gap-2">
	                    <Link href={`/orders/${o.id}`} className="font-semibold text-gray-900 hover:underline">
	                      {o.provider.toUpperCase()} · {format(new Date(o.deliveredAt || o.placedAt || o.approvedAt || o.createdAt), 'MMM d, yyyy')}
	                    </Link>
	                    <StatusPill status={o.status} />
	                  </div>
                  <p className="text-sm text-gray-600">
                    Total: {money(o.total)} · {o.items?.length || 0} items
                  </p>
                  {o.deliverySlot && (
                    <p className="text-sm text-gray-600">
                      Slot: {o.deliverySlot}
                    </p>
                  )}
	                </div>

	                <div className="flex items-center gap-2">
	                  <Link
	                    href={`/orders/${o.id}`}
	                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
	                  >
	                    View
	                  </Link>
	                  {actionsFor(o.status).map(a => (
	                    <button
	                      key={a.to}
	                      onClick={() => {
	                        setRowError(prev => ({ ...prev, [o.id]: null }))
	                        updateMutation.mutate({ id: o.id, to: a.to })
	                      }}
	                      disabled={updateMutation.isPending}
	                      className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
	                    >
	                      {a.label}
	                    </button>
	                  ))}
	                  {o.checkoutUrl && (
	                    <a
	                      href={o.checkoutUrl}
	                      target="_blank"
	                      rel="noreferrer"
                      className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
	                    >
	                      Open checkout
	                    </a>
	                  )}
	                </div>
	              </div>

	              {rowError[o.id] && (
	                <div className="px-4 pb-3 text-sm text-red-700">
	                  {rowError[o.id]}
	                </div>
	              )}

	              {o.items && o.items.length > 0 && (
	                <div className="border-t border-gray-100 p-4">
	                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {o.items.slice(0, 20).map(it => (
                      <div key={it.id} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2">
                        {it.storeProduct?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.storeProduct.imageUrl} alt="" className="w-10 h-10 rounded object-cover bg-gray-100" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {it.ingredient?.name || it.storeProduct?.name || it.rawName}
                          </p>
                          <p className="text-xs text-gray-600">
                            Qty {it.quantity} · {money(it.price)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {o.items.length > 20 && (
                    <p className="text-xs text-gray-500 mt-2">Showing first 20 items.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
