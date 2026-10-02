import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from './HomePage'
import { HomeDataProvider } from './data/HomeDataProvider'
import { createSampleSource, type SampleState } from './data/sampleSource'
import { SAMPLE_VIEWER } from './data/sampleViewer'
import type { HomeDataSource, HomeViewer } from './data/types'

afterEach(cleanup)

function Where() {
  return <output data-testid="search">{useLocation().search}</output>
}

const renderHome = ({ url = '/dev/home', state = 'busy', source, viewer = SAMPLE_VIEWER }: { url?: string; state?: SampleState; source?: HomeDataSource; viewer?: HomeViewer } = {}) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <HomeDataProvider source={source ?? createSampleSource(state)} viewer={viewer}><HomePage /></HomeDataProvider>
      <Where />
    </MemoryRouter>,
  )
const region = (name: string) => screen.queryByRole('region', { name })
const search = () => screen.getByTestId('search').textContent
const rowOf = (name: string) => region(name)!.closest('[data-row]')

const SECTIONS = [
  'Create New', 'Needs Attention', 'Key Figures', 'Marketing Performance', 'Engagement Funnel', 'Top Campaigns', 'Next 7 Days', 'Channel Snapshot',
  'Recent Campaigns', 'Governance & Audience Health', 'E-Receipts',
]
/** the sections on the page itself have hidden headings; the cards show theirs with the plum square */
const CARDS = SECTIONS.slice(3)

const order = () => screen.getAllByRole('heading').map((heading) => heading.textContent)

test('busy: the greeting and its line, then every section in order, each a region named by its heading; each card heading with its plum square', () => {
  renderHome()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Sarah$/)
  expect(screen.getByText('Your marketing command centre: performance, risks and next actions in one place.')).toBeTruthy()
  expect(order().slice(1)).toEqual(SECTIONS)
  for (const name of SECTIONS) {
    const section = region(name)!
    expect(section.tagName).toBe('SECTION')
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).toBe(name)
    expect(Boolean(section.querySelector('[data-plum-icon]'))).toBe(CARDS.includes(name))
  }
  expect(rowOf('Marketing Performance')!.getAttribute('data-layout')).toBe('2:1')
  expect(rowOf('Top Campaigns')!.getAttribute('data-layout')).toBe('thirds')
  expect(rowOf('Recent Campaigns')!.getAttribute('data-layout')).toBe('full')
  expect(rowOf('Governance & Audience Health')).toBe(rowOf('E-Receipts'))
  expect(within(region('Key Figures')!).getByText('Campaign ROI')).toBeTruthy()
})

test('no alerts: the key figures follow the greeting row (Create New sits inside it), with nothing between', () => {
  renderHome({ state: 'noAlerts' })
  expect(order().slice(1, 3)).toEqual(['Create New', 'Key Figures'])
  const greetingRow = screen.getByRole('heading', { level: 1 }).parentElement!.parentElement!
  expect(greetingRow.contains(region('Create New'))).toBe(true)
  expect(greetingRow.nextElementSibling).toBe(region('Key Figures'))
  expect(greetingRow.parentElement!.className).toContain('gap-4')
})

test('with no first name the greeting stands alone', () => {
  renderHome({ viewer: { ...SAMPLE_VIEWER, firstName: '' } })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening)$/)
})

test('the filters sit in the Marketing Performance header; Clear Filters shows for Campaign or Channel only, comes after the chips, and resets all three', async () => {
  const user = userEvent.setup()
  renderHome({ url: '/dev/home?period=7d' })
  const filters = screen.getByRole('group', { name: 'Filters' })
  expect(region('Marketing Performance')!.querySelector('[data-section-header="card"]')!.contains(filters)).toBe(true)
  expect(within(filters).queryByRole('button', { name: 'Clear Filters' })).toBeNull()                       // a period alone is not a narrowing
  expect(within(filters).getByRole('button', { name: 'Last 7 Days' }).className).not.toContain('bg-brand-100')

  await user.click(within(filters).getByRole('button', { name: 'All Channels' }))
  await user.click(screen.getByRole('option', { name: 'SMS' }))
  const buttons = within(filters).getAllByRole('button')
  expect(buttons.at(-1)!.textContent).toBe('Clear Filters')
  expect(within(filters).getByRole('button', { name: 'Last 7 Days' }).className).not.toContain('bg-brand-100')
  await user.click(within(filters).getByRole('button', { name: 'Clear Filters' }))
  expect(search()).toBe('')
})

test('one campaign: the hidden sections, Governance beside Next 7 Days; the campaign chip undoes it', async () => {
  const user = userEvent.setup()
  renderHome({ url: '/dev/home?campaigns=c06' })
  for (const name of ['Top Campaigns', 'Channel Snapshot', 'Recent Campaigns', 'E-Receipts']) expect(region(name)).toBeNull()
  expect(rowOf('Governance & Audience Health')).toBe(rowOf('Next 7 Days'))
  expect(rowOf('Governance & Audience Health')!.getAttribute('data-layout')).toBe('1:1')
  expect(within(region('Marketing Performance')!).queryByRole('radiogroup', { name: 'Revenue View' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))
  expect(search()).toBe('')
  expect(region('Recent Campaigns')).toBeTruthy()
})

test('the Channel menu lists only the workspace’s channels', async () => {
  const user = userEvent.setup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'mms' } })
  await user.click(screen.getByRole('button', { name: 'All Channels' }))
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['All Channels', 'Email', 'SMS'])
})

test('light: no E-Receipts, so the cards re-pack; Recent takes the odd row', () => {
  renderHome({ state: 'light' })
  expect(region('E-Receipts')).toBeNull()
  expect(rowOf('Top Campaigns')).toBe(rowOf('Next 7 Days'))
  expect(rowOf('Top Campaigns')!.getAttribute('data-layout')).toBe('1:1')
  expect(rowOf('Channel Snapshot')).toBe(rowOf('Governance & Audience Health'))
  expect(rowOf('Recent Campaigns')!.getAttribute('data-layout')).toBe('full')
})

test('live today: the cards re-pack two per row, and no small card stands alone at full width', () => {
  renderHome({ state: 'liveToday' })
  for (const name of ['Marketing Performance', 'Governance & Audience Health']) expect(region(name)).toBeNull()
  const rows = [...document.querySelectorAll('[data-row]')].map((row) => `${row.getAttribute('data-layout')} ${[...row.querySelectorAll('section[aria-labelledby]')].map((section) => document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).join(' | ')}`)
  expect(rows).toEqual(['1:1 Engagement Funnel | Top Campaigns', '1:1 Next 7 Days | Channel Snapshot', '1:1 Recent Campaigns | E-Receipts'])
  cleanup()
  renderHome({ state: 'liveToday', viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'ereceipt' } })
  expect(rowOf('Recent Campaigns')!.getAttribute('data-layout')).toBe('full')
  expect(document.querySelectorAll('[data-layout="full"]')).toHaveLength(1)
})

test('busy: the design, untouched', () => {
  renderHome()
  expect([...document.querySelectorAll('[data-row]')].map((row) => `${row.getAttribute('data-row')} ${row.getAttribute('data-layout')}`)).toEqual(['a 2:1', 'b thirds', 'c full', 'd 1:1'])
  expect(document.querySelector('[data-row="b"]')!.className).toContain('min-[1200px]:grid-cols-3')
})
