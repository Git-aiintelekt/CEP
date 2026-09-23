import { expect, test } from 'vitest'

import type { CalendarSpan } from '@/lib/types'

import { dayOf, monthWeeks, placeSpans, shiftMonth } from './calendarMath'

const span = (name: string, start: string, end: string | null, ongoing = false): CalendarSpan => ({
  campaign: name, name, code: null, channel: 'EMAIL', campaign_type: 'REGULAR_MARKETING', display_status: 'ACTIVE', is_journey_generated: false, setup_step: 6, setup_complete: true,
  actions: [], timezone: 'UTC', start, end, ongoing, failed: false, sends: [],
})

test('a month is whole weeks, Monday first: August 2026 runs from Monday 27 July to Sunday 6 September', () => {
  const weeks = monthWeeks({ year: 2026, month: 7 })
  expect(weeks).toHaveLength(6)
  expect(weeks[0][0]).toBe('2026-07-27')
  expect(weeks[0][5]).toBe('2026-08-01')                                   // the 1st is a Saturday
  expect(weeks[5][6]).toBe('2026-09-06')
  expect(monthWeeks({ year: 2027, month: 1 })).toHaveLength(4)             // February 2027 starts on a Monday and has 28 days
  expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
  expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
})

test('a day is the workspace day: 02:00 UTC on the 21st is still the 20th in New York', () => {
  expect(dayOf('2026-08-21T02:00:00Z', 'America/New_York')).toBe('2026-08-20')
  expect(dayOf('2026-08-21T02:00:00Z', 'Asia/Kolkata')).toBe('2026-08-21')
  expect(dayOf('2026-08-21T02:00:00Z', 'Mars/Olympus')).toBe('2026-08-21')  // an unknown zone falls back to the date as written
})

test('bars keep a row for all their days, are cut to the grid, and one that goes on runs to its last day', () => {
  const weeks = monthWeeks({ year: 2026, month: 7 })
  const placed = placeSpans([
    span('Receipts', '2026-06-01T10:00:00Z', null, true),                  // started long before, goes on
    span('Series', '2026-08-18T10:00:00Z', '2026-08-25T10:00:00Z'),
    span('One day', '2026-08-20T10:00:00Z', '2026-08-20T10:05:00Z'),
    span('Early', '2026-08-03T10:00:00Z', '2026-08-04T10:00:00Z'),
    span('Last year', '2025-08-20T10:00:00Z', '2025-08-20T10:05:00Z'),
  ], weeks, 'UTC')
  const by = Object.fromEntries(placed.map((item) => [item.span.name, item]))
  expect(by['Last year']).toBeUndefined()
  expect(by.Receipts).toMatchObject({ from: '2026-07-27', to: '2026-09-06', lane: 0 })
  expect(by.Early).toMatchObject({ from: '2026-08-03', to: '2026-08-04', lane: 1 })
  expect(by.Series).toMatchObject({ lane: 1 })                              // the row Early left free
  expect(by['One day']).toMatchObject({ from: '2026-08-20', to: '2026-08-20', lane: 2 })
})
