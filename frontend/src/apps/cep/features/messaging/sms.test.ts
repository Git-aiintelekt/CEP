import { expect, test } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { canBePlain, describeCharacter, OPT_OUT_PATTERN, plainChanges, plainPunctuation, renderWithSamples, smsMetrics } from './sms'

const tag = (tag_key: string, sample_value: string | null, default_value: string | null = null): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['SMS'], description: null,
  sample_value, default_value, static_value: null, is_active: true,
})

// Same table as the server test (test_message_api.py): the two calculators must agree.
test.each([
  ['', 'GSM-7', 0, 0],
  ['a'.repeat(160), 'GSM-7', 160, 1],
  ['a'.repeat(161), 'GSM-7', 161, 2],
  ['a'.repeat(306), 'GSM-7', 306, 2],
  ['a'.repeat(307), 'GSM-7', 307, 3],
  ['[10% off] {x}', 'GSM-7', 17, 1], // [ ] { } are extended: two each
  ['Café – “deal”', 'UCS-2', 13, 1], // é is GSM-7, the dash and curly quotes are not
  ['\u{1F600}'.repeat(35), 'UCS-2', 70, 1],
  ['\u{1F600}'.repeat(36), 'UCS-2', 72, 2],
])('smsMetrics(%j) -> %s, %i units, %i segments', (text, encoding, units, segments) => {
  const metrics = smsMetrics(text)
  expect([metrics.encoding, metrics.units, metrics.segments]).toEqual([encoding, units, segments])
})

test('remaining counts down to the next segment boundary and lists what forces UCS-2', () => {
  expect(smsMetrics('a'.repeat(150)).remaining).toBe(10)
  expect(smsMetrics('a'.repeat(161)).remaining).toBe(2 * 153 - 161)
  expect(smsMetrics('Hi “there” …').nonGsmCharacters).toEqual(['“', '”', '…'])
})

test('renderWithSamples fills sample then default values and leaves unknown tags visible', () => {
  const tags = [tag('first_name', 'Jordan'), tag('store', null, 'your store')]
  expect(renderWithSamples('Hi {{ first_name }}, visit {{store}} with {{mystery}}', tags)).toBe('Hi Jordan, visit your store with {{mystery}}')
})

test('plainPunctuation brings a pasted message back to GSM-7', () => {
  const pasted = 'It’s here – “20% off”…'
  expect(smsMetrics(pasted).encoding).toBe('UCS-2')
  expect(canBePlain(smsMetrics(pasted).nonGsmCharacters)).toBe(true)
  expect(plainPunctuation(pasted)).toBe('It\'s here - "20% off"...')
  expect(smsMetrics(plainPunctuation(pasted)).encoding).toBe('GSM-7')
  expect(canBePlain(['\u{1F600}'])).toBe(false) // an emoji has no plain twin: the writer decides
})

test('the Opt-Out Text tag counts as opt-out wording, as the server check does', () => {
  for (const body of ['Shop now {{opt_out_text}}', 'Shop now {{ opt_out_text }}', 'Shop now ${opt_out_text}', 'Reply STOP to opt out', 'Text UNSUBSCRIBE']) expect(OPT_OUT_PATTERN.test(body), body).toBe(true)
  for (const body of ['Shop {{shop_url}}', 'Use code {{offer_code}}']) expect(OPT_OUT_PATTERN.test(body), body).toBe(false)
})

test('curly quotes, long dashes, ellipses and the invisible characters from a pasted document become plain, and the text standard again', () => {
  const pasted = 'O\u2019Brien\u200b \u2014 it\u2019s here\u2026\u00a0\u201cnow\u201d\u00ad'
  expect(plainPunctuation(pasted)).toBe('O\'Brien - it\'s here... "now"')
  expect(plainChanges(pasted)).toBe(9)
  expect(smsMetrics(pasted).encoding).toBe('UCS-2')
  expect(smsMetrics(plainPunctuation(pasted)).encoding).toBe('GSM-7')
  expect(describeCharacter('\u200b')).toBe('zero-width space (U+200B)')
  expect(canBePlain(['\u2060'])).toBe(true)
})
