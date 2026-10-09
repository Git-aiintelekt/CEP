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

/** Marketing Performance is the page's own heading above the filters (not a region); the rest are regions named by their heading */
const SECTIONS = [
  'Create New', 'Key Figures', 'Needs Attention', 'Attributed Revenue vs. Campaign Cost', 'Engagement Funnel', 'Top and Bottom Campaigns', 'Next 7 Days',
  'Recent Campaigns', 'Governance', 'Channel Snapshot', 'E-Receipts',
]
const ORDER = ['Create New', 'Marketing Performance', ...SECTIONS.slice(1)]

const order = () => screen.getAllByRole('heading').map((heading) => heading.textContent)

test('busy: the greeting with no line under it, then every section in order, each a region named by its heading; the card headings carry no badge', () => {
  renderHome()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Sarah$/)
  expect(screen.queryByText('Your marketing command centre: performance, risks and next actions in one place.')).toBeNull()
  expect(order().slice(1)).toEqual(ORDER)
  expect(screen.getByRole('heading', { level: 2, name: 'Marketing Performance' }).closest('section')).toBeNull()
  for (const name of SECTIONS) {
    const section = region(name)!
    expect(section.tagName).toBe('SECTION')
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).toBe(name)
    expect(section.querySelector('[data-plum-icon]')).toBeNull()
  }
  expect(rowOf('Attributed Revenue vs. Campaign Cost')!.getAttribute('data-layout')).toBe('2:1')
  expect(rowOf('Attributed Revenue vs. Campaign Cost')).toBe(rowOf('Engagement Funnel'))
  expect(rowOf('Top and Bottom Campaigns')!.getAttribute('data-layout')).toBe('1:2')
  expect(rowOf('Top and Bottom Campaigns')).toBe(rowOf('Next 7 Days'))
  expect(rowOf('Recent Campaigns')!.getAttribute('data-layout')).toBe('2:1')
  expect(rowOf('Recent Campaigns')).toBe(rowOf('Governance'))
  expect(rowOf('Channel Snapshot')!.getAttribute('data-layout')).toBe('2:1')
  expect(rowOf('Channel Snapshot')).toBe(rowOf('E-Receipts'))
  expect(within(region('Key Figures')!).getByText('Campaign ROI')).toBeTruthy()
})

test('no alerts: the Marketing Performance row follows the greeting row (Create New sits inside it), then the key figures, with no Needs Attention', () => {
  renderHome({ state: 'noAlerts' })
  expect(order().slice(1, 4)).toEqual(['Create New', 'Marketing Performance', 'Key Figures'])
  expect(region('Needs Attention')).toBeNull()
  const greetingRow = screen.getByRole('heading', { level: 1 }).closest('[data-greeting-row]') as HTMLElement
  expect(greetingRow.contains(region('Create New'))).toBe(true)
  const performanceRow = greetingRow.parentElement!.querySelector('[data-performance-row]')!
  expect(greetingRow.nextElementSibling).toBe(performanceRow)
  expect(performanceRow.nextElementSibling).toBe(region('Key Figures'))
  expect(greetingRow.parentElement!.className).toContain('gap-5')
  expect(greetingRow.parentElement!.className).toContain('cep-home-wash')
})

test('with no first name the greeting stands alone', () => {
  renderHome({ viewer: { ...SAMPLE_VIEWER, firstName: '' } })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening)$/)
})

test('the filters sit in the Marketing Performance row; Clear Filters shows for Campaign or Channel only, comes after the chips, and resets all three', async () => {
  const user = userEvent.setup()
  renderHome({ url: '/dev/home?period=7d' })
  const filters = screen.getByRole('group', { name: 'Filters' })
  const performanceRow = screen.getByRole('heading', { level: 2, name: 'Marketing Performance' }).closest('[data-performance-row]')!
  expect(performanceRow.contains(filters)).toBe(true)
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
  for (const name of ['Top and Bottom Campaigns', 'Channel Snapshot', 'Recent Campaigns', 'E-Receipts']) expect(region(name)).toBeNull()
  expect(rowOf('Governance')).toBe(rowOf('Next 7 Days'))
  expect(rowOf('Governance')!.getAttribute('data-layout')).toBe('1:1')
  expect(within(region('Attributed Revenue vs. Campaign Cost')!).queryByRole('radiogroup', { name: 'Revenue View' })).toBeNull()

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
  expect(rowOf('Top and Bottom Campaigns')).toBe(rowOf('Next 7 Days'))
  expect(rowOf('Top and Bottom Campaigns')!.getAttribute('data-layout')).toBe('1:1')
  expect(rowOf('Channel Snapshot')).toBe(rowOf('Governance'))
  expect(rowOf('Channel Snapshot')!.getAttribute('data-layout')).toBe('1:1')
  expect(rowOf('Recent Campaigns')!.getAttribute('data-layout')).toBe('full')
})

test('live today: the cards re-pack two per row, and no small card stands alone at full width', () => {
  renderHome({ state: 'liveToday' })
  for (const name of ['Attributed Revenue vs. Campaign Cost', 'Governance']) expect(region(name)).toBeNull()
  const rows = [...document.querySelectorAll('[data-row]')].map((row) => `${row.getAttribute('data-layout')} ${[...row.querySelectorAll('section[aria-labelledby]')].map((section) => document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).join(' | ')}`)
  expect(rows).toEqual(['1:1 Engagement Funnel | Top and Bottom Campaigns', '1:1 Next 7 Days | Channel Snapshot', '1:1 E-Receipts | Recent Campaigns'])
  cleanup()
  renderHome({ state: 'liveToday', viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'ereceipt' } })
  expect(rowOf('Recent Campaigns')!.getAttribute('data-layout')).toBe('full')
  expect(document.querySelectorAll('[data-layout="full"]')).toHaveLength(1)
})

test('busy: the design, untouched', () => {
  renderHome()
  expect([...document.querySelectorAll('[data-row]')].map((row) => `${row.getAttribute('data-row')} ${row.getAttribute('data-layout')}`)).toEqual(['a 2:1', 'b 1:2', 'c 2:1', 'd 2:1'])
  expect(document.querySelector('[data-row="b"]')!.className).toContain('@min-[960px]:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]')
})
