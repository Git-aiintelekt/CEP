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
  'Create New', 'Needs Attention', 'Marketing Performance', 'Top and Bottom Campaigns', 'Attributed Revenue vs. Campaign Cost', 'Engagement Funnel by Channel',
  'Next 7 Days', 'Active Journeys', 'Recent Campaigns', 'Governance', 'E-Receipts',
]

const order = () => screen.getAllByRole('heading').map((heading) => heading.textContent)

test('busy: the greeting, then every section in order, each a region named by its heading, each heading with its plum square', () => {
  renderHome()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Sarah$/)
  expect(order().slice(1)).toEqual(SECTIONS)
  for (const name of SECTIONS) {
    const section = region(name)!
    expect(section.tagName).toBe('SECTION')
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).toBe(name)
    expect(section.querySelector('[data-plum-icon]')).toBeTruthy()
  }
  expect(rowOf('Attributed Revenue vs. Campaign Cost')!.getAttribute('data-layout')).toBe('2:1')
  expect(rowOf('Next 7 Days')!.getAttribute('data-layout')).toBe('1:1')
  expect(rowOf('Recent Campaigns')!.getAttribute('data-layout')).toBe('2:1')
  expect(region('Governance')!.closest('[data-side-column]')).toBe(region('E-Receipts')!.closest('[data-side-column]'))
  expect(within(region('Marketing Performance')!).getByText('Campaign Contribution')).toBeTruthy()
})

test('no alerts: Create New sits straight above Marketing Performance, with nothing between', () => {
  renderHome({ state: 'noAlerts' })
  expect(order().slice(1, 3)).toEqual(['Create New', 'Marketing Performance'])
  const page = region('Create New')!.parentElement!
  expect(region('Create New')!.nextElementSibling).toBe(region('Marketing Performance'))
  expect(page.className).toContain('gap-6')
})

test('with no first name the greeting stands alone', () => {
  renderHome({ viewer: { ...SAMPLE_VIEWER, firstName: '' } })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening)$/)
})

test('Clear Filters shows for Campaign or Channel only, comes after the chips, and resets all three', async () => {
  const user = userEvent.setup()
  renderHome({ url: '/dev/home?period=7d' })
  const filters = screen.getByRole('group', { name: 'Filters' })
  expect(within(filters).queryByRole('button', { name: 'Clear Filters' })).toBeNull()                       // a period alone is not a narrowing
  expect(within(filters).getByRole('button', { name: 'Last 7 Days' }).className).not.toContain('bg-brand-100')
  expect(filters.className).toContain('gap-3')

  await user.click(within(filters).getByRole('button', { name: 'All Channels' }))
  await user.click(screen.getByRole('option', { name: 'SMS' }))
  const buttons = within(filters).getAllByRole('button')
  expect(buttons.at(-1)!.textContent).toBe('Clear Filters')
  expect(within(filters).getByRole('button', { name: 'Last 7 Days' }).className).not.toContain('bg-brand-100')
  await user.click(within(filters).getByRole('button', { name: 'Clear Filters' }))
  expect(search()).toBe('')
})

test('one campaign: the single-campaign note, the hidden sections, Governance beside Next 7 Days; Show All Campaigns undoes it', async () => {
  const user = userEvent.setup()
  renderHome({ url: '/dev/home?campaigns=c06' })
  const note = document.querySelector('[data-single-campaign]')!
  expect(note.textContent).toMatch(/Single-Campaign View:\sFall Boots Launch/)
  for (const name of ['Top and Bottom Campaigns', 'Recent Campaigns', 'Active Journeys', 'E-Receipts']) expect(region(name)).toBeNull()
  expect(rowOf('Governance')).toBe(rowOf('Next 7 Days'))
  expect(rowOf('Governance')!.getAttribute('data-layout')).toBe('1:1')

  await user.click(screen.getByRole('button', { name: 'Show All Campaigns' }))
  expect(search()).toBe('')
  expect(document.querySelector('[data-single-campaign]')).toBeNull()
  expect(region('Recent Campaigns')).toBeTruthy()
})

test('the Channel menu lists only the workspace’s channels', async () => {
  const user = userEvent.setup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'mms' } })
  await user.click(screen.getByRole('button', { name: 'All Channels' }))
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['All Channels', 'Email', 'SMS'])
})

test('light: no Active Journeys or E-Receipts, so the cards pair up; no card stretches alone', () => {
  renderHome({ state: 'light' })
  expect(region('Active Journeys')).toBeNull()
  expect(region('E-Receipts')).toBeNull()
  expect(rowOf('Next 7 Days')).toBe(rowOf('Engagement Funnel by Channel'))
  expect(rowOf('Next 7 Days')!.getAttribute('data-layout')).toBe('1:1')
  expect(rowOf('Governance')).toBe(rowOf('Recent Campaigns'))
  expect(rowOf('Governance')!.getAttribute('data-layout')).toBe('2:1')
  expect(document.querySelectorAll('[data-layout="full"]')).toHaveLength(0)
})


test('live today: the cards re-pack two per row, and no small card stands alone at full width', () => {
  renderHome({ state: 'liveToday' })
  for (const name of ['Attributed Revenue vs. Campaign Cost', 'Active Journeys', 'Governance']) expect(region(name)).toBeNull()
  const rows = [...document.querySelectorAll('[data-row]')].map((row) => `${row.getAttribute('data-layout')} ${[...row.querySelectorAll('section[aria-labelledby]')].map((section) => document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).join(' | ')}`)
  expect(rows).toEqual(['2:1 Top and Bottom Campaigns | Engagement Funnel by Channel', '1:1 Next 7 Days | E-Receipts', 'full Recent Campaigns'])
  expect(rowOf('Top and Bottom Campaigns')!.className).toContain('min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')
  cleanup()
  renderHome({ state: 'liveToday', viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'ereceipt' } })
  expect(rowOf('Next 7 Days')).toBe(rowOf('Recent Campaigns'))
  expect(rowOf('Next 7 Days')!.getAttribute('data-layout')).toBe('1:1')
  expect(document.querySelectorAll('[data-layout="full"]')).toHaveLength(0)
})

test('busy: the design, untouched', () => {
  renderHome()
  expect([...document.querySelectorAll('[data-row]')].map((row) => `${row.getAttribute('data-row')} ${row.getAttribute('data-layout')}`)).toEqual(['top full', 'a 2:1', 'b 1:1', 'c 2:1'])
  expect(document.querySelector('[data-side-column]')!.children).toHaveLength(2)
})
