import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from '../HomePage'
import { HomeDataProvider } from '../data/HomeDataProvider'
import { createSampleSource, type SampleState } from '../data/sampleSource'
import { SAMPLE_VIEWER } from '../data/sampleViewer'
import type { HomeDataSource, SectionResult, TopBottom } from '../data/types'

afterEach(cleanup)

const renderHome = ({ url = '/', state = 'busy', source }: { url?: string; state?: SampleState; source?: HomeDataSource } = {}) =>
  render(<MemoryRouter initialEntries={[url]}><HomeDataProvider source={source ?? createSampleSource(state)} viewer={SAMPLE_VIEWER}><HomePage /></HomeDataProvider></MemoryRouter>)
const card = () => screen.getByRole('region', { name: 'Top and Bottom Campaigns' })
const table = () => within(card()).getByRole('table')
const rows = () => [...table().querySelectorAll('tr[data-campaign]')] as HTMLElement[]
const withTopBottom = (result: SectionResult<TopBottom>): HomeDataSource => ({ ...createSampleSource('busy'), useTopBottom: () => result })

test('a table ranked by revenue against target: caption, headers, the best three, the five between, the weakest three last', () => {
  renderHome()
  expect(within(card()).getByRole('link', { name: 'View All Campaigns' }).getAttribute('href')).toBe('/campaigns')
  expect(table().querySelector('caption')!.textContent).toBe('Campaigns ranked by revenue against target')
  expect(within(table()).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Campaign', 'Under Target', 'Over Target', 'Revenue', 'Change'])
  expect(rows().map((row) => row.querySelector('[data-percent]')!.textContent)).toEqual(['118%', '112%', '109%', '64%', '45%', '28%'])
  const first = rows()[0]
  expect(within(first).getByRole('link', { name: 'Store Opening, Austin Domain Northside' }).getAttribute('href')).toBe('/campaigns/c10')
  expect(within(first).getByRole('img', { name: 'Email' })).toBeTruthy()
  expect(within(rows()[4]).getByRole('img', { name: 'SMS' })).toBeTruthy()
  expect(within(rows()[3]).getByRole('img', { name: 'MMS' })).toBeTruthy()
  expect(first.className).toContain('h-[46px]')
  expect(first.textContent).toContain('$41.2K')
  expect(first.textContent).toContain('+22.0%')
  expect(rows()[5].textContent).toContain('−31.0%')

  const middle = table().querySelector('[data-middle]') as HTMLElement
  expect(middle.textContent).toBe('5 more campaigns between 65% and 108% of target · View All')
  expect(middle.className).toContain('border-line-subtle')
  expect(within(middle).getByRole('link', { name: 'View All' }).getAttribute('href')).toBe('/campaigns')
})

test('over target: a Blue 600 bar right of the centre with a blue label; under: a red bar left with a red label; the bars are hidden from screen readers', () => {
  renderHome()
  const over = rows()[0].querySelector('[data-bar]')!
  expect(over.getAttribute('data-bar')).toBe('over')
  expect(over.className).toContain('bg-chart-1')
  expect(over.className).toContain('rounded-r-xs')
  expect(over.getAttribute('aria-hidden')).toBe('true')
  expect(rows()[0].querySelector('[data-percent]')!.className).toContain('text-brand-800')
  const under = rows()[5].querySelector('[data-bar]')!
  expect(under.getAttribute('data-bar')).toBe('under')
  expect(under.className).toContain('bg-danger')
  expect(rows()[5].querySelector('[data-percent]')!.className).toContain('text-danger-text')
  expect((under as HTMLElement).style.width).toBe('calc(1 * (100% - 3rem))')                              // 28% is the furthest off 100
  expect(rows()[0].querySelectorAll('td')[1].className).toContain('border-r border-line')                  // the centre line
})

test('the Change column hides below 768px', () => {
  renderHome()
  const change = within(table()).getByRole('columnheader', { name: 'Change' })
  expect(change.className).toContain('hidden min-[768px]:table-cell')
  expect(rows()[0].querySelectorAll('td')[4].className).toContain('hidden min-[768px]:table-cell')
})

test('two ranked campaigns: one above and one below, no line between', () => {
  renderHome({ state: 'light' })
  expect(rows()).toHaveLength(2)
  expect(table().querySelector('[data-middle]')).toBeNull()
})

test('no ranked campaigns: one quiet line', () => {
  renderHome({ source: withTopBottom({ status: 'ready', data: { mode: 'target', top: [], bottom: [], middle: { count: 0, min: 0, max: 0 }, average: null } }) })
  expect(within(card()).queryByRole('table')).toBeNull()
  expect(card().textContent).toContain('No campaigns with a revenue target have results in this period.')
})

test('without attribution: click rate against the account average', () => {
  renderHome({ state: 'noAttribution' })
  expect(table().querySelector('caption')!.textContent).toBe('Campaigns ranked by click rate against the account average')
  expect(within(table()).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Campaign', 'Below Average', 'Above Average', 'Click Rate', 'Change'])
  expect(rows()[0].querySelector('[data-percent]')!.textContent).toBe('7.2%')
  expect(rows()[0].querySelectorAll('td')[3].textContent).toBe('7.2%')
  expect(rows()[0].querySelectorAll('td')[4].textContent).toMatch(/ pt$/)
  expect(table().querySelector('[data-middle]')!.textContent).toMatch(/^5 more campaigns between [\d.]+% and [\d.]+% click rate · View All$/)
  expect(document.body.textContent).not.toContain('$0')
})

test('loading shows six placeholder rows; an error offers Try Again; one campaign hides the card', () => {
  renderHome({ source: withTopBottom({ status: 'loading' }) })
  expect(card().querySelector('[data-top-bottom="loading"]')!.children).toHaveLength(6)
  cleanup()
  renderHome({ source: withTopBottom({ status: 'error', error: new Error('Down'), retry: () => undefined }) })
  expect(within(card()).getByRole('alert').textContent).toContain('Try Again')
  cleanup()
  renderHome({ url: '/?campaigns=c06' })
  expect(screen.queryByRole('region', { name: 'Top and Bottom Campaigns' })).toBeNull()
})
