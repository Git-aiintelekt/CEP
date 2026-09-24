/**
 * The personalization tags a receipt layout's sections stand for. Recorded on the preset as requiredTags, but they do
 * not gate it: receipt presets are offered wherever e-receipts are (see offerable in presetSource.ts).
 *
 * The receipt editor itself has no such list to reuse: its sections read the transaction directly (data_binding
 * Order.header, Order.lineItems[] ...). These are the keys the server gives the same data under, from
 * REQUIRED_TAGS in backend apps/templates/starters.py, plus loyalty_points and loyalty_tier, which its own
 * receipt starter uses. No key here is new.
 */
import type { ReceiptSection } from '@/lib/types'

/** A locked section always shows, so it counts whatever its switch says (receiptRules.showsSection). */
const shows = (section: ReceiptSection) => section.locked || section.visible

function tagsOf(section: ReceiptSection): string[] {
  switch (section.key) {
    case 'header':
      return [section.fields.order_number && 'order_number', section.fields.order_date && 'transaction_date', section.fields.store && 'store_name',
              section.fields.receipt_id && 'receipt_number'].filter((tag): tag is string => Boolean(tag))
    case 'customer_fulfillment': {
      const address = section.address_mode === 'SHIP_TO' ? ['shipping_address'] : section.address_mode === 'PICKUP' ? ['store_address'] : ['shipping_address', 'store_address']
      return [...address, ...(section.delivery_estimate ? ['delivery_estimate'] : [])]
    }
    // the line items themselves come from the transaction; they belong to an order
    case 'items':
      return ['order_number']
    case 'totals':
      return [section.rows.subtotal && 'subtotal', section.rows.discount && 'discount_total', section.rows.tax && 'tax_total', 'grand_total']
        .filter((tag): tag is string => Boolean(tag))
    case 'payment':
      return section.fields.method ? ['payment_method'] : []
    case 'loyalty':
      return [(section.fields.points_earned || section.fields.points_balance) && 'loyalty_points', section.fields.tier_progress && 'loyalty_tier']
        .filter((tag): tag is string => Boolean(tag))
    case 'support':
      return []
  }
}

export function receiptSectionTags(sections: ReceiptSection[]): string[] {
  return [...new Set(sections.filter(shows).flatMap(tagsOf))]
}
