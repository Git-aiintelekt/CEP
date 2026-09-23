import { expect, test } from 'vitest'

import type { PersonalizationTag, ReceiptSection } from '@/lib/types'

import {
  complianceSectionsCheck, computeReceiptChecks, noUnsubscribeCheck, personalizationFallbackCheck, requiredFieldsCheck, senderAddressCheck,
  summarizeChecks,
} from './receiptChecks'
import { defaultSectionsFor } from './receiptPresets'
import { DEFAULT_SAMPLE_TRANSACTION, SAMPLE_TRANSACTIONS, type SampleTransaction } from './sampleReceiptData'

const tag = (tag_key: string, default_value: string | null): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['E_RECEIPT'], description: null,
  sample_value: 'Jordan', default_value, static_value: null, is_active: true,
})

const hide = (key: string) => (sections: ReceiptSection[]) => sections.map((section) => (section.key === key ? { ...section, visible: false } : section))

test('1. required fields: every built-in sample resolves', () => {
  for (const sample of SAMPLE_TRANSACTIONS) expect(requiredFieldsCheck(sample.data).status, sample.id).toBe('pass')
})

test('1. required fields: a missing total, line items or order number fails and names what is missing', () => {
  const noTotal = { ...DEFAULT_SAMPLE_TRANSACTION, total: undefined } as unknown as SampleTransaction
  expect(requiredFieldsCheck(noTotal)).toMatchObject({ status: 'fail', detail: expect.stringContaining('total') })

  const noLines = { ...DEFAULT_SAMPLE_TRANSACTION, line_items: [] }
  expect(requiredFieldsCheck(noLines)).toMatchObject({ status: 'fail', detail: expect.stringContaining('line items') })

  const nothing = { ...DEFAULT_SAMPLE_TRANSACTION, order_number: ' ', line_items: [], total: Number.NaN }
  expect(requiredFieldsCheck(nothing).detail).toBe('Missing from this transaction: order number, line items, total.')
})

test('2. compliance sections: passes with Totals and Payment on, fails when either is off in the data', () => {
  expect(complianceSectionsCheck(defaultSectionsFor('STANDARD')).status).toBe('pass')
  for (const key of ['totals', 'payment']) {
    const check = complianceSectionsCheck(hide(key)(defaultSectionsFor('STANDARD')))
    expect(check, key).toMatchObject({ status: 'fail', detail: 'Tax authorities in some regions require both on a receipt.' })
  }
  expect(complianceSectionsCheck(defaultSectionsFor('STANDARD').filter((section) => section.key !== 'payment')).status).toBe('fail')
  expect(complianceSectionsCheck(hide('loyalty')(defaultSectionsFor('STANDARD'))).status).toBe('pass')
})

test('3. sender address: follows whether the design has a footer', () => {
  expect(senderAddressCheck(true).status).toBe('pass')
  expect(senderAddressCheck(false)).toMatchObject({ status: 'fail', detail: 'Transactional mail must carry a postal address — add a Footer block.' })
})

test('4. personalization: names the fallback when there is one, fails when there is none', () => {
  expect(personalizationFallbackCheck([tag('first_name', 'there')])).toMatchObject({ status: 'pass', detail: 'FIRST NAME falls back to "there"' })
  expect(personalizationFallbackCheck([tag('first_name', 'friend')]).detail).toContain('"friend"')
  expect(personalizationFallbackCheck([tag('first_name', null)]).status).toBe('fail')
  expect(personalizationFallbackCheck([tag('first_name', '  ')]).status).toBe('fail')
  expect(personalizationFallbackCheck([tag('last_name', 'Customer')]).status).toBe('fail')
})

test('5. no unsubscribe: always passes, for a structural reason', () => {
  expect(noUnsubscribeCheck()).toEqual({
    id: 'no-unsubscribe', title: 'No unsubscribe needed', detail: 'Transactional class; suppression lists do not apply.', status: 'pass',
  })
})

test('all five come back in order, and the summary counts the failures', () => {
  const all = computeReceiptChecks({ transaction: DEFAULT_SAMPLE_TRANSACTION, sections: defaultSectionsFor('STANDARD'), hasFooterBlock: true, tags: [tag('first_name', 'there')] })
  expect(all.map((check) => check.title)).toEqual([
    'Required receipt fields resolve', 'Compliance sections present', 'Sender address present', 'Personalization has a fallback', 'No unsubscribe needed',
  ])
  expect(summarizeChecks(all)).toEqual({ total: 5, failing: 0 })

  const two = computeReceiptChecks({ transaction: DEFAULT_SAMPLE_TRANSACTION, sections: defaultSectionsFor('STANDARD'), hasFooterBlock: false, tags: [] })
  expect(summarizeChecks(two)).toEqual({ total: 5, failing: 2 })
})
