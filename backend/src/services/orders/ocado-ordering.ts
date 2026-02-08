import type { PrismaClient } from '@prisma/client'
import { OcadoAutomation } from '../stores/ocado/ocado-automation.js'

export async function checkoutDryRunForShoppingList(prisma: PrismaClient, shoppingListId: string, opts?: { selectSlot?: boolean; slotIndex?: number }) {
  const ocado = new OcadoAutomation(prisma)

  let checkoutUrl = 'https://www.ocado.com'
  let selectedSlotText: string | null = null
  const slots = await ocado.withPage({}, async ({ page }) => {
    const found = await ocado.getDeliverySlots(page, 10)
    if (opts?.selectSlot) {
      const res = await ocado.selectDeliverySlot(page, opts.slotIndex || 0)
      selectedSlotText = res.ok ? (res.fullText || null) : null
    }
    checkoutUrl = page.url()
    return found
  })

  // Best-effort: update most recent pending order for this list.
  const existing = await prisma.purchaseOrder.findFirst({
    where: { shoppingListId, provider: 'ocado', status: 'pending', source: 'from_shopping_list' },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    await prisma.purchaseOrder.update({
      where: { id: existing.id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        checkoutUrl, // user completes in browser; actual URL can vary
        deliverySlot: opts?.selectSlot ? (selectedSlotText || existing.deliverySlot) : existing.deliverySlot,
      },
    }).catch(() => undefined)
  }

  return { ok: true as const, slots, selectedSlotText, url: checkoutUrl }
}
