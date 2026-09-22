import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import type { ReceiptSection } from '@/lib/types'

import { ReceiptPreview } from './ReceiptPreview'
import { defaultSectionsFor } from './receiptPresets'
import { DEFAULT_SAMPLE_TRANSACTION, type SampleTransaction } from './sampleReceiptData'

afterEach(cleanup)

const shown = () => [...document.querySelectorAll('[data-section]')].map((node) => node.getAttribute('data-section'))
const section = (key: string) => document.querySelector(`[data-section="${key}"]`) as HTMLElement | null

function edit(change: (sections: ReceiptSection[]) => ReceiptSection[], preset: 'COMPACT' | 'STANDARD' | 'ITEMIZED' = 'STANDARD') {
  return change(defaultSectionsFor(preset))
}
const patch = (key: string, over: Partial<ReceiptSection>) => (sections: ReceiptSection[]) =>
  sections.map((item) => (item.key === key ? ({ ...item, ...over } as ReceiptSection) : item))

test('Standard shows all seven sections, in order', () => {
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  expect(shown()).toEqual(['header', 'customer_fulfillment', 'items', 'totals', 'payment', 'loyalty', 'support'])
})

test('a hidden section is left out; a locked one shows even if told not to', () => {
  render(<ReceiptPreview sections={edit((list) => patch('totals', { visible: false })(patch('payment', { visible: false })(list)))} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  expect(shown()).not.toContain('payment')
  expect(shown()).toContain('totals')
})

test('columns switched off are not drawn, and the SKU is a line under the item', () => {
  const sections = edit(patch('items', { columns: { product_image: false, sku: true, quantity: false, unit_price: false, amount: true } } as Partial<ReceiptSection>))
  render(<ReceiptPreview sections={sections} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  const items = section('items') as HTMLElement
  expect(items.querySelector('[data-column="quantity"]')).toBeNull()
  expect(items.querySelector('[data-column="unit_price"]')).toBeNull()
  expect(items.querySelector('[data-column="product_image"]')).toBeNull()
  expect(items.querySelectorAll('[data-column="sku"]')).toHaveLength(3)
  expect(items.textContent).toContain('NL-SW-2041')
})

test('the image column drops out when the receipt itself is narrow', () => {
  const sections = edit(patch('items', { columns: { product_image: true, sku: false, quantity: true, unit_price: true, amount: true } } as Partial<ReceiptSection>))
  render(<ReceiptPreview sections={sections} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  expect(screen.getByTestId('receipt').className).toContain('@container')
  expect((section('items')?.querySelector('[data-column="product_image"]') as HTMLElement | null)?.className).toContain('@max-[420px]:hidden')
})

test('money is two decimals in tabular figures, right-aligned', () => {
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  const total = screen.getByText('$144.11')
  expect(total.className).toContain('tabular-nums')
  expect(total.className).toContain('text-right')
  expect(section('items')?.textContent).toContain('$14.50')
})

test('shipping never shows on a POS sale, whatever its switch says', () => {
  const pos: SampleTransaction = { ...DEFAULT_SAMPLE_TRANSACTION, source: 'POS' }
  const { unmount } = render(<ReceiptPreview sections={defaultSectionsFor('ITEMIZED')} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  expect(section('totals')?.textContent).toContain('Shipping')
  unmount()

  render(<ReceiptPreview sections={defaultSectionsFor('ITEMIZED')} transaction={pos} />)
  expect(section('totals')?.textContent).not.toContain('Shipping')
})

test('loyalty hides itself for a customer who is not enrolled, even when switched on', () => {
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={{ ...DEFAULT_SAMPLE_TRANSACTION, loyalty: null }} />)
  expect(shown()).not.toContain('loyalty')
})

test('a negative total carries a true minus sign, and the discount reads as one too', () => {
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={{ ...DEFAULT_SAMPLE_TRANSACTION, total: -24 }} />)
  const totals = section('totals')?.textContent ?? ''
  expect(totals).toContain('−$24.00')
  expect(totals).toContain('−$15.00')
  expect(totals).not.toMatch(/-\$/)
})

test('the dashed rule sits directly above Totals and nowhere else', () => {
  const sections = edit((list) => list)
  render(<ReceiptPreview sections={sections} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  const dashed = [...document.querySelectorAll('.border-dashed')].filter((node) => node.hasAttribute('data-section'))
  expect(dashed.map((node) => node.getAttribute('data-section'))).toEqual(['totals'])
  for (const key of ['customer_fulfillment', 'items', 'payment', 'loyalty', 'support']) expect(section(key)?.className).toContain('border-line')
})

test('the savings note shows with a discount and the callout on', () => {
  const { unmount } = render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={DEFAULT_SAMPLE_TRANSACTION} />)
  expect(screen.getByText(/You saved/).className).toContain('bg-callout-bg')
  unmount()
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={{ ...DEFAULT_SAMPLE_TRANSACTION, discount: null }} />)
  expect(screen.queryByText(/You saved/)).toBeNull()
})

test('fulfillment names delivery or pickup from the address mode', () => {
  const pickup = edit(patch('customer_fulfillment', { address_mode: 'PICKUP' } as Partial<ReceiptSection>))
  render(<ReceiptPreview sections={pickup} transaction={{ ...DEFAULT_SAMPLE_TRANSACTION, pickup_location: 'Northline Portland, 40 Fore St' }} />)
  expect(section('customer_fulfillment')?.textContent).toContain('In store')
  expect(section('customer_fulfillment')?.textContent).toContain('40 Fore St')
})

test('inside the email shell the receipt sits in a dimmed stand-in, labelled', () => {
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={DEFAULT_SAMPLE_TRANSACTION} insideShell />)
  expect(screen.getByTestId('email-shell')).toBeTruthy()
  expect(screen.getByText('Receipt layout')).toBeTruthy()
  expect(screen.getByTestId('email-shell').querySelector('.opacity-40')).toBeTruthy()
})
