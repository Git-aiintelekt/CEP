import { expect, test } from 'vitest'

import { combineLayoutEmail } from './receiptCombined'
import { renderItemRows, renderLayoutEmailHtml, renderRegisterEmailHtml } from './receiptEmailHtml'
import { REGISTER_SAMPLES } from './registerSamples'
import { FOLD_RULE, NARROW_CLASS, WIDE_CLASS, defaultRegisterSettings } from './registerSettings'
import type { RegisterSettings } from '@/lib/types'

const busy = REGISTER_SAMPLES.find((entry) => entry.key === 'busy-sale')!.data
const five: RegisterSettings['columns'] = [
  { key: 'description', label: 'Item' }, { key: 'size', label: 'Size' }, { key: 'color', label: 'Colour' }, { key: 'quantity', label: 'Qty' }, { key: 'amount', label: 'Price' },
]

test('five columns: renamed headers, a cell per line, the sum across them all, and the fold for phones', () => {
  const html = renderRegisterEmailHtml(busy, { ...defaultRegisterSettings(), columns: five })
  for (const label of ['Item', 'Size', 'Colour', 'Qty', 'Price']) expect(html).toContain(`>${label}</td>`)
  expect(html.split(`class="${WIDE_CLASS}"`).length - 1).toBe(3 * busy.line_items.length + 3)
  expect(html).toContain('colspan="5"')
  expect(html.startsWith(`<style>${FOLD_RULE}</style>`)).toBe(true)
  expect(html).toContain(`<div class="${NARROW_CLASS}" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Size L · Colour Black · Qty 2</div>`)
})

test('Keep Every Column writes no phone rule; hidden fields, title and footer follow the settings', () => {
  const html = renderRegisterEmailHtml(busy, {
    ...defaultRegisterSettings(), columns: five, phone: 'KEEP', title: 'Thanks <3',
    fields: defaultRegisterSettings().fields.map((field) => (field.key === 'cashier' ? { ...field, visible: false } : field)),
    footer_text: 'Returns within 30 days.\nCall {{store_phone}}.', footer_align: 'LEFT',
  })
  expect(html).not.toContain(FOLD_RULE)
  expect(html).not.toContain(NARROW_CLASS)
  expect(html).toContain('Thanks &lt;3')
  expect(html).not.toContain('Cashier:')
  expect(html).toContain('Returns within 30 days.<br />Call {{store_phone}}.')
  expect(html).toContain('text-align:left;')
})

test('the Item Row repeats per line with its tags filled and escaped; Custom HTML previews as it is sent', () => {
  const row = '<tr><td>{{item.description}}</td><td>{{ item.size }}</td><td>{{item.amount}}</td><td>{{item.nope}}</td></tr>'
  const rows = renderItemRows(row, { ...busy, line_items: [{ ...busy.line_items[0], description: '<b>Tee</b>' }] })
  expect(rows).toBe('<tr><td>&lt;b&gt;Tee&lt;/b&gt;</td><td>L</td><td>$19.98</td><td></td></tr>')
  const html = renderLayoutEmailHtml({ layout_preset: 'CUSTOM_HTML', sections: [], custom_html: '<table>{{receipt_items}}</table>', custom_css: 'td{color:red}', item_row: row }, busy)
  expect(html.startsWith('<style>td{color:red}</style><table><tr>')).toBe(true)
  expect(html.split('<tr>').length - 1).toBe(busy.line_items.length)
})

test('the combined email carries the phone rule in its head too', () => {
  const outer = '<html><head></head><body><!-- CEP:RECEIPT_SLOT_START --><!-- CEP:RECEIPT_SLOT_END --></body></html>'
  const folded = combineLayoutEmail(outer, { layout_preset: 'REGISTER', sections: [], register: { ...defaultRegisterSettings(), columns: five } }, busy)
  expect(folded.indexOf(FOLD_RULE)).toBeLessThan(folded.indexOf('</head>'))
  const plain = combineLayoutEmail(outer, { layout_preset: 'REGISTER', sections: [], register: null }, busy)
  expect(plain).not.toContain(FOLD_RULE)
})
