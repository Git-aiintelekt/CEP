import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from '../HomePage'
import { HomeDataProvider } from '../data/HomeDataProvider'
import { createSampleSource, type SampleState } from '../data/sampleSource'
import { SAMPLE_VIEWER } from '../data/sampleViewer'
import type { HomeDataSource, HomeViewer } from '../data/types'

afterEach(cleanup)

const renderHome = ({ url = '/', state = 'busy', source, viewer = SAMPLE_VIEWER }: { url?: string; state?: SampleState; source?: HomeDataSource; viewer?: HomeViewer } = {}) =>
  render(<MemoryRouter initialEntries={[url]}><HomeDataProvider source={source ?? createSampleSource(state)} viewer={viewer}><HomePage /></HomeDataProvider></MemoryRouter>)
const recentCard = () => screen.getByRole('region', { name: 'Recent Campaigns' })
const rows = () => [...recentCard().querySelectorAll('tr[data-campaign]')] as HTMLElement[]
const names = () => rows().map((row) => row.querySelector('a')!.textContent)
const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((cell) => cell.textContent)
const rowOf = (name: string) => rows().find((row) => row.querySelector('a')!.textContent === name)!
async function pick(user: ReturnType<typeof userEvent.setup>, chip: RegExp, option: string) {
  await user.click(within(recentCard()).getByRole('button', { name: chip }))
  await user.click(screen.getByRole('option', { name: option }))
}

// ---------------------------------------------------------------- Recent Campaigns
test('a table of the six most recent, with the mockup’s rows and figures', () => {
  renderHome()
  const table = within(recentCard()).getByRole('table')
  expect(table.querySelector('caption')!.textContent).toBe('Recent campaigns')
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Campaign', 'Status', 'Delivered', 'Open Rate', 'Revenue vs. Target'])
  expect(table.querySelector('thead')!.className).toContain('bg-surface-subtle')
  expect(within(recentCard()).getByText('Showing 6 of 15')).toBeTruthy()
  expect(names()).toEqual(['October Newsletter', 'Holiday Preview', 'Gift Guide 2026', 'Weekend Flash Deal', 'Black Friday Early Access', 'Fall Boots Launch'])
  expect(rows()[0].className).toContain('h-16')

  const flash = rowOf('Weekend Flash Deal')
  expect(cells(flash).slice(1)).toEqual(['Production Published', '96,200', 'Not Tracked', '$24.9K45%'])
  expect(within(flash).getByRole('img', { name: 'SMS' })).toBeTruthy()                                          // the channel, as an icon before the name
  expect(within(flash).getByText('Not Tracked').className).toContain('whitespace-nowrap')
  const boots = rowOf('Fall Boots Launch')
  expect(cells(boots).slice(1)).toEqual(['Production Published', '286,400', '36.8%', '$312.8K112%'])
  expect(within(boots).getByRole('img', { name: 'Email' })).toBeTruthy()
  expect((boots.querySelector('[data-target-bar] > span') as HTMLElement).style.width).toBe('100%')          // 112% fills the bar, no further
  expect((flash.querySelector('[data-target-bar] > span') as HTMLElement).style.width).toBe('45%')
  expect(cells(rowOf('Holiday Preview')).slice(2)).toEqual(['—', '—', '—'])
  expect(within(boots).getByRole('link', { name: 'Fall Boots Launch' }).getAttribute('href')).toBe('/campaigns/c06')
})

test('each context line says the type and what happened, scheduled sends with the zone', () => {
  renderHome()
  const context = (name: string) => rowOf(name).querySelectorAll('td')[0].querySelectorAll('span[class*="text-helper"]')[0].textContent
  expect(context('October Newsletter')).toMatch(/^Regular · sends \d{1,2} [A-Z][a-z]{2} \d{4}, 08:00 E[DS]T$/)
  expect(context('Holiday Preview')).toMatch(/^Regular · edited \d{1,2} [A-Z][a-z]{2} \d{4}$/)
  expect(context('Gift Guide 2026')).toMatch(/^Regular · test sent \d{1,2} [A-Z][a-z]{2} \d{4}$/)
  expect(context('Fall Boots Launch')).toMatch(/^Regular · sent \d{1,2} [A-Z][a-z]{2} \d{4}$/)
})

test('Sort: best performing by revenue against target, needs attention failures and awaiting publish first; the chip never looks active', async () => {
  const user = userEvent.setup()
  renderHome()
  await pick(user, /^Sort: Most Recent$/, 'Best Performing')
  expect(names()).toEqual(['Store Opening, Austin Domain Northside', 'Fall Boots Launch', 'Loyalty Points Statement',
    'VIP Early Access: Autumn Collection for Platinum and Gold Members', 'Back to School Bundles', 'Weekly Deals Digest'])
  const sort = within(recentCard()).getByRole('button', { name: 'Sort: Best Performing' })
  expect(sort.className).not.toContain('bg-brand-100')
  await pick(user, /^Sort: Best Performing$/, 'Needs Attention')
  expect(names().slice(0, 3)).toEqual(['Fall Denim Drop', 'Gift Guide 2026', 'October Newsletter'])
})

test('Status: Live includes sending now; Scheduled and Draft; the chip goes active; Clear Filters resets both; View All carries status and channel', async () => {
  const user = userEvent.setup()
  renderHome({ url: '/?channel=EMAIL' })
  expect(within(recentCard()).queryByRole('button', { name: 'Clear Filters' })).toBeNull()
  await pick(user, /^All Statuses$/, 'Live')
  expect(names()).toContain('VIP Early Access: Autumn Collection for Platinum and Gold Members')
  expect(rows().every((row) => /Production Published|Sending/.test(row.textContent!))).toBe(true)
  expect(within(recentCard()).getByRole('button', { name: 'Live' }).className).toContain('border-brand-600 bg-brand-100 text-brand-800')
  const viewAll = new URL(within(recentCard()).getByRole('link', { name: 'View All Campaigns' }).getAttribute('href')!, 'http://x')
  expect(viewAll.pathname).toBe('/campaigns')
  expect([viewAll.searchParams.get('status'), viewAll.searchParams.get('channel')]).toEqual(['PRODUCTION_PUBLISHED,ACTIVE', 'EMAIL'])
  expect(rowOf('VIP Early Access: Autumn Collection for Platinum and Gold Members').textContent).toContain('sending now')

  await pick(user, /^Live$/, 'Draft')
  expect(names()).toEqual(['Holiday Preview'])                                                                 // Black Friday is SMS
  await pick(user, /^Draft$/, 'Scheduled')
  expect(names()).toEqual(['October Newsletter'])
  await user.click(within(recentCard()).getByRole('button', { name: 'Clear Filters' }))
  expect(within(recentCard()).getByRole('button', { name: 'All Statuses' })).toBeTruthy()
  expect(within(recentCard()).getByRole('button', { name: 'Sort: Most Recent' })).toBeTruthy()
})

test('no attribution: Revenue vs. Target says Not Set Up; nothing matching: one line; narrow screens drop columns', async () => {
  renderHome({ state: 'noAttribution' })
  expect(cells(rowOf('Fall Boots Launch'))[4]).toBe('Not Set Up')
  expect(document.body.textContent).not.toContain('$0')
  const table = within(recentCard()).getByRole('table')
  expect(within(table).queryByRole('columnheader', { name: 'Channel' })).toBeNull()
  expect(within(table).getByRole('columnheader', { name: 'Delivered' }).className).toContain('hidden @min-[520px]:table-cell')           // by the card's width
  expect(within(table).getByRole('columnheader', { name: 'Open Rate' }).className).toContain('hidden @min-[440px]:table-cell')
  cleanup()

  const user = userEvent.setup()
  renderHome({ url: '/?channel=MMS' })
  await pick(user, /^All Statuses$/, 'Scheduled')
  expect(recentCard().textContent).toContain('No campaigns match these filters.')
  expect(within(recentCard()).getAllByRole('button', { name: 'Clear Filters' }).length).toBeGreaterThan(0)
})

// ---------------------------------------------------------------- Governance
const governance = () => screen.getByRole('region', { name: 'Governance' })

test('Governance: contacted and held back, a bar split by reason, and the breakdown; the link is for admins', () => {
  renderHome()
  expect(governance().textContent).toContain('412,380Customers Contacted')
  expect(governance().textContent).toContain('38,940Held Back · 8.6%')
  const segments = [...governance().querySelectorAll('[data-reason]')] as HTMLElement[]
  expect(segments.map((segment) => [segment.getAttribute('data-reason'), segment.style.flexGrow])).toEqual([['frequencyCap', '21300'], ['noConsent', '9840'], ['suppression', '7800']])
  expect(segments.map((segment) => segment.className.match(/bg-chart-\d/)![0])).toEqual(['bg-chart-1', 'bg-chart-5', 'bg-chart-6'])
  expect(governance().querySelector('[data-held-back-bar]')!.getAttribute('aria-hidden')).toBe('true')
  expect(within(within(governance()).getByRole('list', { name: 'Held back by reason' })).getAllByRole('listitem').map((item) => item.textContent))
    .toEqual(['Frequency Cap21,30055%', 'No Consent9,84025%', 'Suppression List7,80020%'])
  expect(within(governance()).getByRole('link', { name: 'Open Governance' }).getAttribute('href')).toBe('/settings/suppressions')
  cleanup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, can: (permission) => permission !== 'user.admin' } })
  expect(within(governance()).queryByRole('link')).toBeNull()
  cleanup()
  renderHome({ source: { ...createSampleSource('busy'), useGovernance: () => ({ status: 'unavailable' }) } })
  expect(screen.queryByRole('region', { name: 'Governance' })).toBeNull()
})

// ---------------------------------------------------------------- E-Receipts
const receipts = () => screen.queryByRole('region', { name: 'E-Receipts' })

test('E-Receipts: four figures and the note; Not Set Up without attribution; the link to e-receipt campaigns', () => {
  renderHome()
  const figures = [...receipts()!.querySelectorAll('[data-receipts] > div')].map((figure) => figure.textContent)
  expect(figures).toEqual(['214,600Receipts Sent', '61.2%Open Rate', '8,940Offer Clicks', '$48.2KRevenue from Receipt Offers'])
  expect(receipts()!.textContent).toContain('Excluded from marketing metrics and frequency caps.')
  expect(within(receipts()!).getByRole('link', { name: 'View E-Receipts' }).getAttribute('href')).toBe('/campaigns?type=E_RECEIPT')
  expect(governance().closest('[data-side-column]')).toBe(receipts()!.closest('[data-side-column]'))
  cleanup()
  renderHome({ state: 'noAttribution' })
  expect(within(receipts()!).getByText('Not Set Up').className).toContain('text-xl text-ink-800')
})

test('E-Receipts ignore Home’s Campaign and Channel filters, and hide without the feature, in the light workspace and for one campaign', () => {
  renderHome({ url: '/?campaigns=c06,c04&channel=SMS' })
  expect(receipts()!.textContent).toContain('214,600')
  cleanup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'ereceipt' } })
  expect(receipts()).toBeNull()
  cleanup()
  renderHome({ state: 'light' })
  expect(receipts()).toBeNull()
  cleanup()
  renderHome({ url: '/?campaigns=c06' })
  expect(receipts()).toBeNull()
  expect(governance().closest('[data-row]')!.getAttribute('data-row')).toBe('b')
})

test('no placeholder is left on Home', () => {
  renderHome()
  expect(document.body.textContent).not.toMatch(/arrives in phase/)
})
