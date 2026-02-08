'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { orders } from '@/lib/api'
import { format } from 'date-fns'
import clsx from 'clsx'

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

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id || '')
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: () => orders.get(id),
    enabled: Boolean(id),
  })

  const order = data?.order

  const [deliverySlot, setDeliverySlot] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!order) return
    setDeliverySlot(order.deliverySlot || '')
    setNotes(order.notes || '')
  }, [order?.id])

  const updateMutation = useMutation({
    mutationFn: (patch: { status?: 'pending' | 'approved' | 'placed' | 'delivered' | 'cancelled'; notes?: string | null; deliverySlot?: string | null }) =>
      orders.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  const meta = useMemo(() => {
    if (!order) return []
    const fmt = (v?: string | null) => (v ? format(new Date(v), 'MMM d, yyyy · HH:mm') : '—')
    return [
      { label: 'Created', value: fmt(order.createdAt) },
      { label: 'Approved', value: fmt(order.approvedAt) },
      { label: 'Placed', value: fmt(order.placedAt) },
      { label: 'Delivered', value: fmt(order.deliveredAt) },
      { label: 'Cancelled', value: fmt(order.cancelledAt) },
    ]
  }, [order])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              Order
            </h1>
            {order && <StatusPill status={order.status} />}
          </div>
          {order && (
            <p className="text-sm text-gray-600">
              {order.provider.toUpperCase()} · Total {money(order.total)} · {order.items?.length || 0} items
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link href="/orders" className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">
            Back
          </Link>
          {order?.checkoutUrl && (
            <a
              href={order.checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800"
            >
              Open checkout
            </a>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : error ? (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {errorMessage(error) || 'Failed to load order'}
        </div>
      ) : !order ? (
        <div className="p-6 bg-white rounded-lg shadow text-sm text-gray-600">
          Order not found.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Items</h2>
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500">
                    <tr>
                      <th className="py-2 pr-3">Item</th>
                      <th className="py-2 pr-3">Qty</th>
                      <th className="py-2 pr-3">Unit</th>
                      <th className="py-2 pr-3">Unit price</th>
                      <th className="py-2">Line total</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-800">
                    {order.items.map(it => (
                      <tr key={it.id} className="border-t border-gray-100">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            {it.storeProduct?.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={it.storeProduct.imageUrl} alt="" className="w-8 h-8 rounded object-cover bg-gray-100" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-gray-100" />
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {it.ingredient?.name || it.storeProduct?.name || it.rawName}
                              </p>
                              {it.storeProduct?.productUrl && (
                                <a className="text-xs text-gray-600 underline" href={it.storeProduct.productUrl} target="_blank" rel="noreferrer">
                                  Product page
                                </a>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-3">{it.quantity}</td>
                        <td className="py-2 pr-3">{it.unit || '—'}</td>
                        <td className="py-2 pr-3">{money(it.price)}</td>
                        <td className="py-2">{money(it.lineTotal ?? (Number(it.price) * it.quantity || null))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow border border-gray-100 p-4 space-y-3">
              <h2 className="font-semibold text-gray-900">Lifecycle</h2>
              <div className="grid grid-cols-1 gap-2">
                {meta.map(m => (
                  <div key={m.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-600">{m.label}</span>
                    <span className="text-gray-900">{m.value}</span>
                  </div>
                ))}
              </div>
              {order.deliverySlot && (
                <p className="text-sm text-gray-700">
                  Slot: <span className="font-medium">{order.deliverySlot}</span>
                </p>
              )}
            </div>

            <div className="bg-white rounded-lg shadow border border-gray-100 p-4 space-y-3">
              <h2 className="font-semibold text-gray-900">Actions</h2>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">Delivery slot</label>
                <input
                  value={deliverySlot}
                  onChange={(e) => setDeliverySlot(e.target.value)}
                  placeholder="e.g. Tue 6-7pm"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <button
                  onClick={() => updateMutation.mutate({ deliverySlot: deliverySlot.trim() ? deliverySlot.trim() : null })}
                  disabled={updateMutation.isPending}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-800 disabled:opacity-50"
                >
                  Save slot
                </button>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <button
                  onClick={() => updateMutation.mutate({ notes: notes.trim() ? notes : null })}
                  disabled={updateMutation.isPending}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-800 disabled:opacity-50"
                >
                  Save notes
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => updateMutation.mutate({ status: 'cancelled' })}
                  disabled={updateMutation.isPending || order.status === 'cancelled' || order.status === 'delivered'}
                  className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 disabled:opacity-50"
                  title={order.status === 'delivered' ? 'Delivered orders cannot be cancelled' : undefined}
                >
                  Mark cancelled
                </button>
                <button
                  onClick={() => updateMutation.mutate({ status: 'delivered' })}
                  disabled={updateMutation.isPending || order.status !== 'placed'}
                  className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  title={order.status !== 'placed' ? 'Only placed orders can be marked delivered' : undefined}
                >
                  Mark delivered
                </button>
              </div>

              {updateMutation.isError && (
                <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
                  {errorMessage(updateMutation.error) || 'Failed to update order'}
                </div>
              )}
              {updateMutation.isSuccess && (
                <div className="p-2 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
                  Updated.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

