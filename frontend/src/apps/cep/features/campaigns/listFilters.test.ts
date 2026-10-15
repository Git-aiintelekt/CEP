import { expect, test } from 'vitest'

import { rangeDates, todayIn } from './listFilters'
import { timeInZone } from './zone'

// 02:30 UTC on 1 October is still 30 September in New York
const now = new Date('2026-10-01T02:30:00Z')

test('the Date created presets count calendar days in the workspace time zone, today included', () => {
  expect(todayIn('America/New_York', now)).toBe('2026-09-30')
  expect(todayIn('UTC', now)).toBe('2026-10-01')
  expect(rangeDates('last7', 'America/New_York', now)).toEqual({ date_from: '2026-09-24', date_to: '2026-09-30' })
  expect(rangeDates('last30', 'America/New_York', now)).toEqual({ date_from: '2026-09-01', date_to: '2026-09-30' })
  expect(rangeDates('quarter', 'America/New_York', now)).toEqual({ date_from: '2026-07-01', date_to: '2026-09-30' })
  expect(rangeDates('quarter', 'UTC', now)).toEqual({ date_from: '2026-10-01', date_to: '2026-10-01' })
  expect(rangeDates('', 'UTC', now)).toEqual({ date_from: '', date_to: '' })
  expect(rangeDates('last7', 'UTC', new Date('2026-03-03T12:00:00Z'))).toEqual({ date_from: '2026-02-25', date_to: '2026-03-03' })   // across a month end
})

test('the upcoming cards read the time with the short zone name; an unknown zone falls back to UTC', () => {
  const at = '2026-09-24T13:39:00Z'
  const clock = (zone: string) => new Intl.DateTimeFormat(undefined, { timeZone: zone, timeStyle: 'short' }).format(new Date(at))
  expect(timeInZone(at, 'America/New_York')).toBe(`${clock('America/New_York')} EDT`)
  expect(timeInZone('2026-12-24T14:39:00Z', 'America/Chicago')).toMatch(/ CST$/)
  expect(timeInZone(at, 'Mars/Olympus')).toBe(`${clock('UTC')} UTC`)
  expect(timeInZone(null, 'UTC')).toBe('—')
})
