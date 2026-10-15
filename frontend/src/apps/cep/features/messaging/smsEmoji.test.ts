/** What an emoji costs in a text: the helpers behind the editor's note. */
import { expect, test } from 'vitest'

import { isEmoji, plainSegments, smsMetrics } from './sms'

test('an emoji is told apart from a curly quote or a plain letter', () => {
  expect(['💳', '✅', '💙'].every(isEmoji)).toBe(true)
  expect(['’', '–', 'a', ' '].some(isEmoji)).toBe(false)
})

test('the parts the same text would take in the standard alphabet, so the note can say what the emoji cost', () => {
  const short = 'Payment received 💳 Reply STOP to opt out.'
  expect(smsMetrics(short).segments).toBe(1)
  expect(plainSegments(short)).toBe(1)
  const long = `Payment received 💳 ${'Thank you for shopping with Northwind. '.repeat(3)}Reply STOP to opt out.`
  expect(smsMetrics(long).segments).toBe(3)                                     // 70-character parts
  expect(plainSegments(long)).toBe(1)                                           // the same words fit one 160-character part
  expect(plainSegments('')).toBe(0)
  expect(plainSegments('€'.repeat(160))).toBe(3)                                 // an extended character costs two in the standard alphabet
})
