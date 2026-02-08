import { PrismaClient } from '@prisma/client'
import { OcadoAutomation } from '../services/stores/ocado/ocado-automation.js'

function classifyOcadoError(e: any): { code: string; message: string } {
  const msg = String(e?.message || e || 'unknown error')
  const m = msg.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/)
  if (m) return { code: m[1], message: m[2] || msg }
  return { code: 'ERROR', message: msg }
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const ocado = new OcadoAutomation(prisma)

    // Headed smoke is intentional: if a captcha appears, you'll see it.
    const result = await ocado.withPage({ headless: false }, async ({ page }) => {
      const out: any = {
        ok: true,
        url: page.url(),
        checks: [] as any[],
        search: null as any,
        cart: null as any,
        slots: null as any,
        selectedSlot: null as any,
        dryRun: null as any,
      }

      // Search
      try {
        const search = await ocado.searchProducts(page, 'milk', 5)
        out.search = search
        const valid = Array.isArray(search) && search.length >= 1 && search.every(p => p.providerProductId && p.name)
        out.checks.push({ name: 'search', ok: valid, count: Array.isArray(search) ? search.length : 0 })
      } catch (e: any) {
        out.ok = false
        out.checks.push({ name: 'search', ok: false, error: classifyOcadoError(e) })
      }

      // Cart
      try {
        const cart = await ocado.viewCart(page)
        out.cart = cart
        const hasMapping = Array.isArray(cart?.items) && cart.items.some((i: any) => i.providerProductId && typeof i.quantity === 'number')
        out.checks.push({ name: 'cart', ok: true, itemCount: cart?.items?.length || 0, hasProductIds: hasMapping, total: cart?.total ?? null, status: cart?._status || null, meta: cart?._meta || null })
      } catch (e: any) {
        out.ok = false
        out.checks.push({ name: 'cart', ok: false, error: classifyOcadoError(e) })
      }

      // Slots
      try {
        const slots = await ocado.getDeliverySlots(page, 10)
        out.slots = slots
        out.checks.push({ name: 'slots', ok: true, count: Array.isArray(slots) ? slots.length : 0 })
        if (Array.isArray(slots) && slots.length >= 1) {
          const sel = await ocado.selectDeliverySlot(page, 0)
          out.selectedSlot = sel
          out.checks.push({ name: 'selectSlot', ok: !!sel?.ok, fullText: sel?.fullText || null })
        } else {
          out.checks.push({ name: 'selectSlot', ok: false, skipped: true, reason: 'no slots' })
        }
      } catch (e: any) {
        out.ok = false
        out.checks.push({ name: 'slots', ok: false, error: classifyOcadoError(e) })
      }

      // Checkout dry-run (should remain safe)
      try {
        const dryRun = await ocado.placeOrder(page, { dryRun: true })
        out.dryRun = dryRun
        out.checks.push({ name: 'placeOrderDryRun', ok: !!dryRun?.ok, message: dryRun?.message, url: dryRun?.url })
      } catch (e: any) {
        out.ok = false
        out.checks.push({ name: 'placeOrderDryRun', ok: false, error: classifyOcadoError(e) })
      }

      out.url = page.url()
      return out
    })

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
