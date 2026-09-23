import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { ReceiptPreview } from './ReceiptPreview'
import { defaultSectionsFor } from './receiptPresets'
import { formatMoney } from './receiptRules'
import { SAMPLE_TRANSACTIONS } from './sampleReceiptData'

afterEach(cleanup)

const byId = (id: string) => SAMPLE_TRANSACTIONS.find((sample) => sample.id === id)?.data

test('seven samples: four eCommerce, three POS, each entry agreeing with its data', () => {
  expect(SAMPLE_TRANSACTIONS).toHaveLength(7)
  expect(SAMPLE_TRANSACTIONS.filter((sample) => sample.source === 'ECOMMERCE')).toHaveLength(4)
  expect(SAMPLE_TRANSACTIONS.filter((sample) => sample.source === 'POS')).toHaveLength(3)
  for (const sample of SAMPLE_TRANSACTIONS) expect(sample.data.source, sample.id).toBe(sample.source)
  expect(new Set(SAMPLE_TRANSACTIONS.map((sample) => sample.id)).size).toBe(7)
})

test('every sample has what the receipt needs, and its amounts add up', () => {
  for (const { id, data } of SAMPLE_TRANSACTIONS) {
    expect(data.order_number, id).not.toBe('')
    expect(data.line_items.length, id).toBeGreaterThan(0)
    const lines = data.line_items.reduce((sum, item) => sum + item.amount, 0)
    expect(lines, id).toBeCloseTo(data.subtotal, 2)
    const total = data.subtotal - (data.discount?.amount ?? 0) + (data.shipping ?? 0) + data.tax + (data.tip ?? 0)
    expect(total, id).toBeCloseTo(data.total, 2)
    // a payment is only ever shown masked or described, never as a full card number
    expect(data.payment.masked_method, id).not.toMatch(/\d{8,}/)
  }
})

test('the pickup order ships nothing, so it can have no shipping row', () => {
  const pickup = byId('order-48204')
  expect(pickup?.ship_to).toBeNull()
  expect(pickup?.pickup_location).not.toBeNull()
  expect(pickup?.shipping).toBeNull()
  render(<ReceiptPreview sections={defaultSectionsFor('ITEMIZED')} transaction={pickup!} />)
  expect(document.querySelector('[data-section="totals"]')?.textContent).not.toContain('Shipping')
  expect(document.querySelector('[data-section="customer_fulfillment"]')?.textContent).toContain('In store')
})

test('a POS sale with a shipping amount still shows no shipping row', () => {
  for (const sample of SAMPLE_TRANSACTIONS.filter((item) => item.source === 'POS')) {
    render(<ReceiptPreview sections={defaultSectionsFor('ITEMIZED')} transaction={{ ...sample.data, shipping: 9.99 }} />)
    expect(document.querySelector('[data-section="totals"]')?.textContent, sample.id).not.toContain('Shipping')
    cleanup()
  }
})

test('the refund is negative throughout, with true minus signs', () => {
  const refund = byId('refund-r1187')
  expect(refund?.total).toBeLessThan(0)
  expect(refund?.subtotal).toBeLessThan(0)
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={refund!} />)
  expect(document.querySelector('[data-section="totals"]')?.textContent).toContain(`−$96.12`)
  expect(document.body.textContent).not.toMatch(/-\$/)
})

test('the exchange nets to exactly zero, and zero carries no minus sign', () => {
  const exchange = byId('exchange-pos3352')
  expect(exchange?.total).toBe(0)
  expect(Object.is(exchange?.total, -0)).toBe(false)
  expect(formatMoney(exchange!.total)).toBe('$0.00')
  render(<ReceiptPreview sections={defaultSectionsFor('STANDARD')} transaction={exchange!} />)
  expect(document.querySelector('[data-section="totals"]')?.textContent).toContain('Total$0.00')
})

test('the split payment and the cash sale describe their tender in words', () => {
  expect(byId('order-48188')?.payment.masked_method).toMatch(/Gift card .* \+ Visa •••• \d{4}/)
  expect(byId('sale-pos3376')?.payment.masked_method).toMatch(/Cash .*change due/)
})
