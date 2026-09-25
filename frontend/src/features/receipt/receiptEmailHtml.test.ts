import { expect, test } from 'vitest'

import { HIDE_MOBILE_CLASS, HIDE_MOBILE_RULE } from '@/features/designer/blocks/register'
import type { ReceiptSection } from '@/lib/types'

import { defaultSectionsFor } from './receiptPresets'
import { RECEIPT_HIDE_MOBILE_STYLE, renderReceiptEmailHtml } from './receiptEmailHtml'
import { DEFAULT_SAMPLE_TRANSACTION, SAMPLE_TRANSACTIONS, type SampleTransaction } from './sampleReceiptData'

const patch = (key: string, over: Record<string, unknown>) => (sections: ReceiptSection[]) =>
  sections.map((section) => (section.key === key ? ({ ...section, ...over } as ReceiptSection) : section))
const html = (sections = defaultSectionsFor('STANDARD'), transaction: SampleTransaction = DEFAULT_SAMPLE_TRANSACTION) =>
  renderReceiptEmailHtml(sections, transaction)
const shown = (out: string) => [...out.matchAll(/data-section="([a-z_]+)"/g)].map((match) => match[1])
/** One section's cell, parsed, for questions about its contents. */
/** Text as a reader sees it: the template's line breaks and indentation collapsed away. */
const words = (node: HTMLElement | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

function section(out: string, key: string): HTMLElement | null {
  const doc = new DOMParser().parseFromString(out, 'text/html')
  return doc.querySelector(`[data-section="${key}"]`)
}
const sample = (id: string) => SAMPLE_TRANSACTIONS.find((item) => item.id === id)?.data as SampleTransaction

test('sections render in order, visible ones only', () => {
  expect(shown(html())).toEqual(['header', 'customer_fulfillment', 'items', 'totals', 'payment', 'loyalty', 'support'])
  expect(shown(html(patch('payment', { visible: false })(defaultSectionsFor('STANDARD'))))).not.toContain('payment')
  expect(shown(html(defaultSectionsFor('COMPACT')))).toEqual(['header', 'items', 'totals', 'payment'])
})

test('the order follows the sections, not a fixed list', () => {
  const moved = defaultSectionsFor('STANDARD').map((item) => ({ ...item, order: item.key === 'support' ? -1 : item.order }))
  expect(shown(html(moved))[0]).toBe('support')
})

test('a locked section renders even if told not to', () => {
  expect(shown(html(patch('totals', { visible: false })(defaultSectionsFor('STANDARD'))))).toContain('totals')
})

test('columns switched off are left out, and the SKU is a line under the item', () => {
  const out = html(patch('items', { columns: { product_image: false, sku: true, quantity: false, unit_price: false, amount: true } })(defaultSectionsFor('STANDARD')))
  const items = section(out, 'items')?.textContent ?? ''
  expect(items).not.toContain('Qty')
  expect(items).not.toContain('Unit price')
  expect(items).toContain('NL-SW-2041')
  expect(out).not.toContain(`class="${HIDE_MOBILE_CLASS}"`)
})

test('the image column carries the hide-on-phones class, and the fragment carries its rule', () => {
  const out = html(patch('items', { columns: { product_image: true, sku: false, quantity: true, unit_price: true, amount: true } })(defaultSectionsFor('STANDARD')))
  const cells = section(out, 'items')?.querySelectorAll(`td.${HIDE_MOBILE_CLASS}`) ?? []
  expect(cells).toHaveLength(1 + DEFAULT_SAMPLE_TRANSACTION.line_items.length)
  expect(out.startsWith(`<style>${HIDE_MOBILE_RULE}</style>`)).toBe(true)
  expect(HIDE_MOBILE_RULE).toContain('max-width:480px')
})

test('shipping is never listed on a POS sale, whatever its switch says', () => {
  const itemized = defaultSectionsFor('ITEMIZED')
  expect(section(html(itemized), 'totals')?.textContent).toContain('Shipping')
  expect(section(html(itemized, { ...DEFAULT_SAMPLE_TRANSACTION, source: 'POS' }), 'totals')?.textContent).not.toContain('Shipping')
})

test('loyalty is left out entirely for a customer who is not enrolled', () => {
  const out = html(defaultSectionsFor('STANDARD'), { ...DEFAULT_SAMPLE_TRANSACTION, loyalty: null })
  expect(shown(out)).not.toContain('loyalty')
  expect(out).not.toContain('Points')
})

test('negative money carries a true minus; zero carries none', () => {
  const refund = section(html(defaultSectionsFor('STANDARD'), sample('refund-r1187')), 'totals')?.textContent ?? ''
  expect(refund).toContain('−$96.12')
  expect(refund).not.toMatch(/-\$/)

  const exchange = words(section(html(defaultSectionsFor('STANDARD'), sample('exchange-pos3352')), 'totals'))
  expect(exchange).toContain('Total $0.00')
  expect(exchange).not.toContain('−$0.00')
})

test('the dashed rule sits on Totals, directly after the section before it, and nowhere else', () => {
  const out = html()
  expect(out.match(/1px dashed/g)).toHaveLength(1)
  expect(out).toMatch(/<\/td><\/tr>\s*<tr><td data-section="totals" style="[^"]*border-top:1px dashed #9ea2ad;/)
  // the return barcode's own dashed box is the only other dashed border, and it is off by default
  const withBarcode = html(patch('support', { barcode: true })(defaultSectionsFor('STANDARD')))
  expect(withBarcode.match(/border-top:1px dashed/g)).toHaveLength(1)
})

test('the return barcode is a Code 128 image served by the API, named after the receipt number, with the number under it', () => {
  const withBarcode = html(patch('support', { barcode: true })(defaultSectionsFor('STANDARD')))
  const image = withBarcode.match(/<img src="([^"]+)" alt="Barcode ([^"]+)" width="240" height="64"/)
  expect(image?.[1]).toMatch(/\/api\/v1\/public\/barcode\/RCT-48219-0922\.png$/)
  expect(image?.[1]).toMatch(/^https?:\/\//)                                                          // absolute: the email has no base
  expect(image?.[2]).toBe('RCT-48219-0922')
  expect(html()).not.toContain('/public/barcode/')                                                    // off by default
})

test('no class carries layout or colour; the one class is the hide-on-phones hook', () => {
  const everything = html(defaultSectionsFor('ITEMIZED').map((item) => (item.key === 'items' ? { ...item, columns: { ...item.columns, product_image: true } } : item)) as ReceiptSection[])
  const classes = new Set([...everything.matchAll(/class="([^"]*)"/g)].map((match) => match[1]))
  expect([...classes]).toEqual([HIDE_MOBILE_CLASS])
  expect(everything).not.toMatch(/display:\s*(flex|grid)/)
})

test('money is right-aligned in tabular figures', () => {
  const total = section(html(), 'totals')?.querySelector('td[align="right"]') as HTMLElement
  expect(total.getAttribute('style')).toContain('font-variant-numeric:tabular-nums')
  expect(total.getAttribute('style')).toContain('text-align:right')
})

test('the savings note uses the callout colours the screen uses', () => {
  const out = html()
  expect(words(section(out, 'totals'))).toContain('You saved $15.00 with FALL15.')
  expect(out).toContain('background-color:#eef2fe')
  expect(out).toContain('color:#312e7c')
  expect(out).not.toContain('#dee9fc')
})

test('the hide-on-phones rule is exported for the combined email\'s head, and still carried inline', () => {
  expect(RECEIPT_HIDE_MOBILE_STYLE).toBe(HIDE_MOBILE_RULE)
  expect(RECEIPT_HIDE_MOBILE_STYLE).toContain(`.${HIDE_MOBILE_CLASS}`)
  expect(html()).toContain(`<style>${RECEIPT_HIDE_MOBILE_STYLE}</style>`)
})

test('author text and record values are escaped', () => {
  const out = html(patch('support', { policy_text: '<script>alert(1)</script> & "more"\nline two' })(defaultSectionsFor('STANDARD')), {
    ...DEFAULT_SAMPLE_TRANSACTION, store: 'Fish & <Chips>',
  })
  expect(out).not.toContain('<script>')
  expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;<br />line two')
  expect(out).toContain('Fish &amp; &lt;Chips&gt;')
})

test('every sample renders to balanced tables', () => {
  for (const { id, data } of SAMPLE_TRANSACTIONS) {
    const out = html(defaultSectionsFor('ITEMIZED'), data)
    for (const tag of ['table', 'tr', 'td']) {
      expect((out.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length, `${id} <${tag}>`).toBe((out.match(new RegExp(`</${tag}>`, 'g')) ?? []).length)
    }
  }
})
