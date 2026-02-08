import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { StoreProvider } from '@prisma/client'
import { OcadoAutomation } from '../services/stores/ocado/ocado-automation.js'
import { getStoreSessionStatus } from '../services/store-session.js'
import { z } from 'zod'

const SearchSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(20).optional(),
})

const AddToCartSchema = z.object({
  providerProductId: z.string().min(1),
  quantity: z.number().int().min(1).max(50).optional(),
})

const CheckoutDryRunSchema = z.object({
  slotIndex: z.number().int().min(0).max(50).optional(),
  selectSlot: z.boolean().optional(),
})

const PlaceOrderSchema = z.object({
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
})

export default async function storesRoutes(fastify: FastifyInstance) {
  fastify.get('/providers', async () => {
    const providers: StoreProvider[] = ['ocado']

    const statuses = await Promise.all(
      providers.map(async (provider) => {
        const session = await getStoreSessionStatus(fastify.prisma, provider)
        // StoreIntegration table exists, but for now treat ENV as the source of enablement.
        const enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_STORE_OCADO || 'true').toLowerCase())
        return {
          provider,
          enabled: provider === 'ocado' ? enabled : false,
          hasSession: session.hasSession,
        }
      })
    )

    return { providers: statuses }
  })

  // Ocado: Search
  fastify.post('/ocado/search', async (request: FastifyRequest, reply) => {
    const parsed = SearchSchema.safeParse(request.body || {})
    if (!parsed.success) {
      return reply.badRequest('query is required')
    }

    const ocado = new OcadoAutomation(fastify.prisma)
    const results = await ocado.withPage({}, async ({ page }) => {
      return ocado.searchProducts(page, parsed.data.query, parsed.data.maxResults || 5)
    })

    // Upsert into StoreProduct table for learning/mappings
    const now = new Date()
    const storeProducts = await Promise.all(results.map(async (r) => {
      const record = await fastify.prisma.storeProduct.upsert({
        where: {
          provider_providerProductId: {
            provider: 'ocado',
            providerProductId: r.providerProductId,
          },
        },
        update: {
          name: r.name,
          imageUrl: r.imageUrl,
          productUrl: r.productUrl,
          lastSeenPrice: r.price !== null ? r.price : undefined,
          currency: r.currency,
          lastSeenAt: now,
        },
        create: {
          provider: 'ocado',
          providerProductId: r.providerProductId,
          name: r.name,
          imageUrl: r.imageUrl,
          productUrl: r.productUrl,
          lastSeenPrice: r.price !== null ? r.price : undefined,
          currency: r.currency,
          lastSeenAt: now,
        },
      })
      return { ...r, storeProductId: record.id }
    }))

    return { results: storeProducts }
  })

  // Ocado: Add to cart
  fastify.post('/ocado/cart/add', async (request: FastifyRequest, reply) => {
    const parsed = AddToCartSchema.safeParse(request.body || {})
    if (!parsed.success) {
      return reply.badRequest('providerProductId is required')
    }

    const ocado = new OcadoAutomation(fastify.prisma)
    await ocado.withPage({}, async ({ page }) => {
      await ocado.addToCart(page, parsed.data.providerProductId, parsed.data.quantity || 1)
    })

    return { ok: true }
  })

  // Ocado: View cart
  fastify.get('/ocado/cart', async () => {
    const ocado = new OcadoAutomation(fastify.prisma)
    const cart = await ocado.withPage({}, async ({ page }) => {
      return ocado.viewCart(page)
    })
    return cart
  })

  // Placeholder for checkout dry-run (selector work will evolve as needed)
  fastify.post('/ocado/checkout/dry-run', async (request: FastifyRequest, reply) => {
    const parsed = CheckoutDryRunSchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('Invalid request')

    const ocado = new OcadoAutomation(fastify.prisma)
    let url = 'https://www.ocado.com'
    let selectedSlotText: string | null = null
    const slots = await ocado.withPage({}, async ({ page }) => {
      const found = await ocado.getDeliverySlots(page, 10)
      if (parsed.data.selectSlot) {
        const res = await ocado.selectDeliverySlot(page, parsed.data.slotIndex || 0)
        selectedSlotText = res.ok ? (res.fullText || null) : null
      }
      url = page.url()
      return found
    })

    return { ok: true, slots, selectedSlotText, url }
  })

  fastify.post('/ocado/place-order', async (request: FastifyRequest, reply) => {
    const parsed = PlaceOrderSchema.safeParse(request.body || {})
    if (!parsed.success) return reply.badRequest('Invalid request')

    const dryRun = parsed.data.dryRun ?? true
    const confirm = parsed.data.confirm ?? false
    if (!dryRun) {
      const enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.ORDER_PLACEMENT_ENABLED || 'false').toLowerCase())
      if (!enabled) return reply.badRequest('Order placement disabled (set ORDER_PLACEMENT_ENABLED=true).')
      if (!confirm) return reply.badRequest('confirm=true required to place an order.')
    }

    const ocado = new OcadoAutomation(fastify.prisma)
    const result = await ocado.withPage({}, async ({ page }) => {
      return ocado.placeOrder(page, { dryRun })
    })

    return result
  })
}
