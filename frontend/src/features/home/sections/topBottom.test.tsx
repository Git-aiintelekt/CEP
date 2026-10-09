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
const rows = () => [...card().querySelectorAll('li[data-campaign]')] as HTMLElement[]
const listRows = (name: string) => [...within(card()).getByRole('list', { name }).querySelectorAll('li[data-campaign]')] as HTMLElement[]
const context = (row: HTMLElement) => row.querySelector('[data-context]')!.textContent
const figure = (row: HTMLElement) => row.querySelector('[data-figure]')!.textContent
const withTopBottom = (result: SectionResult<TopBottom>): HomeDataSource => ({ ...createSampleSource('busy'), useTopBottom: () => result })

test('the three campaigns furthest over target and the three furthest under: name, channel, revenue and change, the share of target at the right; View All in the header', () => {
  renderHome()
  const header = card().querySelector('[data-section-header="card"]') as HTMLElement
  expect(within(header).getByRole('link', { name: 'View All' }).getAttribute('href')).toBe('/campaigns')
  expect(within(card()).getAllByRole('link', { name: 'View All' })).toHaveLength(2)                          // the header's, and the one on the line between the lists
  expect(within(card()).getByRole('list', { name: 'Top campaigns by revenue against target' })).toBeTruthy()
  const top = listRows('Top campaigns by revenue against target')
  const bottom = listRows('Bottom campaigns by revenue against target')
  expect(top).toHaveLength(3)
  expect(bottom).toHaveLength(3)
  expect(top.map(context)).toEqual(['Email · $41.2K · +22.0%', 'Email · $312.8K · +9.8%', 'Email · $98.4K · +4.6%'])
  expect(top.map(figure)).toEqual(['118%', '112%', '109%'])
  expect(bottom.map(context)).toEqual(['MMS · $38.4K · −12.4%', 'SMS · $24.9K · −18.7%', 'Email · $21.3K · −31.0%'])
  expect(within(top[0]).getByRole('link', { name: 'Store Opening, Austin Domain Northside' }).getAttribute('href')).toBe('/campaigns/c10')
  expect(top[0].querySelector('[data-figure]')!.className).toContain('text-ink-900')
  expect(bottom.every((row) => row.querySelector('[data-figure]')!.className.includes('text-danger-text'))).toBe(true)   // under target in red
})

test('light: two ranked campaigns, one in each list', () => {
  renderHome({ state: 'light' })
  expect(rows()).toHaveLength(2)
  expect(listRows('Top campaigns by revenue against target').map(context)).toEqual(['Email · 2 of 4 messages sent · $7.4K · +4.1%'])      // a drip says how far it has got
  expect(listRows('Bottom campaigns by revenue against target').map(context)).toEqual(['SMS · $2.9K · −6.3%'])
})

test('no ranked campaigns: one quiet line', () => {
  renderHome({ source: withTopBottom({ status: 'ready', data: { mode: 'target', top: [], bottom: [], middle: { count: 0, min: 0, max: 0 }, average: null } }) })
  expect(within(card()).queryByRole('list')).toBeNull()
  expect(card().textContent).toContain('No campaigns with a revenue target have results in this period.')
})

test('without attribution: the highest click rates against the account average, in points', () => {
  renderHome({ state: 'noAttribution' })
  expect(within(card()).getByRole('list', { name: 'Top campaigns by click rate' })).toBeTruthy()
  expect(rows()[0].querySelector('[data-context]')!.textContent).toMatch(/^(Email|SMS|MMS) · [\d.]+% click rate · [+−][\d.]+ pt$/)
  expect(rows()[0].querySelector('[data-figure]')!.textContent).toMatch(/^[\d.]+%$/)
  expect(document.body.textContent).not.toContain('$0')
})

test('loading shows three placeholder rows; an error offers Try Again; one campaign hides the card', () => {
  renderHome({ source: withTopBottom({ status: 'loading' }) })
  expect(card().querySelector('[data-top-campaigns="loading"]')!.children).toHaveLength(3)
  cleanup()
  renderHome({ source: withTopBottom({ status: 'error', error: new Error('Down'), retry: () => undefined }) })
  expect(within(card()).getByRole('alert').textContent).toContain('Try Again')
  cleanup()
  renderHome({ url: '/?campaigns=c06' })
  expect(screen.queryByRole('region', { name: 'Top and Bottom Campaigns' })).toBeNull()
})
