import { expect, test } from 'vitest'

import { combineReceiptEmail } from './receiptCombined'
import { registerDetails, renderReceiptEmailHtml, renderRegisterEmailHtml } from './receiptEmailHtml'
import { PRESET_CARDS, defaultSectionsFor } from './receiptPresets'
import { DEFAULT_SAMPLE_TRANSACTION, SAMPLE_TRANSACTIONS, type SampleTransaction } from './sampleReceiptData'

const sale = SAMPLE_TRANSACTIONS.find((entry) => entry.data.register)!.data

test('the Store Register layout: YOUR RECEIPT, two rows of three, Description and Amount, each line with its quantity at price, the lines’ sum, then the money', () => {
  const html = renderRegisterEmailHtml(sale)
  for (const word of ['YOUR RECEIPT', 'Trans Num:', '3391', 'Register:', 'Store:', '450', 'Trans Dt:', '09/22/2026 12:41', 'Cashier:', '9999', 'Item(s) Sold:', 'Description', 'Amount']) expect(html).toContain(word)
  expect(html.match(/ @ \$/g)).toHaveLength(sale.line_items.length)
  expect(html).toContain('>$46.50<')                                                                           // the lines' sum, under the last line
  expect(html).toContain('Subtotal:')
  expect(html).toContain('Sales Tax (5.5%):')
  expect(html).toContain('TOTAL:')
  expect(html).toContain('Paid with CREDIT-VISA (Auth: 096837):')
  expect(html).not.toContain('Cash Change')                                                                     // no cash tender, no change line
  expect(html).toContain('data-layout="register"')
})

test('a line’s discount prints in green under its description; cash brings the change line; several taxes and tenders each get a row', () => {
  const cash: SampleTransaction = {
    ...sale,
    line_items: [{ ...sale.line_items[0], discount: 10, amount: 4.5 }, sale.line_items[1]],
    register: { ...sale.register!, taxes: [{ label: 'Sales Tax', percent: 3, amount: 0.9 }, { label: 'Sales Tax', percent: 7, amount: 1.66 }],
      tenders: [{ label: 'CASH', amount: 20, auth: '' }, { label: 'CREDIT-VISA', amount: 29.06, auth: '096837' }], change_due: 0 },
  }
  const html = renderRegisterEmailHtml(cash)
  expect(html).toContain('Discount: ($10.00)')
  expect(html).toContain('color:#2e9e3a')
  expect(html).toContain('Sales Tax (3%):')
  expect(html).toContain('Sales Tax (7%):')
  expect(html).toContain('Paid with CASH:')
  expect(html).toContain('Paid with CREDIT-VISA (Auth: 096837):')
  expect(html).toContain('Cash Change:')
})

test('a sample without register details is derived from the rest, so every sample previews', () => {
  const derived = registerDetails(DEFAULT_SAMPLE_TRANSACTION)
  expect(derived.trans_number).toBe(DEFAULT_SAMPLE_TRANSACTION.receipt_id)
  expect(derived.item_count).toBe(DEFAULT_SAMPLE_TRANSACTION.line_items.reduce((sum, item) => sum + Math.abs(item.quantity), 0))
  expect(derived.taxes).toEqual([{ label: 'Sales Tax', percent: null, amount: DEFAULT_SAMPLE_TRANSACTION.tax }])
  expect(renderRegisterEmailHtml(DEFAULT_SAMPLE_TRANSACTION)).toContain('YOUR RECEIPT')
})

test('the preset reaches the renderer and the combined email; the sections layouts are untouched', () => {
  const sections = defaultSectionsFor('STANDARD')
  expect(renderReceiptEmailHtml(sections, sale, 'REGISTER')).toContain('data-layout="register"')
  expect(renderReceiptEmailHtml(sections, sale)).not.toContain('data-layout="register"')
  const outer = '<html><head></head><body><!-- CEP:RECEIPT_SLOT_START --><!-- CEP:RECEIPT_SLOT_END --></body></html>'
  expect(combineReceiptEmail(outer, sections, sale, 'REGISTER')).toContain('YOUR RECEIPT')
  expect(PRESET_CARDS.map((card) => card.value)).toEqual(['COMPACT', 'STANDARD', 'ITEMIZED', 'REGISTER', 'CUSTOM_HTML'])
})
