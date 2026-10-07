import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { addDays, todayIn } from '@/features/reports/period'
import type { Campaign } from '@/lib/types'
import { atZone } from '@/lib/zonedTime'
import { installMockApi, makeCampaign, signIn, makeStep } from '@/test/mockApi'

import { weekTitle } from './calendarView'

const ZONE = 'America/New_York'
const today = () => todayIn(ZONE)

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const runAt = (id: string, at: string, status = 'SCHEDULED', label: string | null = null) => ({
  id, campaign: 'x', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status, test_mode: false, scheduled_at: at, started_at: status === 'SCHEDULED' ? null : at,
  completed_at: null, created_at: at, updated_at: at, row_version: 1, sequence_label: label,
}) as Campaign['runs'][number]
const local = (offset: number, time: string) => atZone(addDays(today(), offset), time, ZONE)

function week(): Campaign[] {
  return [
    makeCampaign({ id: 'w1', name: 'Fall Launch', channel: 'EMAIL', status: 'PRODUCTION_PUBLISHED', setup_step: 6, runs: [
      runAt('r1', local(0, '00:05'), 'COMPLETED'),
      runAt('r2', local(2, '20:30')),                                                            // 00:30 UTC the day after: still day 2 in New York
      runAt('r3', local(2, '07:15')),
    ] }),
    makeCampaign({ id: 'w2', name: 'Welcome Series', channel: 'SMS', status: 'ACTIVE', is_journey_generated: true, runs: [
      runAt('r4', local(0, '12:00'), 'SCHEDULED', 'Step 1'), runAt('r5', local(1, '09:00'), 'SCHEDULED', 'Step 2'),
    ] }),
    makeCampaign({ id: 'w3', name: 'Broken Promo', channel: 'MMS', status: 'PRODUCTION_PUBLISHED', runs: [runAt('r6', local(1, '08:00'), 'FAILED')] }),
    makeCampaign({ id: 'w4', name: 'Hourly Deals', channel: 'EMAIL', status: 'PRODUCTION_PUBLISHED',
      runs: Array.from({ length: 10 }, (_, index) => runAt(`h${index}`, local(3, `${String(8 + index).padStart(2, '0')}:00`))) }),
  ]
}

const calendarCalls = (calls: { url: string }[]) => calls.filter((call) => call.url.includes('/campaigns/calendar/')).map((call) => new URL(call.url, 'http://x').searchParams)
const column = (offset: number) => document.querySelector(`[data-day="${addDays(today(), offset)}"]`) as HTMLElement
const blocks = (offset: number) => [...column(offset).querySelectorAll('a[data-send]')] as HTMLElement[]
const search = () => new URLSearchParams(window.location.search)

test('week titles: both dates with the year once, or both years across a new year', () => {
  expect(weekTitle('2026-09-30', '2026-10-06')).toBe('30 Sep – 6 Oct 2026')
  expect(weekTitle('2026-12-29', '2027-01-04')).toBe('29 Dec 2026 – 4 Jan 2027')
})

test('Month / Week is a radio group in the address; Back returns to the month; the week arrows move seven days and Today comes back', async () => {
  installMockApi({ campaigns: week() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?view=calendar')
  const calendar = await screen.findByRole('region', { name: 'Campaign calendar' })
  const modes = within(calendar).getByRole('radiogroup', { name: 'Calendar View' })
  expect(within(modes).getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true')
  expect(within(calendar).getByRole('switch', { name: 'Journey Runs' }).getAttribute('aria-checked')).toBe('true')

  await user.click(within(modes).getByRole('radio', { name: 'Week' }))
  expect(search().get('mode')).toBe('week')
  expect(search().get('start')).toBeNull()                                                             // today is the default
  expect(within(calendar).getByRole('heading', { level: 2 }).textContent).toBe(weekTitle(today(), addDays(today(), 6)))
  const todayButton = within(calendar).getByRole('button', { name: 'Today' }) as HTMLButtonElement
  expect(todayButton.disabled).toBe(true)

  await user.click(within(calendar).getByRole('button', { name: 'Next Week' }))
  expect(search().get('start')).toBe(addDays(today(), 7))
  expect(todayButton.disabled).toBe(false)
  await user.click(within(calendar).getByRole('button', { name: 'Previous Week' }))
  await user.click(within(calendar).getByRole('button', { name: 'Previous Week' }))
  expect(search().get('start')).toBe(addDays(today(), -7))
  await user.click(todayButton)
  expect(search().get('start')).toBeNull()

  window.history.go(-5)                                                                               // Today, two Previous, Next, then Week
  await vi.waitFor(() => expect(search().get('mode')).toBeNull())
  await waitFor(() => expect(within(modes).getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true'))    // the address changes before the router re-renders
})

test('the week: seven day columns from today, sends by time in their status colours, journey runs marked, Sent on past ones', async () => {
  const calls = installMockApi({ campaigns: week() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?view=calendar&mode=week&channel=EMAIL')
  await screen.findByRole('region', { name: 'Campaign calendar' })
  const request = calendarCalls(calls).at(-1)!
  expect([request.get('date_from'), request.get('date_to'), request.get('channel')]).toEqual([today(), addDays(today(), 6), 'EMAIL'])
  cleanup()

  installMockApi({ campaigns: week() })
  await renderAppAt('/campaigns?view=calendar&mode=week')
  await vi.waitFor(() => expect(blocks(0).length).toBeGreaterThan(0))
  expect(document.querySelectorAll('[data-calendar-week] section[data-day]')).toHaveLength(7)
  expect(column(0).getAttribute('aria-label')).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/)
  expect(column(0).querySelector('header')!.className).toContain('bg-brand-100')
  expect(screen.getByText(/^Times in E[DS]T$/)).toBeTruthy()

  expect(blocks(2).map((block) => block.querySelector('span')!.textContent)).toEqual(['07:15', '20:30'])        // bucketed in New York, ordered by time
  const sent = blocks(0)[0]
  expect(sent.getAttribute('aria-label')).toBe('Fall Launch: Scheduled, 00:05, Email, sent')                   // a future run makes it Scheduled
  expect(sent.querySelector('[data-sent]')!.textContent).toBe('Sent')
  expect(sent.className).toContain('bg-tag-scheduled-bg')
  expect(sent.getAttribute('href')).toBe('/campaigns/w1')
  const journey = blocks(1).find((block) => block.textContent!.includes('Welcome Series'))!
  expect(journey.textContent).toContain('Welcome Series, Step 2')
  expect(journey.querySelector('[data-category="journey"]')).toBeTruthy()
  expect(journey.getAttribute('aria-label')).toMatch(/, journey run$/)
  const failed = blocks(1).find((block) => block.textContent!.includes('Broken Promo'))!
  expect(failed.className).toContain('bg-tag-failed-bg')
  expect(column(4).textContent).toContain('No sends')

  expect(blocks(3)).toHaveLength(8)
  await user.click(within(column(3)).getByRole('button', { name: '+2 More' }))
  const modal = await screen.findByRole('dialog')
  expect(within(modal).getByRole('link', { name: 'Hourly Deals' })).toBeTruthy()
})

test('Journey Runs off hides them in the week, the month and the day list, and is kept as journeys=0', async () => {
  installMockApi({ campaigns: week() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?view=calendar&mode=week')
  await vi.waitFor(() => expect(blocks(1).length).toBe(2))
  await user.click(screen.getByRole('switch', { name: 'Journey Runs' }))
  expect(search().get('journeys')).toBe('0')
  expect(blocks(1).map((block) => block.textContent)).not.toContain(expect.stringContaining('Welcome Series'))
  expect(blocks(1)).toHaveLength(1)
  expect(document.querySelector('[data-legend="journey"]')).toBeNull()

  await user.click(screen.getByRole('radio', { name: 'Month' }))
  const grid = await screen.findByRole('grid')
  await vi.waitFor(() => expect(within(grid).getAllByRole('link').length).toBeGreaterThan(0))
  expect(within(grid).queryByRole('link', { name: /Welcome Series/ })).toBeNull()
  await user.click(screen.getByRole('switch', { name: 'Journey Runs' }))
  expect(search().get('journeys')).toBeNull()
  const [bar] = await within(grid).findAllByRole('link', { name: /^Welcome Series: Active, journey run/ })   // a run that crosses a week's end is drawn in both rows
  expect(bar.querySelector('[data-journey-mark]')).toBeTruthy()
  expect(document.querySelector('[data-legend="journey"]')).toBeTruthy()
})

test('an address with a start and a channel opens that week filtered; invalid values are ignored', async () => {
  const calls = installMockApi({ campaigns: week() })
  await renderAppAt('/campaigns?view=calendar&mode=week&start=2026-10-05&channel=SMS')
  const calendar = await screen.findByRole('region', { name: 'Campaign calendar' })
  expect(within(calendar).getByRole('heading', { level: 2 }).textContent).toBe('5 Oct – 11 Oct 2026')
  await vi.waitFor(() => expect(calendarCalls(calls).some((params) => params.get('date_from') === '2026-10-05' && params.get('date_to') === '2026-10-11' && params.get('channel') === 'SMS')).toBe(true))
  cleanup()

  installMockApi({ campaigns: week() })
  await renderAppAt('/campaigns?view=calendar&mode=year&start=not-a-day')
  const month = await screen.findByRole('region', { name: 'Campaign calendar' })
  expect(within(month).getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true')
  await userEvent.setup().click(within(month).getByRole('radio', { name: 'Week' }))
  expect(within(month).getByRole('heading', { level: 2 }).textContent).toBe(weekTitle(today(), addDays(today(), 6)))
})

test('below 768px the week is a list: a heading per day, "No sends" on empty ones, status and journey tags on each send', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: !query.includes('768'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  installMockApi({ campaigns: week() })
  await renderAppAt('/campaigns?view=calendar&mode=week')
  await screen.findByRole('region', { name: 'Campaign calendar' })
  const days = await vi.waitFor(() => {
    const found = [...document.querySelectorAll('[data-calendar-week] section')] as HTMLElement[]
    expect(found).toHaveLength(7)
    expect(found[1].querySelectorAll('li').length).toBe(2)
    return found
  })
  expect(days[4].textContent).toContain('No sends')
  const journey = [...days[1].querySelectorAll('li')].find((row) => row.textContent!.includes('Welcome Series'))!
  expect(journey.querySelector('[data-category="journey"]')).toBeTruthy()
  expect(within(journey).getByText('Active')).toBeTruthy()
  expect(document.querySelector('[data-calendar-week] .grid-cols-7')).toBeNull()
})

// ---------------------------------------------------------------------------------------------------- drips in the week
const dripWeek = (status = 'ACTIVE'): Campaign[] => [makeCampaign({
  id: 'd1', name: 'Loyalty Welcome Series', campaign_type: 'DRIP', send_type: 'DRIP', status, send_timezone: ZONE,
  runs: [{ ...runAt('r1', local(0, '09:00'), 'COMPLETED'), campaign: 'd1', drip_step: 's1' }, { ...runAt('r2', local(2, '09:00')), campaign: 'd1', drip_step: 's2' }] as Campaign['runs'],
})]
const dripSteps = { d1: [makeStep({ id: 's1', day: 0, name: 'Welcome' }), makeStep({ id: 's2', day: 2, name: 'First Reward' }), makeStep({ id: 's3', day: 9, name: 'Reminder' })] }

test('the week: each drip message is an entry of its own, "Message 3 of 4" with its name and time under it', async () => {
  installMockApi({ campaigns: dripWeek(), dripSteps })
  await renderAppAt('/campaigns?view=calendar&mode=week')
  await vi.waitFor(() => expect(blocks(2)).toHaveLength(1))
  expect(blocks(0)[0].textContent).toBe('SentLoyalty Welcome Series · Message 1 of 3Welcome · 09:00 ET')
  expect(blocks(2)[0].textContent).toBe('Loyalty Welcome Series · Message 2 of 3First Reward · 09:00 ET')
  expect(blocks(2)[0].getAttribute('aria-label')).toBe('Loyalty Welcome Series · Message 2 of 3, First Reward · 09:00 ET: Active, Email')
})

test('a paused drip’s waiting messages are not in the week', async () => {
  installMockApi({ campaigns: dripWeek('PAUSED'), dripSteps })
  await renderAppAt('/campaigns?view=calendar&mode=week')
  await vi.waitFor(() => expect(blocks(0)).toHaveLength(1))
  expect(blocks(2)).toHaveLength(0)
})
