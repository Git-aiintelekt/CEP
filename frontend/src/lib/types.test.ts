import { expect, test } from 'vitest'

import { makeReceiptLayout } from '@/test/mockApi'

test('each receipt section carries its own controls, found by key', () => {
  const { sections } = makeReceiptLayout()
  const items = sections.find((section) => section.key === 'items')
  const totals = sections.find((section) => section.key === 'totals')
  const fulfillment = sections.find((section) => section.key === 'customer_fulfillment')
  const support = sections.find((section) => section.key === 'support')

  expect(items?.columns).toEqual({ product_image: false, sku: false, quantity: true, unit_price: true, amount: true })
  expect(totals?.rows.tip).toBe(false)
  expect(fulfillment?.address_mode).toBe('AUTO')
  expect(support?.policy_text).not.toBe('')
  expect(sections.map((section) => section.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
})
