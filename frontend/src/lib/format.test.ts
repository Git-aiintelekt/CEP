import { expect, test } from 'vitest'

import { formatUtcClock } from './format'

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
