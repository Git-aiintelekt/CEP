/** What a receipt shows for a given transaction: the rules the preview renders by, apart from how it looks. */
import type { ReceiptCustomerFulfillmentSection, ReceiptSection, ReceiptTotalsSection } from '@/lib/types'

import type { SampleTransaction } from './sampleReceiptData'

/** U+2212, not a hyphen: a refund's total reads as a minus in every font. */
export const MINUS = '−'

const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatMoney(amount: number): string {
  return `${amount < 0 ? MINUS : ''}$${MONEY.format(Math.abs(amount))}`
}

/**
 * A locked section always shows; any other shows when switched on. Loyalty also needs an enrolled customer:
 * for anyone else it hides whatever its switch says.
 */
export function showsSection(section: ReceiptSection, transaction: SampleTransaction): boolean {
  if (section.key === 'loyalty' && !transaction.loyalty) return false
  return section.locked || section.visible
}

export function fulfillmentOf(section: ReceiptCustomerFulfillmentSection, transaction: SampleTransaction): { title: string; address: string | null } {
  const shipping =
    section.address_mode === 'SHIP_TO' ? true
    : section.address_mode === 'PICKUP' ? false
    : transaction.ship_to !== null || transaction.pickup_location === null
  return shipping ?
      { title: 'Delivery', address: transaction.ship_to }
    : { title: 'In store', address: transaction.pickup_location ?? transaction.store }
}

export interface TotalsRow {
  key: 'subtotal' | 'discount' | 'shipping' | 'tax' | 'tip'
  label: string
  amount: number
  note?: string
}

/** Subtotal, Discount, Shipping, Tax, Tip, each when switched on and present. A POS sale has no shipping, ever. */
export function totalsRows(section: ReceiptTotalsSection, transaction: SampleTransaction): TotalsRow[] {
  const { rows } = section
  const out: TotalsRow[] = []
  if (rows.subtotal) out.push({ key: 'subtotal', label: 'Subtotal', amount: transaction.subtotal })
  if (rows.discount && transaction.discount) {
    out.push({ key: 'discount', label: 'Discount', amount: -transaction.discount.amount, note: transaction.discount.code })
  }
  if (rows.shipping && transaction.source !== 'POS' && transaction.shipping !== null) {
    out.push({ key: 'shipping', label: 'Shipping', amount: transaction.shipping })
  }
  if (rows.tax) out.push({ key: 'tax', label: 'Tax', amount: transaction.tax })
  if (rows.tip && transaction.tip !== null) out.push({ key: 'tip', label: 'Tip', amount: transaction.tip })
  return out
}
