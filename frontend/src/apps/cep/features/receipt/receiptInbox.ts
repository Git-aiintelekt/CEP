/** The inbox line a receipt arrives as, written from the sample itself rather than typed. */
import { formatMoney } from './receiptRules'
import type { SampleEntry } from './sampleReceiptData'

/** "Order #48219 — 3 items" -> "order #48219" */
function kindAndNumber(label: string): string {
  const head = label.split(' — ')[0].trim()
  return head.charAt(0).toLowerCase() + head.slice(1)
}

export function receiptSubject(sample: SampleEntry): string {
  return `Your Northline receipt · ${kindAndNumber(sample.label)}`
}

export function receiptPreheader(sample: SampleEntry): string {
  return `Total ${formatMoney(sample.data.total)} · keep this receipt for returns`
}

export function itemCount(sample: SampleEntry): string {
  const count = sample.data.line_items.length
  return `${count} ${count === 1 ? 'item' : 'items'}`
}
