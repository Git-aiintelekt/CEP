import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { RECEIPT_SLOT_MARKER_END, RECEIPT_SLOT_MARKER_START } from '@/features/designer/blocks/receiptSlot'
import { STARTER_MJML } from '@/features/designer/starter'

import { designHasFooter } from './receiptChecks'
import { COMPILE_FAILED, EMPTY_DESIGN, NOT_READY, combineReceiptEmail, combinedFor, compileOuter, withHeadStyle } from './receiptCombined'
import { RECEIPT_HIDE_MOBILE_STYLE } from './receiptEmailHtml'
import { defaultSectionsFor } from './receiptPresets'
import { RECEIPT_STARTER_MJML } from './receiptStarter'
import { DEFAULT_SAMPLE_TRANSACTION } from './sampleReceiptData'

const compiler = (mjml: string, compile: () => { html: string; errors: string[] }) => ({ getMjml: () => mjml, compileHtml: compile })

test('the phone rule goes just before </head>, and a document with no head is left alone', () => {
  expect(withHeadStyle('<html><head><title>t</title></head><body></body></html>', 'a{}')).toBe('<html><head><title>t</title><style>a{}</style></head><body></body></html>')
  expect(withHeadStyle('<html><HEAD></HEAD></html>', 'a{}')).toBe('<html><HEAD><style>a{}</style></HEAD></html>')
  expect(withHeadStyle('<table></table>', 'a{}')).toBe('<table></table>')
})

test('the combined email is the compiled outer design, with its rule in the head and the receipt in the slot', () => {
  const { html: outer } = mjml2html(RECEIPT_STARTER_MJML, { validationLevel: 'soft' })
  const email = combineReceiptEmail(outer, defaultSectionsFor('STANDARD'), DEFAULT_SAMPLE_TRANSACTION)

  const head = email.slice(0, email.search(/<\/head>/i))
  expect(head.endsWith(`<style>${RECEIPT_HIDE_MOBILE_STYLE}</style>`)).toBe(true)
  const slot = email.slice(email.indexOf(RECEIPT_SLOT_MARKER_START), email.indexOf(RECEIPT_SLOT_MARKER_END))
  expect(slot).toContain('data-section="totals"')
  expect(email).not.toContain('Receipt content injects here')
})

test('an editor not ready, an empty design and a failed compile each say so instead of showing an email', () => {
  expect(compileOuter(null)).toMatchObject({ ready: false, message: expect.stringContaining(NOT_READY) })
  expect(compileOuter(compiler('<mjml><mj-body></mj-body></mjml>', () => ({ html: 'x', errors: [] })))).toMatchObject({ message: expect.stringContaining(EMPTY_DESIGN) })

  const failed = compileOuter(compiler(RECEIPT_STARTER_MJML, () => ({ html: '<html>half</html>', errors: ['Line 3: mj-text cannot be used inside mj-body'] })))
  expect(failed).toMatchObject({ ready: false, message: expect.stringContaining(COMPILE_FAILED) })
  expect(failed.ready ? '' : failed.message).toContain('mj-text cannot be used inside mj-body')
  expect(failed.ready ? '' : failed.message).not.toContain('half')

  const threw = compileOuter(compiler(RECEIPT_STARTER_MJML, () => { throw new Error('boom') }))
  expect(threw.ready ? '' : threw.message).toContain('boom')
})

test('a ready outer design is filled for each sample; a message is shown as it is', () => {
  const ready = compileOuter(compiler(RECEIPT_STARTER_MJML, () => ({ html: `<head></head>${RECEIPT_SLOT_MARKER_START}x${RECEIPT_SLOT_MARKER_END}`, errors: [] })))
  expect(combinedFor(ready, defaultSectionsFor('STANDARD'), DEFAULT_SAMPLE_TRANSACTION)).toContain('$144.11')
  const notReady = compileOuter(null)
  expect(combinedFor(notReady, defaultSectionsFor('STANDARD'), DEFAULT_SAMPLE_TRANSACTION)).toBe(notReady.ready ? '' : notReady.message)
})

test('either footer counts as the sender address; a design without one does not', () => {
  expect(designHasFooter(RECEIPT_STARTER_MJML)).toBe(true)
  expect(designHasFooter(STARTER_MJML)).toBe(true)
  expect(designHasFooter(RECEIPT_STARTER_MJML.replace(/<mj-section css-class="cep-receipt-footer"[\s\S]*?<\/mj-section>/, ''))).toBe(false)
  expect(designHasFooter('<mj-section css-class="cep-footerish"></mj-section>')).toBe(false)
})
