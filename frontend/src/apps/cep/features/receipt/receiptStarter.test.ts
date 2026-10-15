import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { hasReceiptFooter } from '@/apps/cep/features/designer/blocks/receiptBlocks'
import { RECEIPT_SLOT_CSS_CLASS } from '@/apps/cep/features/designer/blocks/receiptSlot'

import { RECEIPT_STARTER_MJML } from './receiptStarter'

test('the starter is one MJML document with the receipt slot and no unsubscribe footer', () => {
  expect(RECEIPT_STARTER_MJML.startsWith('<mjml>')).toBe(true)
  expect(RECEIPT_STARTER_MJML.endsWith('</mjml>')).toBe(true)
  expect(RECEIPT_STARTER_MJML).toContain(`css-class="${RECEIPT_SLOT_CSS_CLASS}"`)
  expect(RECEIPT_STARTER_MJML).not.toContain('cep-footer')
  expect(RECEIPT_STARTER_MJML).not.toMatch(/unsubscribe/i)
})

test('it is built from the receipt blocks, in order: header, marketing, slot, button, footer', () => {
  const order = ['cep-receipt-brand-header', 'cep-marketing', RECEIPT_SLOT_CSS_CLASS, 'cep-receipt-button', 'cep-receipt-footer'].map((name) =>
    RECEIPT_STARTER_MJML.indexOf(`css-class="${name}`),
  )
  expect(order.every((at) => at >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  expect(RECEIPT_STARTER_MJML).toContain('{{first_name}}')
  expect(hasReceiptFooter(RECEIPT_STARTER_MJML)).toBe(true)
})

test('it compiles cleanly, slot markup included', () => {
  const { html, errors } = mjml2html(RECEIPT_STARTER_MJML, { validationLevel: 'soft' })
  expect(errors).toEqual([])
  expect(html).toContain('Receipt content injects here')
})
