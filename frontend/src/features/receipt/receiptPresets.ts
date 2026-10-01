/**
 * The receipt's presentation presets. A preset is a starting point: choosing one rewrites every section's
 * columns, rows and visibility at once, and anything changed afterwards simply overrides it.
 */
import type { ReceiptSlotPreset } from '@/features/designer/inspector/receiptSettings'
import type { ReceiptLayoutPreset, ReceiptSection } from '@/lib/types'

export const PRESET_CARDS: { value: ReceiptLayoutPreset; title: string; description: string }[] = [
  { value: 'COMPACT', title: 'Compact', description: 'Item and amount only — best for one- or two-line orders.' },
  { value: 'STANDARD', title: 'Standard', description: 'Images, quantity and unit price.' },
  { value: 'ITEMIZED', title: 'Itemized', description: 'Adds SKU and every totals row — for B2B and expense claims.' },
  { value: 'REGISTER', title: 'Store Register', description: 'The paper receipt as the register prints it: transaction numbers, each line’s discount, taxes and tenders.' },
  { value: 'CUSTOM_HTML', title: 'Custom HTML', description: 'Write the receipt’s HTML and CSS yourself.' },
]

export const DEFAULT_POLICY_TEXT = 'Unworn items with tags can be returned within 30 days in store or by mail for a full refund.'

/** The Standard receipt: every section on. The test fixture is built from this, so the two cannot drift. */
function standard(): ReceiptSection[] {
  return [
    { key: 'header', label: 'Order header', order: 0, locked: true, visible: true, data_binding: 'Order.header',
      fields: { order_number: true, order_date: true, store: true, receipt_id: true } },
    { key: 'customer_fulfillment', label: 'Customer & fulfillment', order: 1, locked: false, visible: true, data_binding: 'Order.fulfillment',
      address_mode: 'AUTO', delivery_estimate: true },
    { key: 'items', label: 'Items', order: 2, locked: true, visible: true, data_binding: 'Order.lineItems[]',
      columns: { product_image: false, sku: false, quantity: true, unit_price: true, amount: true }, row_height: 'DEFAULT' },
    { key: 'totals', label: 'Totals', order: 3, locked: true, visible: true, data_binding: 'Order.totals',
      rows: { subtotal: true, discount: true, tax: true, shipping: true, tip: false }, savings_callout: true },
    { key: 'payment', label: 'Payment', order: 4, locked: false, visible: true, data_binding: 'Order.payment',
      fields: { method: true, authorization_time: true, billing_address: true } },
    { key: 'loyalty', label: 'Loyalty', order: 5, locked: false, visible: true, data_binding: 'Order.loyalty',
      fields: { points_earned: true, points_balance: true, tier_progress: true } },
    { key: 'support', label: 'Returns & support', order: 6, locked: false, visible: true, data_binding: null,
      policy_text: DEFAULT_POLICY_TEXT, barcode: false },
  ]
}

const COMPACT_HIDDEN = new Set(['customer_fulfillment', 'loyalty', 'support'])

/** A fresh copy every time: the caller owns what it gets and may change it. */
export function defaultSectionsFor(preset: ReceiptSlotPreset): ReceiptSection[] {
  return standard().map((section): ReceiptSection => {
    if (preset === 'COMPACT') {
      if (COMPACT_HIDDEN.has(section.key)) return { ...section, visible: false }
      if (section.key === 'items') {
        return { ...section, columns: { product_image: false, sku: false, quantity: false, unit_price: true, amount: true }, row_height: 'COMPACT' }
      }
    }
    if (preset === 'ITEMIZED') {
      if (section.key === 'items') return { ...section, columns: { ...section.columns, sku: true }, row_height: 'DEFAULT' }
      if (section.key === 'totals') return { ...section, rows: { subtotal: true, discount: true, tax: true, shipping: true, tip: true } }
    }
    return section
  })
}

export function inOrder(sections: ReceiptSection[]): ReceiptSection[] {
  return [...sections].sort((a, b) => a.order - b.order)
}

/** Swaps a section with its neighbour. Nothing is fixed in place: only the ends of the list stop a move. */
export function moveSection(sections: ReceiptSection[], key: ReceiptSection['key'], direction: 'up' | 'down'): ReceiptSection[] {
  const ordered = inOrder(sections)
  const from = ordered.findIndex((section) => section.key === key)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from === -1 || to < 0 || to >= ordered.length) return sections
  ;[ordered[from], ordered[to]] = [ordered[to], ordered[from]]
  return ordered.map((section, order) => ({ ...section, order }))
}
