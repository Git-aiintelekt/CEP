import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { addDays, todayIn } from '@/features/reports/period'
import { atZone } from '@/lib/zonedTime'

import { HomePage } from '../HomePage'
import { HomeDataProvider } from '../data/HomeDataProvider'
import { createSampleSource, type SampleState } from '../data/sampleSource'
import { SAMPLE_VIEWER } from '../data/sampleViewer'
import type { HomeDataSource, HomeViewer, Schedule } from '../data/types'

afterEach(cleanup)

const ZONE = 'America/New_York'
const renderHome = ({ url = '/', state = 'busy', source, viewer = SAMPLE_VIEWER }: { url?: string; state?: SampleState; source?: HomeDataSource; viewer?: HomeViewer } = {}) =>
  render(<MemoryRouter initialEntries={[url]}><HomeDataProvider source={source ?? createSampleSource(state)} viewer={viewer}><HomePage /></HomeDataProvider></MemoryRouter>)
const scheduleCard = () => screen.getByRole('region', { name: 'Next 7 Days' })
const tiles = () => within(within(scheduleCard()).getByRole('radiogroup', { name: 'Pick a day' })).getAllByRole('radio')
const listed = () => [...scheduleCard().querySelectorAll('li[data-run]')] as HTMLElement[]
const times = () => listed().map((row) => row.querySelector('span')!.textContent)

/** a schedule with `count` runs today, for the row cap */
function busyDay(count: number): Schedule {
  const today = todayIn(ZONE)
  const runs = Array.from({ length: count }, (_, index) => ({
    id: `r${index}`, at: atZone(today, `${String(8 + index).padStart(2, '0')}:00`, ZONE), channel: 'EMAIL' as const, name: `Run ${index + 1}`, source: 'campaign' as const, campaignId: null, sent: false,
  }))
  return { timezone: ZONE, total: count, days: Array.from({ length: 7 }, (_, offset) => ({ day: addDays(today, offset), campaignRuns: offset ? 0 : count, journeyRuns: 0, runs: offset ? [] : runs })) }
}
const withSchedule = (schedule: Schedule): HomeDataSource => ({ ...createSampleSource('busy'), useSchedule: () => ({ status: 'ready', data: schedule }) })

// ---------------------------------------------------------------- Next 7 Days
test('seven day tiles as one radio group: Today picked first, the arrow keys move and pick, Home and End jump', async () => {
  const user = userEvent.setup()
  renderHome()
  expect(tiles()).toHaveLength(7)
  expect(tiles()[0].getAttribute('aria-checked')).toBe('true')
  expect(tiles()[0].textContent).toMatch(/^Today\d{1,2} [A-Z][a-z]{2}6$/)
  expect(tiles().map((tile) => tile.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1', '-1'])
  expect(tiles()[0].className).toContain('border-brand-600 bg-brand-100')
  tiles()[0].focus()
  await user.keyboard('{ArrowRight}')
  expect(tiles()[1].getAttribute('aria-checked')).toBe('true')
  expect(document.activeElement).toBe(tiles()[1])
  await user.keyboard('{End}')
  expect(tiles()[6].getAttribute('aria-checked')).toBe('true')
  await user.keyboard('{Home}')
  expect(tiles()[0].getAttribute('aria-checked')).toBe('true')
})

test('each tile counts its sends ("—" when none) and splits its bar between campaign and journey runs', () => {
  renderHome()
  expect(tiles().map((tile) => tile.querySelector('.font-display')!.textContent)).toEqual(['6', '2', '—', '4', '1', '—', '2'])
  expect(tiles()[2].querySelector('.font-display')!.className).toContain('text-ink-300')
  const today = tiles()[0]
  expect((today.querySelector('[data-share="campaign"]') as HTMLElement).style.width).toMatch(/^66\.66/)
  expect((today.querySelector('[data-share="journey"]') as HTMLElement).style.width).toMatch(/^33\.33/)
  expect(tiles()[2].querySelector('[data-share]')).toBeNull()                                                   // an empty day: the track only
  expect(within(scheduleCard()).getByText('15 runs scheduled')).toBeTruthy()
})

test('each day’s accessible name carries its campaign / journey split; the bar stays hidden', () => {
  renderHome()
  expect(tiles()[0].getAttribute('aria-label')).toMatch(/^Today \d{1,2} [A-Z][a-z]+, 6 sends: 4 campaign, 2 journey$/)
  expect(tiles()[2].getAttribute('aria-label')).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+, No sends$/)
  expect(tiles()[0].querySelector('[data-split]')!.getAttribute('aria-hidden')).toBe('true')
  cleanup()
  renderHome({ url: '/?campaigns=c06,c04' })
  expect(tiles().map((tile) => tile.getAttribute('aria-label')).filter((label) => label!.includes('send:') || label!.includes('sends:')).every((label) => /\d+ campaign$/.test(label!))).toBe(true)
  expect(tiles().some((tile) => /campaign$/.test(tile.getAttribute('aria-label')!))).toBe(true)
})

test('the picked day’s sends in time order; the morning’s are sent and dimmed; a tag says campaign or journey', async () => {
  const user = userEvent.setup()
  renderHome()
  expect(times()).toEqual(['08:00', '09:30', '11:30', '14:00', '18:00', '20:00'])
  const [first, second, third] = listed()
  expect(first.getAttribute('aria-label')).toMatch(/, sent$/)
  expect(first.textContent).toContain('Sent')
  expect(first.querySelector('span')!.className).toContain('text-ink-300')
  expect(second.querySelector('[data-category]')).toBeNull()
  expect(third.querySelector('[data-category="campaign"]')).toBeTruthy()
  expect(listed()[5].querySelector('[data-category="journey"]')).toBeTruthy()
  expect(scheduleCard().querySelector('[data-day-heading]')!.textContent).toMatch(/^Today, \d{1,2} [A-Z][a-z]{2} · 6 sends · E[DS]T$/)

  await user.click(tiles()[3])
  expect(times()).toEqual(['08:00', '10:00', '14:00', '16:00'])
  expect(scheduleCard().querySelector('[data-day-heading]')!.textContent).toMatch(/^[A-Z][a-z]+day, \d{1,2} [A-Z][a-z]{2} · 4 sends · E[DS]T$/)
  await user.click(tiles()[2])
  expect(within(scheduleCard()).getByText('No sends scheduled')).toBeTruthy()
})

test('eight rows at most, then "{n} more sends on this day" to the schedule; the count reads naturally at 1 and 0', () => {
  renderHome({ source: withSchedule(busyDay(10)) })
  expect(listed()).toHaveLength(8)
  const more = within(scheduleCard()).getByRole('link', { name: '2 more sends on this day' })
  expect(more.getAttribute('href')).toBe(`/campaigns?view=calendar&mode=week&start=${todayIn(ZONE)}`)                 // the week starts on the picked day
  cleanup()
  renderHome({ source: withSchedule(busyDay(1)) })
  expect(within(scheduleCard()).getByText('1 run scheduled')).toBeTruthy()
  cleanup()
  renderHome({ source: withSchedule(busyDay(0)) })
  expect(within(scheduleCard()).getByText('No runs scheduled')).toBeTruthy()
})

test('Open Schedule goes to the Campaigns calendar, with the page’s channel when there is one', () => {
  renderHome()
  expect(within(scheduleCard()).getByRole('link', { name: 'Open Schedule' }).getAttribute('href')).toBe('/campaigns?view=calendar&mode=week')
  cleanup()
  renderHome({ url: '/?channel=SMS' })
  expect(within(scheduleCard()).getByRole('link', { name: 'Open Schedule' }).getAttribute('href')).toBe('/campaigns?view=calendar&mode=week&channel=SMS')
  expect(listed().every((row) => /, SMS, /.test(row.getAttribute('aria-label')!))).toBe(true)
})

test('a campaign filter shows only its runs and hides journey runs', () => {
  renderHome({ url: '/?campaigns=c06,c04' })
  expect(listed().map((row) => row.textContent)).toEqual(['11:30Flash Sale ReminderCampaign', '14:00Fall Boots LaunchCampaign'])
})

// ---------------------------------------------------------------- Active Journeys
const journeysCard = () => screen.getByRole('region', { name: 'Active Journeys' })
const journeyRows = () => [...journeysCard().querySelectorAll('tr[data-journey]')] as HTMLElement[]

test('the top five journeys: failed first, then paused, then the busiest; the context line coloured by status', () => {
  renderHome()
  expect(journeyRows().map((row) => row.querySelector('td')!.textContent)).toEqual([
    `Cart RecoverySMS step failing since 00:12 ${journeyRows()[0].textContent!.match(/E[DS]T/)![0]}`,
    expect.stringMatching(/^Birthday RewardPaused by Maya Patel, \d{1,2} [A-Z][a-z]{2}$/),
    'Welcome SeriesEmail, SMS', 'Win-Back 90 DaysEmail', 'Browse AbandonmentEmail',
  ])
  const context = (index: number) => journeyRows()[index].querySelectorAll('td span[class*="text-helper"]')[0].className
  expect(context(0)).toContain('text-danger-text')
  expect(context(1)).toContain('text-warning-text')
  expect(context(2)).toContain('text-ink-800')
  expect(journeyRows()[0].className).toContain('h-16')
})

test('journey statuses are status tags, the dot only on Active; the numbers; the footer counts every journey', () => {
  renderHome()
  const badges = journeyRows().map((row) => row.querySelectorAll('td')[1].firstElementChild as HTMLElement)
  expect(badges.map((badge) => badge.textContent)).toEqual(['Failed', 'Paused', 'Active', 'Active', 'Active'])
  expect(badges.map((badge) => Boolean(badge.querySelector('[data-live-dot]')))).toEqual([false, false, true, true, true])
  expect(badges[0].className).toContain('bg-tag-failed-bg')
  expect(badges[1].className).toContain('bg-tag-paused-bg')
  expect([...journeyRows()[0].querySelectorAll('td')].slice(2).map((cell) => cell.textContent)).toEqual(['1,206', '9,480', '12.9%'])
  expect(within(journeysCard()).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Journey', 'Status', 'In Flight', 'Entered', 'Conversion'])
  expect(within(journeysCard()).getByRole('columnheader', { name: 'Entered' }).className).toContain('hidden min-[768px]:table-cell')
  expect(within(journeysCard()).getByRole('columnheader', { name: 'Conversion' }).className).toContain('hidden min-[480px]:table-cell')
  expect(within(journeysCard()).getByRole('link', { name: 'View All 14 Journeys' }).getAttribute('href')).toBe('/journeys')
  expect(journeysCard().querySelector('thead')!.className).toContain('bg-surface-subtle')
})

test('no journeys card without the feature, in the light workspace, or when the source can’t feed it; Next 7 Days then pairs up', () => {
  renderHome({ viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'journeys' } })
  expect(screen.queryByRole('region', { name: 'Active Journeys' })).toBeNull()
  expect(scheduleCard().closest('[data-row]')!.getAttribute('data-layout')).toBe('1:1')
  cleanup()
  renderHome({ state: 'light' })
  expect(screen.queryByRole('region', { name: 'Active Journeys' })).toBeNull()
  cleanup()
  renderHome({ source: { ...createSampleSource('busy'), useJourneys: () => ({ status: 'unavailable' }) } })
  expect(screen.queryByRole('region', { name: 'Active Journeys' })).toBeNull()
  expect(scheduleCard().closest('[data-row]')!.getAttribute('data-layout')).toBe('1:1')
})

test('one campaign: Next 7 Days beside the Governance placeholder', () => {
  renderHome({ url: '/?campaigns=c06' })
  const row = scheduleCard().closest('[data-row]')!
  expect(row.contains(screen.getByRole('region', { name: 'Governance' }))).toBe(true)
  expect(screen.queryByRole('region', { name: 'Active Journeys' })).toBeNull()
})
