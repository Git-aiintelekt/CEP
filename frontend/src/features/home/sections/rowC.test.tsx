import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from '../HomePage'
import { HomeDataProvider } from '../data/HomeDataProvider'
import { createSampleSource, type SampleState } from '../data/sampleSource'
import { SAMPLE_VIEWER } from '../data/sampleViewer'
import type { HomeDataSource, HomeViewer } from '../data/types'
import { capCompliance } from '../capCompliance'

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
test('a table of the six most recent, two thirds wide beside Governance: campaign, status, channel, delivered, open rate, revenue vs. target, owner', () => {
  renderHome()
  const table = within(recentCard()).getByRole('table')
  expect(table.querySelector('caption')!.textContent).toBe('Recent campaigns')
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Campaign', 'Status', 'Channel', 'Delivered', 'Open Rate', 'Revenue vs. Target', 'Owner'])
  expect(table.querySelector('thead')!.className).toContain('bg-surface-subtle')
  expect(within(recentCard()).getByText('Showing 6 of 15')).toBeTruthy()
  expect(recentCard().closest('[data-row]')!.getAttribute('data-layout')).toBe('2:1')
  expect(recentCard().closest('[data-row]')!.contains(governance())).toBe(true)
  expect(names()).toEqual(['October Newsletter', 'Holiday Preview', 'Gift Guide 2026', 'Weekend Flash Deal', 'Black Friday Early Access', 'Fall Boots Launch'])
  expect(rows()[0].className).toContain('h-16')

  const flash = rowOf('Weekend Flash Deal')
  expect(cells(flash).slice(1)).toEqual(['Production Published', 'SMS', '96,200', 'Not Tracked', '$24.9K45% of target', 'MPMaya Patel'])
  expect(within(flash).getByText('Not Tracked').className).toContain('whitespace-nowrap')
  const boots = rowOf('Fall Boots Launch')
  expect(cells(boots).slice(1)).toEqual(['Production Published', 'Email', '286,400', '36.8%', '$312.8K112% of target', 'MMarketing'])
  expect(cells(rowOf('Holiday Preview')).slice(3, 6)).toEqual(['—', '—', '—'])
  expect(within(boots).getByRole('link', { name: 'Fall Boots Launch' }).getAttribute('href')).toBe('/campaigns/c06')
  expect(within(boots).getByRole('link', { name: 'Fall Boots Launch' }).className).toContain('font-semibold')
})

test('each context line says the type and what happened, scheduled sends with the zone', () => {
  renderHome()
  const context = (name: string) => rowOf(name).querySelectorAll('td')[0].querySelectorAll('span[class*="text-xs"]')[0].textContent
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
  expect(within(recentCard()).getByRole('button', { name: 'Live' }).className).toContain('border-link bg-brand-100 text-brand-800')
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

test('no attribution: Revenue says Not Set Up; nothing matching: one line; narrow cards drop columns and tuck the status under the name', async () => {
  renderHome({ state: 'noAttribution' })
  expect(cells(rowOf('Fall Boots Launch'))[5]).toBe('Not Set Up')
  expect(document.body.textContent).not.toContain('$0')
  const table = within(recentCard()).getByRole('table')
  expect(within(table).getByRole('columnheader', { name: 'Owner' }).className).toContain('hidden @min-[760px]:table-cell')           // by the card's width
  expect(within(table).getByRole('columnheader', { name: 'Open Rate' }).className).toContain('hidden @min-[760px]:table-cell')
  expect(within(table).getByRole('columnheader', { name: 'Channel' }).className).toContain('hidden @min-[600px]:table-cell')
  expect(within(table).getByRole('columnheader', { name: 'Status' }).className).toContain('hidden @min-[480px]:table-cell')
  expect(rowOf('Fall Boots Launch').querySelector('td .\\@min-\\[480px\\]\\:hidden')).toBeTruthy()
  cleanup()

  const user = userEvent.setup()
  renderHome({ url: '/?channel=MMS' })
  await pick(user, /^All Statuses$/, 'Scheduled')
  expect(recentCard().textContent).toContain('No campaigns match these filters.')
  expect(within(recentCard()).getAllByRole('button', { name: 'Clear Filters' }).length).toBeGreaterThan(0)
})

// ---------------------------------------------------------------- Governance
const governance = () => screen.getByRole('region', { name: 'Governance' })
const figures = (card: HTMLElement) => [...card.querySelectorAll('[data-figure]')].map((figure) => figure.textContent)

test('Governance: contacted and held back as figures, the frequency cap compliance bar, and the reasons when consent or suppression held people back; the link is for admins', () => {
  renderHome()
  expect(figures(governance())).toEqual(['Customers Contacted412,380', 'Held Back38,9408.6%'])
  expect(governance().querySelector('[data-compliance]')!.textContent).toBe('95.3%')
  const bar = within(governance()).getByRole('progressbar', { name: 'Frequency cap compliance' })
  expect(bar.getAttribute('aria-valuenow')).toBe('95')
  expect((bar.firstElementChild as HTMLElement).style.width).toMatch(/^95\.28/)
  expect(within(within(governance()).getByRole('list', { name: 'Held back by reason' })).getAllByRole('listitem').map((item) => item.textContent))
    .toEqual(['Frequency Cap21,30055%', 'No Consent9,84025%', 'Suppression List7,80020%'])
  expect(governance().querySelector('[data-no-issues]')).toBeNull()
  expect(within(governance()).getByRole('link', { name: 'Open Governance' }).getAttribute('href')).toBe('/settings/suppressions')
  cleanup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, can: (permission) => permission !== 'user.admin' } })
  expect(within(governance()).queryByRole('link')).toBeNull()
  cleanup()
  renderHome({ source: { ...createSampleSource('busy'), useGovernance: () => ({ status: 'unavailable' }) } })
  expect(screen.queryByRole('region', { name: 'Governance' })).toBeNull()
})

test('nobody held back for consent or suppression: the all-clear sentence instead of the reasons; compliance reads 100% whole', () => {
  renderHome({ source: { ...createSampleSource('busy'), useGovernance: () => ({ status: 'ready', data: { contacted: 106, heldBack: 0, reasons: { frequencyCap: 0, noConsent: 0, suppression: 0 } } }) } })
  expect(figures(governance())).toEqual(['Customers Contacted106', 'Held Back0'])
  expect(governance().querySelector('[data-compliance]')!.textContent).toBe('100%')
  expect(governance().textContent).toContain('No consent or suppression issues detected in the selected period.')
  expect(within(governance()).queryByRole('list')).toBeNull()
  expect(capCompliance({ contacted: 0, heldBack: 0, reasons: { frequencyCap: 0, noConsent: 0, suppression: 0 } })).toBe(100)
  expect(capCompliance({ contacted: 90, heldBack: 10, reasons: { frequencyCap: 10, noConsent: 0, suppression: 0 } })).toBe(90)
})

// ---------------------------------------------------------------- E-Receipts
const receipts = () => screen.queryByRole('region', { name: 'E-Receipts' })

test('E-Receipts: four figures and the note; Not Set Up without attribution; the link to e-receipt campaigns; beside the Channel Snapshot', () => {
  renderHome()
  expect(figures(receipts()!)).toEqual(['Receipts Sent214,600', 'Open Rate61.2%', 'Offer Clicks8,940', 'Revenue from Receipt Offers$48.2K'])
  expect(receipts()!.querySelector('[data-receipts]')!.className).toContain('grid-cols-2')
  expect(receipts()!.textContent).toContain('Excluded from marketing metrics and frequency caps.')
  expect(within(receipts()!).getByRole('link', { name: 'View E-Receipts' }).getAttribute('href')).toBe('/campaigns?type=E_RECEIPT')
  expect(screen.getByRole('region', { name: 'Channel Snapshot' }).closest('[data-row]')).toBe(receipts()!.closest('[data-row]'))
  expect(receipts()!.closest('[data-row]')!.getAttribute('data-layout')).toBe('2:1')
  cleanup()
  renderHome({ state: 'noAttribution' })
  expect(within(receipts()!).getByText('Not Set Up').className).toContain('text-section-title text-ink-800')
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
