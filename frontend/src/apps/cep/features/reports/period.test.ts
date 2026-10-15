import { expect, test } from 'vitest'

import { addDays, daysBetween, formatDay, percent, periodFor, todayIn } from './period'

// 02:30 UTC on 1 Oct is still 30 Sep in New York: the presets count days in the workspace's zone, not the browser's
const NOW = new Date('2026-10-01T02:30:00Z')

test('today is the workspace\'s today', () => {
  expect(todayIn('America/New_York', NOW)).toBe('2026-09-30')
  expect(todayIn('Asia/Kolkata', NOW)).toBe('2026-10-01')
  expect(todayIn('Not/AZone', NOW)).toBe('2026-10-01')                                                  // an unknown zone falls back to UTC
})

test('the presets: the last 7 days, this month so far, and the whole of last month', () => {
  expect(periodFor('week', 'America/New_York', NOW)).toEqual({ from: '2026-09-24', to: '2026-09-30' })
  expect(periodFor('month', 'America/New_York', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  expect(periodFor('last_month', 'America/New_York', NOW)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  expect(periodFor('last_month', 'Asia/Kolkata', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  expect(periodFor('last_month', 'UTC', new Date('2026-03-10T12:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
})

test('every day of a period, so a quiet day is a zero, capped at 366', () => {
  expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  expect(daysBetween('2026-01-01', '2027-12-31')).toHaveLength(366)
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
})

test('a day is written as the workspace\'s date, never shifted, and a rate with one decimal', () => {
  expect(formatDay('2026-09-01', { day: 'numeric', month: 'short', year: 'numeric' })).toMatch(/Sep/)
  expect(formatDay('2026-09-01', { day: 'numeric' })).toBe('1')
  expect(percent(41.83)).toBe('41.8%')
  expect(percent(null)).toBe('—')
})
