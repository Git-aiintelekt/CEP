import { expect, test } from 'vitest'

import { formatMoney, formatUtcClock, titleCase, titleize } from './format'

test('a save time reads as a 24-hour clock in UTC, whatever the reader’s own zone', () => {
  expect(formatUtcClock('2026-09-22T04:12:00Z')).toBe('04:12 UTC')
  // 23:05 in India is 17:35 UTC: the offset is resolved, never printed as GMT+5:30
  expect(formatUtcClock('2026-09-22T23:05:00+05:30')).toBe('17:35 UTC')
  expect(formatUtcClock('2026-09-22T00:00:00Z')).toBe('00:00 UTC')
})

test('nothing to show when there is no time, or it is not one', () => {
  expect(formatUtcClock(null)).toBeNull()
  expect(formatUtcClock('')).toBeNull()
  expect(formatUtcClock('not a date')).toBeNull()
})

test('money is "$" in every locale, with cents unless asked for whole dollars', () => {
  expect(formatMoney('25000.00')).toBe('$25,000.00')
  expect(formatMoney(18240, { whole: true })).toBe('$18,240')
  expect(formatMoney(null)).toBe('—')
  expect((25000).toLocaleString('en-GB', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' })).toBe('$25,000.00')   // what formatMoney asks of a British browser
})

test('titleCase and titleize: labels in title case, small words lowercase inside, hyphenated words on both halves', () => {
  expect(titleCase('add list to leave out')).toBe('Add List to Leave Out')
  expect(titleCase('from an audience or a clone')).toBe('From an Audience or a Clone')
  expect(titleCase('test & publish')).toBe('Test & Publish')
  expect(titleCase('what it is for')).toBe('What It Is For')
  expect(titleCase('auto-attached')).toBe('Auto-Attached')
  expect(titleCase('choose from library')).toBe('Choose from Library')
  expect(titleCase('pay with a card')).toBe('Pay with a Card')
  expect(titleCase('over frequency limit')).toBe('Over Frequency Limit')                      // first word
  expect(titleize('ONE_TIME')).toBe('One Time')
  expect(titleize('RECURRING_INSTANCE')).toBe('Recurring Instance')
  expect(titleize(null)).toBe('—')
})
