import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { RECEIPT_SLOT_MARKER_END, RECEIPT_SLOT_MARKER_START, RECEIPT_SLOT_MJML } from '@/apps/cep/features/designer/blocks/receiptSlot'

import { injectReceiptIntoOuterHtml } from './injectReceipt'
import { defaultSectionsFor } from './receiptPresets'
import { renderReceiptEmailHtml } from './receiptEmailHtml'
import { RECEIPT_STARTER_MJML } from './receiptStarter'
import { DEFAULT_SAMPLE_TRANSACTION } from './sampleReceiptData'

const OUTER = `<html><body><div class="brand">Brand</div>${RECEIPT_SLOT_MARKER_START}<table><tr><td>Receipt content injects here</td></tr></table>${RECEIPT_SLOT_MARKER_END}<p>Footer</p></body></html>`

test('the receipt goes between the markers, replacing the placeholder, and the markers stay', () => {
  const out = injectReceiptIntoOuterHtml(OUTER, '<table><tr><td>RECEIPT</td></tr></table>')
  expect(out).not.toContain('Receipt content injects here')
  expect(out).toBe(
    `<html><body><div class="brand">Brand</div>${RECEIPT_SLOT_MARKER_START}\n<table><tr><td>RECEIPT</td></tr></table>\n${RECEIPT_SLOT_MARKER_END}<p>Footer</p></body></html>`,
  )
})

test('a design without the slot comes back exactly as it was', () => {
  const html = '<html><body><p>No slot here</p></body></html>'
  expect(injectReceiptIntoOuterHtml(html, '<p>RECEIPT</p>')).toBe(html)
  expect(injectReceiptIntoOuterHtml(`<p>${RECEIPT_SLOT_MARKER_START} but no end</p>`, 'x')).toBe(`<p>${RECEIPT_SLOT_MARKER_START} but no end</p>`)
})

test('dollar amounts in the receipt arrive as written, not read as replacement patterns', () => {
  const receipt = '<td>Total $144.11 $& $1 $$</td>'
  expect(injectReceiptIntoOuterHtml(OUTER, receipt)).toContain(receipt)
})

test('markers re-spaced by a formatter are still found', () => {
  const spaced = '<div>a</div><!--   CEP:RECEIPT_SLOT_START\n  --><p>old</p><!--CEP:RECEIPT_SLOT_END--><div>b</div>'
  expect(injectReceiptIntoOuterHtml(spaced, '<p>new</p>')).toBe('<div>a</div><!--   CEP:RECEIPT_SLOT_START\n  -->\n<p>new</p>\n<!--CEP:RECEIPT_SLOT_END--><div>b</div>')
})

test('filling twice replaces the first fill instead of adding to it', () => {
  const once = injectReceiptIntoOuterHtml(OUTER, '<p>first</p>')
  const twice = injectReceiptIntoOuterHtml(once, '<p>second</p>')
  expect(twice).toContain('<p>second</p>')
  expect(twice).not.toContain('<p>first</p>')
})

test('every slot a design carries is filled', () => {
  const two = `${OUTER}${OUTER}`
  const out = injectReceiptIntoOuterHtml(two, '<p>R</p>')
  expect(out.match(/<p>R<\/p>/g)).toHaveLength(2)
  expect(out).not.toContain('Receipt content injects here')
})

test('the markers survive the real MJML compiler, and the receipt lands where the placeholder was', () => {
  const { html: outer, errors } = mjml2html(RECEIPT_STARTER_MJML, { validationLevel: 'soft' })
  expect(errors).toEqual([])
  expect(outer).toContain(RECEIPT_SLOT_MARKER_START)
  expect(outer).toContain(RECEIPT_SLOT_MARKER_END)
  expect(outer).toContain('Receipt content injects here')

  const receipt = renderReceiptEmailHtml(defaultSectionsFor('STANDARD'), DEFAULT_SAMPLE_TRANSACTION)
  const combined = injectReceiptIntoOuterHtml(outer, receipt)
  expect(combined).not.toContain('Receipt content injects here')

  const between = combined.slice(combined.indexOf(RECEIPT_SLOT_MARKER_START), combined.indexOf(RECEIPT_SLOT_MARKER_END))
  expect(between).toContain('Merino crew sweater, navy, M')
  expect(between).toContain('$144.11')

  // what was around the slot is untouched: the brand header before, the footer's transactional line after
  expect(combined.slice(0, combined.indexOf(RECEIPT_SLOT_MARKER_START))).toBe(outer.slice(0, outer.indexOf(RECEIPT_SLOT_MARKER_START)))
  expect(combined.slice(combined.indexOf(RECEIPT_SLOT_MARKER_END))).toBe(outer.slice(outer.indexOf(RECEIPT_SLOT_MARKER_END)))
  expect(combined).toContain('This is a transactional receipt for a purchase you made.')

  // well formed: the browser's parser keeps the receipt's own tables whole, inside the email's body
  const doc = new DOMParser().parseFromString(combined, 'text/html')
  const receiptTable = [...doc.querySelectorAll('td[data-section="totals"]')]
  expect(receiptTable).toHaveLength(1)
  expect(doc.body.textContent).toContain('YOUR BRAND')
  for (const tag of ['table', 'tr', 'td']) {
    expect((combined.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length, tag).toBe((combined.match(new RegExp(`</${tag}>`, 'g')) ?? []).length)
  }
})

test('the slot MJML brackets its placeholder with the markers', () => {
  const start = RECEIPT_SLOT_MJML.indexOf(RECEIPT_SLOT_MARKER_START)
  const end = RECEIPT_SLOT_MJML.indexOf(RECEIPT_SLOT_MARKER_END)
  expect(start).toBeGreaterThan(RECEIPT_SLOT_MJML.indexOf('<mj-raw'))
  expect(RECEIPT_SLOT_MJML.slice(start, end)).toContain('Receipt content injects here')
  expect(end).toBeLessThan(RECEIPT_SLOT_MJML.indexOf('</mj-raw>'))
})
