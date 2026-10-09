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
const note = () => scheduleCard().querySelector('[data-week-note]')!
const summary = () => scheduleCard().querySelector('[data-day-summary]')?.textContent
/** the picked day's sends as listed: name only */
const runs = () => [...scheduleCard().querySelectorAll('[data-run]')].map((run) => run.querySelector('.flex-1')!.firstElementChild!.textContent)
const mixParts = (tile: HTMLElement) => [...tile.querySelectorAll('[data-mix-part]')].map((part) => part.getAttribute('data-mix-part'))
const tileTexts = (tile: HTMLElement) => [...tile.children].filter((child) => !child.hasAttribute('data-mix')).map((child) => child.textContent)

/** a schedule with `count` runs today, for the summary */
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
  expect(tileTexts(tiles()[0])).toEqual(['Today', String(Number(todayIn(ZONE).slice(8))), '6 runs'])
  expect(tileTexts(tiles()[1])[0]).toMatch(/^[A-Z][a-z]{2}$/)
  expect(tileTexts(tiles()[1])[2]).toMatch(/^\d+ runs?$/)
  expect(tiles().map((tile) => tile.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1', '-1'])
  expect(tiles()[0].className).toContain('border-brand-600 bg-brand-600')
  expect(tiles()[1].className).not.toContain('bg-brand-600')
  tiles()[0].focus()
  await user.keyboard('{ArrowRight}')
  expect(tiles()[1].getAttribute('aria-checked')).toBe('true')
  expect(document.activeElement).toBe(tiles()[1])
  await user.keyboard('{End}')
  expect(tiles()[6].getAttribute('aria-checked')).toBe('true')
  await user.keyboard('{Home}')
  expect(tiles()[0].getAttribute('aria-checked')).toBe('true')
})

test('each tile ends in a mix bar: Blue for campaign runs and a chart colour for journey runs, sized by share, none on an empty day; the bar is hidden from screen readers', () => {
  renderHome()
  expect(tiles().map(mixParts)).toEqual([['campaign', 'journey'], ['campaign', 'journey'], [], ['campaign', 'journey'], ['campaign'], [], ['campaign']])
  expect(tiles()[0].querySelector('[data-mix-part="campaign"]')!.className).toContain('bg-on-brand-soft')
  expect(tiles()[1].querySelector('[data-mix-part="campaign"]')!.className).toContain('bg-brand-600')
  expect(tiles()[1].querySelector('[data-mix-part="journey"]')!.className).toContain('bg-chart-2')
  expect(parseFloat((tiles()[0].querySelector('[data-mix-part="campaign"]') as HTMLElement).style.width)).toBeCloseTo(66.67, 1)
  expect(parseFloat((tiles()[0].querySelector('[data-mix-part="journey"]') as HTMLElement).style.width)).toBeCloseTo(33.33, 1)
  expect(tiles()[0].querySelector('[data-mix]')!.getAttribute('aria-hidden')).toBe('true')
  expect(tiles()[2].querySelector('[data-mix]')!.children).toHaveLength(0)
})

test('each day’s accessible name carries its campaign / journey split', () => {
  renderHome()
  expect(tiles()[0].getAttribute('aria-label')).toMatch(/^Today \d{1,2} [A-Z][a-z]+, 6 sends: 4 campaign, 2 journey$/)
  expect(tiles()[2].getAttribute('aria-label')).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+, No sends$/)
  cleanup()
  renderHome({ url: '/?campaigns=c06,c04' })
  expect(tiles().map((tile) => tile.getAttribute('aria-label')).filter((label) => label!.includes('send:') || label!.includes('sends:')).every((label) => /\d+ campaign$/.test(label!))).toBe(true)
  expect(tiles().some((tile) => /campaign$/.test(tile.getAttribute('aria-label')!))).toBe(true)
})

test('the picked day’s sends listed in time order, four by name with their kind; the note counts the rest and the week', async () => {
  const user = userEvent.setup()
  renderHome()
  expect(note().textContent).toBe('2 more today. 12 campaign sends and 5 journey touchpoints this week.')
  expect(runs()).toEqual(['October Newsletter Preview', 'Welcome Series, Step 2', 'Flash Sale Reminder', 'Fall Boots Launch'])
  const first = scheduleCard().querySelector('[data-run]')!
  expect(first.textContent).toContain('08:00')
  expect(first.textContent).toContain('Today · Campaign · Email')
  expect(scheduleCard().querySelector('[data-run="journey"]')!.textContent).toContain('Journey ·')
  await user.click(tiles()[3])
  expect(runs().slice(0, 3)).toEqual(['Win-Back 90 Days, Step 1', 'Weekend Flash Deal', 'Loyalty Points Statement'])
  expect(runs()).toHaveLength(4)
  expect(note().textContent).not.toContain('more')
  await user.click(tiles()[2])
  expect(summary()).toMatch(/^No sends are scheduled on [A-Z][a-z]+day\.$/)
})

test('the note reads naturally at 1 and 0', () => {
  renderHome({ source: withSchedule(busyDay(1)) })
  expect(note().textContent).toBe('1 campaign send this week.')
  expect(runs()).toEqual(['Run 1'])
  cleanup()
  renderHome({ source: withSchedule(busyDay(0)) })
  expect(note().textContent).toBe('Nothing is scheduled this week.')
  expect(summary()).toBe('No sends are scheduled today.')
})

test('Open Schedule in the header goes to the Campaigns calendar, with the page’s channel when there is one', () => {
  renderHome()
  const link = within(scheduleCard()).getByRole('link', { name: 'Open Schedule' })
  expect(link.getAttribute('href')).toBe('/campaigns?view=calendar&mode=week')
  expect(scheduleCard().querySelector('[data-section-header="card"]')!.contains(link)).toBe(true)
  cleanup()
  renderHome({ url: '/?channel=SMS' })
  expect(within(scheduleCard()).getByRole('link', { name: 'Open Schedule' }).getAttribute('href')).toBe('/campaigns?view=calendar&mode=week&channel=SMS')
})

test('a campaign filter shows only its runs and hides journey runs and the journey part of the mix bars', () => {
  renderHome({ url: '/?campaigns=c06,c04' })
  expect(runs()).toEqual(['Flash Sale Reminder', 'Fall Boots Launch'])
  expect(note().textContent).not.toContain('journey')
  expect(scheduleCard().querySelector('[data-mix-part="journey"]')).toBeNull()
})

test('loading shows the seven placeholders; an error offers Try Again', () => {
  renderHome({ source: { ...createSampleSource('busy'), useSchedule: () => ({ status: 'loading' }) } })
  expect(scheduleCard().querySelector('[data-schedule="loading"] .grid')!.children).toHaveLength(7)
  cleanup()
  renderHome({ source: { ...createSampleSource('busy'), useSchedule: () => ({ status: 'error', error: new Error('Down'), retry: () => undefined }) } })
  expect(within(scheduleCard()).getByRole('alert').textContent).toContain('Try Again')
})

// ---------------------------------------------------------------- Channel Snapshot
const snapshot = () => screen.getByRole('region', { name: 'Channel Snapshot' })
const snapshotRows = () => [...snapshot().querySelectorAll('[data-snapshot]')].filter((row) => row.tagName === 'LI') as HTMLElement[]
const rowText = (row: HTMLElement) => [row.getAttribute('data-snapshot'), row.querySelector('.text-sm.font-semibold')!.textContent, row.querySelector('.flex-1.text-xs')!.textContent, row.querySelector('[data-value]')!.textContent]

test('one row per channel with its engagement and open rate (click rate where opens aren’t tracked), then e-receipts and the week’s journey touchpoints; the period at the right', () => {
  renderHome()
  expect(snapshotRows().map(rowText)).toEqual([
    ['EMAIL', 'Email', '427,821 opens · 49,447 clicks', '37.5%'],
    ['SMS', 'SMS', '6,875 clicks', '2.6%'],
    ['MMS', 'MMS', '984 clicks', '2.4%'],
    ['E_RECEIPT', 'E-Receipt', '214,600 receipts sent', '61.2%'],
    ['JOURNEY', 'Journey', '5 upcoming touchpoints', '5'],
  ])
  expect(snapshot().querySelector('[data-section-header="card"]')!.textContent).toContain('Last 30 Days')
  expect(snapshotRows()[0].querySelector('[aria-hidden]')!.className).toContain('cep-home-badge')
  expect(snapshotRows()[0].querySelector('[aria-hidden]')!.className).toContain('text-plum-700')
})

test('a channel with nothing delivered says so with a grey dash; the rows follow the workspace’s channels, the page’s channel, and the features', () => {
  renderHome({ source: { ...createSampleSource('busy'), useFunnel: () => ({ status: 'ready', data: [] }) } })
  expect(snapshotRows().map(rowText).slice(0, 3)).toEqual([['EMAIL', 'Email', 'No sends in period', '—'], ['SMS', 'SMS', 'No sends in period', '—'], ['MMS', 'MMS', 'No sends in period', '—']])
  expect(snapshotRows()[0].querySelector('[data-value]')!.className).toContain('text-ink-800')
  cleanup()
  renderHome({ url: '/?channel=SMS' })
  expect(snapshotRows().map((row) => row.getAttribute('data-snapshot'))).toEqual(['SMS', 'E_RECEIPT', 'JOURNEY'])
  cleanup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, has: (feature) => !['mms', 'ereceipt', 'journeys'].includes(feature) } })
  expect(snapshotRows().map((row) => row.getAttribute('data-snapshot'))).toEqual(['EMAIL', 'SMS'])
  cleanup()
  renderHome({ state: 'light' })
  expect(snapshotRows().map((row) => row.getAttribute('data-snapshot'))).toEqual(['EMAIL', 'SMS', 'MMS', 'JOURNEY'])
})

test('no snapshot for one campaign, or when the funnel can’t be read; the last row holds it beside E-Receipts, two thirds and one third', () => {
  renderHome({ url: '/?campaigns=c06' })
  expect(screen.queryByRole('region', { name: 'Channel Snapshot' })).toBeNull()
  cleanup()
  renderHome({ source: { ...createSampleSource('busy'), useFunnel: () => ({ status: 'unavailable' }) } })
  expect(screen.queryByRole('region', { name: 'Channel Snapshot' })).toBeNull()
  cleanup()
  renderHome()
  const row = snapshot().closest('[data-row]')!
  expect(row.getAttribute('data-layout')).toBe('2:1')
  expect(row.contains(screen.getByRole('region', { name: 'E-Receipts' }))).toBe(true)
  expect(row.contains(screen.getByRole('region', { name: 'Governance' }))).toBe(false)
})

test('one campaign: Next 7 Days beside Governance', () => {
  renderHome({ url: '/?campaigns=c06' })
  const row = scheduleCard().closest('[data-row]')!
  expect(row.contains(screen.getByRole('region', { name: 'Governance' }))).toBe(true)
  expect(row.getAttribute('data-layout')).toBe('1:1')
})
