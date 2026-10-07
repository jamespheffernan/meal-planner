import type { BasketProposal } from './contracts.js'
/** The installed Aside CLI has no machine-verifiable cart observation contract.
 * Keep this handoff available without interpreting agent prose as a receipt. */
export function basketHandoff(basket: BasketProposal): string {
  return [
    `Pi Meals basket ${basket.id}; revision ${basket.revision}; selection ${basket.selectionId} revision ${basket.selectionRevision}.`,
    'Fill the Ocado trolley only with these reviewed product IDs and pack counts. Do not substitute products, remove or reduce existing items, select a delivery slot, enter checkout, pay, or place an order.',
    'Read the complete trolley first. If it cannot be read reliably, stop. Record every existing product ID and quantity, including manual items. For each manifest product, add the stated number of packs to its baseline quantity. Record the baseline and intended target BEFORE each write. If a write is interrupted or uncertain, stop without retrying it or starting another executor.',
    'Read the complete trolley after changes. Return structured evidence with task/session ID, full baseline and final product IDs and quantities, each intended target, differences, and unresolved items. A written success claim is not verification.',
    JSON.stringify({basketId:basket.id,selectionRevision:basket.selectionRevision,lines:basket.lines},null,2),
  ].join('\n\n')
}
export const asideAvailability = 'Aside CLI does not expose a verified structured cart readback. Use the exact handoff and review the trolley; automatic execution is unavailable.'
