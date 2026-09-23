import { expect, test } from 'vitest'

import type { ReceiptSection } from '@/lib/types'
import { makeReceiptLayout } from '@/test/mockApi'

import { defaultSectionsFor, moveSection } from './receiptPresets'

const KEYS = ['header', 'customer_fulfillment', 'items', 'totals', 'payment', 'loyalty', 'support']
const PRESETS = ['COMPACT', 'STANDARD', 'ITEMIZED'] as const

const find = <K extends ReceiptSection['key']>(sections: ReceiptSection[], key: K) =>
  sections.find((section) => section.key === key) as Extract<ReceiptSection, { key: K }>

test('every preset has all seven sections, in order', () => {
  for (const preset of PRESETS) {
    const sections = defaultSectionsFor(preset)
    expect(sections.map((section) => section.key), preset).toEqual(KEYS)
    expect(sections.map((section) => section.order), preset).toEqual([0, 1, 2, 3, 4, 5, 6])
  }
})

test('the order header, items and totals are locked on in every preset', () => {
  for (const preset of PRESETS) {
    for (const key of ['header', 'items', 'totals'] as const) {
      expect(find(defaultSectionsFor(preset), key), `${preset} ${key}`).toMatchObject({ locked: true, visible: true })
    }
  }
})

test('Compact hides fulfillment, loyalty and support, and lists item and amount only', () => {
  const sections = defaultSectionsFor('COMPACT')
  expect(sections.filter((section) => !section.visible).map((section) => section.key)).toEqual(['customer_fulfillment', 'loyalty', 'support'])
  expect(find(sections, 'payment').visible).toBe(true)
  expect(find(sections, 'items')).toMatchObject({
    row_height: 'COMPACT', columns: { product_image: false, sku: false, quantity: false, unit_price: true, amount: true },
  })
})

test('Itemized adds the SKU and every totals row', () => {
  const sections = defaultSectionsFor('ITEMIZED')
  expect(find(sections, 'items').columns.sku).toBe(true)
  expect(find(sections, 'items').row_height).toBe('DEFAULT')
  expect(Object.values(find(sections, 'totals').rows).every(Boolean)).toBe(true)
})

test('Standard is the test fixture exactly: the fixture is built from it', () => {
  expect(defaultSectionsFor('STANDARD')).toEqual(makeReceiptLayout().sections)
})

test('each call is a fresh copy', () => {
  const first = defaultSectionsFor('STANDARD')
  find(first, 'items').columns.sku = true
  expect(find(defaultSectionsFor('STANDARD'), 'items').columns.sku).toBe(false)
})

test('any section moves, locked or not; only the ends of the list stop it', () => {
  const sections = defaultSectionsFor('STANDARD')
  const order = (list: ReceiptSection[]) => [...list].sort((a, b) => a.order - b.order).map((section) => section.key)

  expect(order(moveSection(sections, 'items', 'up'))).toEqual(['header', 'items', 'customer_fulfillment', 'totals', 'payment', 'loyalty', 'support'])
  expect(order(moveSection(sections, 'header', 'down'))).toEqual(['customer_fulfillment', 'header', 'items', 'totals', 'payment', 'loyalty', 'support'])
  expect(moveSection(sections, 'header', 'up')).toBe(sections)
  expect(moveSection(sections, 'support', 'down')).toBe(sections)
})
