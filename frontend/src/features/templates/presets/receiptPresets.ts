/**
 * The four e-receipt presets: the receipt editor's own outer design with a greeting of their own, and the Standard
 * receipt layout with only what each name implies changed.
 */
import { defaultSectionsFor } from '@/features/receipt/receiptPresets'
import { receiptOuterMjml } from '@/features/receipt/receiptStarter'
import type { ReceiptSection } from '@/lib/types'

import type { PresetDefinition } from './types'

/** A section's changes: any field, and any part of a nested field set (columns, rows, fields). */
type Nested<T> = { [P in keyof T]?: T[P] extends object ? Partial<T[P]> : T[P] }
type Change = { [K in ReceiptSection['key']]?: Nested<Extract<ReceiptSection, { key: K }>> }

/** Standard sections with named changes; a nested field set is merged, not replaced. */
function standardWith(changes: Change): ReceiptSection[] {
  return defaultSectionsFor('STANDARD').map((section) => {
    const change = changes[section.key] as Record<string, unknown> | undefined
    if (!change) return section
    const merged: Record<string, unknown> = { ...section }
    for (const [name, value] of Object.entries(change)) {
      const current = (section as unknown as Record<string, unknown>)[name]
      merged[name] = value && typeof value === 'object' && current && typeof current === 'object' ? { ...current, ...value } : value
    }
    return merged as unknown as ReceiptSection
  })
}

const receipt = (headline: string, body: string, subject_line: string, preheader: string, sections: ReceiptSection[]): PresetDefinition['content'] => ({
  kind: 'receipt', subject_line, preheader, mjml: receiptOuterMjml({ headline, body }), layout_preset: 'STANDARD', sections,
})

export const receiptStandard: PresetDefinition = {
  // the server's own starter key: this replaces its In-store purchase receipt rather than listing beside it
  key: 'store_receipt',
  name: 'Standard store receipt',
  channel: 'E_RECEIPT',
  category: 'E-receipt',
  description: 'A plain in-store purchase: store, items, totals, payment and returns.',
  content: receipt(
    // not "Thanks for shopping with us": the brand header's tagline already says it
    'Here is your receipt, {{first_name}}', 'Thanks for shopping at {{store_name}}. Keep this email for returns and exchanges.',
    'Your receipt from {{store_name}}', 'Receipt {{receipt_number}} for {{grand_total}}',
    standardWith({ loyalty: { visible: false } }),
  ),
}

export const receiptSavingsPoints: PresetDefinition = {
  key: 'receipt_savings_points',
  name: 'Savings + points',
  channel: 'E_RECEIPT',
  category: 'E-receipt',
  description: 'A purchase receipt that calls out what the customer saved and the points they earned.',
  content: receipt(
    'You saved today, {{first_name}}', 'Your receipt is below, with what you saved and the points this purchase earned you.',
    '{{first_name}}, here is what you saved today', 'Your receipt, your savings and your points.',
    standardWith({ totals: { savings_callout: true }, loyalty: { visible: true, fields: { points_earned: true, points_balance: true, tier_progress: false } } }),
  ),
}

export const receiptOnlineOrder: PresetDefinition = {
  // the server's own starter key: this replaces its Online order confirmation rather than listing beside it
  key: 'order_confirmation',
  name: 'Online order',
  channel: 'E_RECEIPT',
  category: 'E-receipt',
  description: 'An online order shipped to the customer: delivery address, estimate and pictures of what is coming.',
  content: receipt(
    'Thanks for your order, {{first_name}}', 'Order {{order_number}} is confirmed. We will email you again when it ships.',
    'Order {{order_number}} confirmed', 'Estimated delivery {{delivery_estimate}}',
    standardWith({ customer_fulfillment: { address_mode: 'SHIP_TO', delivery_estimate: true }, items: { columns: { product_image: true } }, loyalty: { visible: false } }),
  ),
}

export const receiptBopis: PresetDefinition = {
  key: 'receipt_bopis',
  name: 'BOPIS',
  channel: 'E_RECEIPT',
  category: 'E-receipt',
  description: 'Buy online, pick up in store: which store to collect from, with no delivery estimate.',
  content: receipt(
    'Your order will be waiting, {{first_name}}', 'Collect order {{order_number}} from {{store_name}}. We will email you as soon as it is ready. Bring this email with you.',
    'Order {{order_number}}: pick up at {{store_name}}', 'We will email you when it is ready to collect.',
    standardWith({ customer_fulfillment: { address_mode: 'PICKUP', delivery_estimate: false }, header: { fields: { store: true } }, loyalty: { visible: false } }),
  ),
}

export const RECEIPT_PRESETS: PresetDefinition[] = [receiptStandard, receiptSavingsPoints, receiptOnlineOrder, receiptBopis]
