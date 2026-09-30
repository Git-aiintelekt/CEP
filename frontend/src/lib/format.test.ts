import { describe, expect, test } from 'vitest'

import { formatClock, formatCompactMoney, formatMoney, formatPercent, formatPercentChange, formatPointChange, formatShortDay, formatUtcClock, greetingFor, titleCase, titleize, zoneAbbreviation } from './format'

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

describe('Home formats', () => {
  test('compact money: whole dollars under a thousand, K with one decimal, M with two; null is a dash', () => {
    expect(formatCompactMoney(0)).toBe('$0')
    expect(formatCompactMoney(874)).toBe('$874')
    expect(formatCompactMoney(999)).toBe('$999')
    expect(formatCompactMoney(1000)).toBe('$1.0K')
    expect(formatCompactMoney(312_800)).toBe('$312.8K')
    expect(formatCompactMoney(999_960)).toBe('$1.00M')
    expect(formatCompactMoney(1_390_000)).toBe('$1.39M')
    expect(formatCompactMoney(-1_250)).toBe('-$1.3K')
    expect(formatCompactMoney(null)).toBe('—')
    expect(formatCompactMoney(undefined)).toBe('—')
  })

  test('percentages and changes use one decimal and a true minus sign', () => {
    expect(formatPercent(38.44)).toBe('38.4%')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(12.345, 2)).toBe('12.35%')
    expect(formatPercent(null)).toBe('—')
    expect(formatPercentChange(6.2)).toBe('+6.2%')
    expect(formatPercentChange(-12.4)).toBe('−12.4%')
    expect(formatPercentChange(0)).toBe('0.0%')
    expect(formatPercentChange(null)).toBe('—')
    expect(formatPointChange(1.1)).toBe('+1.1 pt')
    expect(formatPointChange(-0.3)).toBe('−0.3 pt')
    expect(formatPointChange(undefined)).toBe('—')
  })

  test('days, clocks and zone names are the workspace zone’s', () => {
    expect(formatShortDay('2026-09-26')).toBe('26 Sep')
    expect(formatClock('2026-09-26T18:00:00Z', 'America/New_York')).toBe('14:00')
    expect(formatClock('2026-09-26T18:00:00Z', 'Asia/Kolkata')).toBe('23:30')
    expect(formatClock(null, 'UTC')).toBe('—')
    expect(zoneAbbreviation('America/New_York', new Date('2026-09-26T12:00:00Z'))).toBe('EDT')
    expect(zoneAbbreviation('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe('EST')
  })

  test('the greeting follows the workspace clock, not UTC', () => {
    const at = (utc: string) => greetingFor(new Date(utc), 'America/New_York') // EDT, UTC−4
    expect(at('2026-09-26T08:59:00Z')).toBe('Good evening') // 04:59
    expect(at('2026-09-26T09:00:00Z')).toBe('Good morning') // 05:00
    expect(at('2026-09-26T15:59:00Z')).toBe('Good morning') // 11:59
    expect(at('2026-09-26T16:00:00Z')).toBe('Good afternoon') // 12:00
    expect(at('2026-09-26T20:59:00Z')).toBe('Good afternoon') // 16:59
    expect(at('2026-09-26T21:00:00Z')).toBe('Good evening') // 17:00
  })
})
