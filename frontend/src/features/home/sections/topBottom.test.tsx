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
const card = () => screen.getByRole('region', { name: 'Top Campaigns' })
const rows = () => [...card().querySelectorAll('li[data-campaign]')] as HTMLElement[]
const withTopBottom = (result: SectionResult<TopBottom>): HomeDataSource => ({ ...createSampleSource('busy'), useTopBottom: () => result })

test('the three campaigns furthest over target: name, channel, the share of target and the change, the revenue at the right; View All in the header', () => {
  renderHome()
  const link = within(card()).getByRole('link', { name: 'View All' })
  expect(link.getAttribute('href')).toBe('/campaigns')
  expect(card().querySelector('[data-section-header="card"]')!.contains(link)).toBe(true)
  expect(within(card()).getByRole('list', { name: 'Top campaigns by revenue against target' })).toBeTruthy()
  expect(rows()).toHaveLength(3)
  expect(rows().map((row) => row.querySelector('[data-context]')!.textContent)).toEqual(['Email · 118% of target · +22.0%', 'Email · 112% of target · +9.8%', 'Email · 109% of target · +4.6%'])
  expect(rows().map((row) => row.querySelector('[data-figure]')!.textContent)).toEqual(['$41.2K', '$312.8K', '$98.4K'])
  expect(within(rows()[0]).getByRole('link', { name: 'Store Opening, Austin Domain Northside' }).getAttribute('href')).toBe('/campaigns/c10')
  expect(rows()[0].querySelector('[data-figure]')!.className).toContain('text-ink-900')
  expect(card().textContent).not.toMatch(/Under Target|Bottom/)
})

test('light: two ranked campaigns, so only the better one is a top campaign', () => {
  renderHome({ state: 'light' })
  expect(rows()).toHaveLength(1)
  expect(rows()[0].querySelector('[data-context]')!.textContent).toBe('Email · 92% of target · +4.1%')
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
  expect(rows()[0].querySelector('[data-figure]')!.textContent).toMatch(/^[\d.]+% clicks$/)
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
  expect(screen.queryByRole('region', { name: 'Top Campaigns' })).toBeNull()
})
