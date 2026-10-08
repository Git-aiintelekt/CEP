import { describe, expect, test } from 'vitest'

import { isWaitConfigured, nextTimeOfDay, summarizeWait, waitProblem } from './WaitFields'

describe('the Wait step beyond a duration', () => {
  test('what each mode still needs, and when it counts as configured', () => {
    expect(waitProblem({ duration: '' })).toBeNull()
    expect(isWaitConfigured({ duration: '' })).toBe(false)
    expect(isWaitConfigured({ duration: 3, unit: 'DAYS' })).toBe(true)
    expect(waitProblem({ mode: 'TIME_OF_DAY', time: '9' })).toBe('Choose a time of day.')
    expect(isWaitConfigured({ mode: 'TIME_OF_DAY', time: '09:00' })).toBe(true)
    expect(waitProblem({ mode: 'DATE_ATTRIBUTE', time: '10:00' })).toBe('Choose which date on the customer’s record.')
    expect(waitProblem({ mode: 'DATE_ATTRIBUTE', time: '10:00', attribute: 'renewal_date', offset_days: 400 })).toContain('within 365')
    expect(isWaitConfigured({ mode: 'DATE_ATTRIBUTE', time: '10:00', attribute: 'renewal_date', offset_days: -3 })).toBe(true)
  })

  test("the card's line", () => {
    expect(summarizeWait({ duration: 1, unit: 'DAYS' })).toBe('Wait 1 day')
    expect(summarizeWait({ mode: 'TIME_OF_DAY', time: '09:00' })).toBe('Wait until 9:00 AM, their time')
    expect(summarizeWait({ mode: 'TIME_OF_DAY', time: '18:30', zone: 'WORKSPACE', weekdays: ['MON', 'FRI'] })).toBe('Wait until 6:30 PM on Mon, Fri, workspace time')
    expect(summarizeWait({ mode: 'DATE_ATTRIBUTE', time: '10:00', attribute: 'renewal_date', offset_days: -3 })).toBe('Wait until 3 days before Renewal Date, 10:00 AM')
    expect(summarizeWait({ mode: 'DATE_ATTRIBUTE', time: '10:00' })).toBe('No date set')
  })

  test('the next moment at a time of day in a zone, honouring weekdays', () => {
    const thursdayAfternoon = new Date('2026-10-08T19:10:00Z') // 14:10 in Chicago
    expect(nextTimeOfDay('09:00', [], 'America/Chicago', thursdayAfternoon)?.toISOString()).toBe('2026-10-09T14:00:00.000Z')
    expect(nextTimeOfDay('15:00', [], 'America/Chicago', thursdayAfternoon)?.toISOString()).toBe('2026-10-08T20:00:00.000Z')
    expect(nextTimeOfDay('09:00', ['MON'], 'America/Chicago', thursdayAfternoon)?.toISOString()).toBe('2026-10-12T14:00:00.000Z')
    expect(nextTimeOfDay('09:00', [], 'Mars/Olympus', thursdayAfternoon)).toBeNull()
  })
})
