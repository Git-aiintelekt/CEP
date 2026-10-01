import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from '../HomePage'
import { HomeDataProvider } from '../data/HomeDataProvider'
import { liveSource } from '../data/liveSource'
import { createSampleSource, type SampleState } from '../data/sampleSource'
import { SAMPLE_VIEWER } from '../data/sampleViewer'
import type { AttentionGroup, HomeDataSource, HomeViewer, SectionResult, Attention } from '../data/types'

afterEach(cleanup)

const renderHome = ({ url = '/', state = 'busy', source, viewer = SAMPLE_VIEWER }: { url?: string; state?: SampleState; source?: HomeDataSource; viewer?: HomeViewer } = {}) =>
  render(<MemoryRouter initialEntries={[url]}><HomeDataProvider source={source ?? createSampleSource(state)} viewer={viewer}><HomePage /></HomeDataProvider></MemoryRouter>)
const withAttention = (result: SectionResult<Attention>): HomeDataSource => ({ ...createSampleSource('busy'), useAttention: () => result })
const group = (id: string, severity: AttentionGroup['severity'], count: number): AttentionGroup => ({ id, severity, category: severity, count, label: `${id} label`, actionLabel: `${id} action`, href: `/go/${id}` })
const attention = () => screen.getByRole('region', { name: 'Needs Attention' })
const tile = (label: string) => document.querySelector(`[data-kpi="${label}"]`) as HTMLElement
const member = (denied: string[]): HomeViewer => ({ ...SAMPLE_VIEWER, can: (permission) => !denied.includes(permission) })

// ---------------------------------------------------------------- Needs Attention
test('alert cells: red, then amber, then periwinkle, larger counts first; four until View All; each cell one link', async () => {
  const user = userEvent.setup()
  renderHome({ source: withAttention({ status: 'ready', data: { freshness: 'Updated today at 6:00 AM', groups: [
    group('gov', 'governance', 900), group('block-small', 'blocking', 1), group('crit-small', 'critical', 2), group('block-big', 'blocking', 7), group('crit-big', 'critical', 5),
  ] } }) })
  const cards = () => within(attention()).getAllByRole('link')
  expect(cards().map((card) => card.getAttribute('data-alert'))).toEqual(['crit-big', 'crit-small', 'block-big', 'block-small'])
  const first = cards()[0]
  expect(first.getAttribute('href')).toBe('/go/crit-big')
  expect(first.querySelector('a')).toBeNull()
  expect(first.className).toContain('hover:bg-surface-subtle')
  expect(first.querySelector('[data-severity-icon="critical"]')).toBeTruthy()                                   // the icon on its tint, the category in words beside it
  expect(first.textContent).toContain('crit-big label')
  expect(first.textContent).toContain('crit-big action')
  expect(first.closest('ul')!.className).toContain('flex-wrap')                                                   // one strip; cells wrap whole, never squeeze
  expect(first.querySelector('.lucide-arrow-right')).toBeTruthy()
  expect(within(attention()).getByText('Updated today at 6:00 AM')).toBeTruthy()

  const toggle = within(attention()).getByRole('button', { name: 'View All (5)' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  await user.click(toggle)
  expect(cards()).toHaveLength(5)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(toggle.textContent).toBe('Show Fewer')
  await user.click(toggle)
  expect(cards()).toHaveLength(4)
})

test('the count badge takes the tint of the most severe group', () => {
  const badge = () => attention().querySelector('[data-count-badge]')!.className
  renderHome()
  expect(badge()).toContain('bg-danger-bg text-danger-text')
  cleanup()
  renderHome({ source: withAttention({ status: 'ready', data: { freshness: 'x', groups: [group('a', 'governance', 3), group('b', 'blocking', 1)] } }) })
  expect(badge()).toContain('bg-warning-bg text-warning-text')
  expect(within(attention()).queryByRole('button', { name: /View All/ })).toBeNull()
  cleanup()
  renderHome({ source: withAttention({ status: 'ready', data: { freshness: 'x', groups: [group('a', 'governance', 3)] } }) })
  expect(badge()).toContain('bg-callout-bg text-callout-text')
})

test('no alerts, unavailable or forbidden: no Needs Attention at all, not even its heading or freshness line', () => {
  renderHome({ state: 'noAlerts' })
  expect(screen.queryByRole('region', { name: 'Needs Attention' })).toBeNull()
  expect(screen.queryByText('Needs Attention')).toBeNull()
  expect(screen.queryByText('Updated today at 6:00 AM')).toBeNull()
  cleanup()
  renderHome({ source: withAttention({ status: 'unavailable' }) })
  expect(screen.queryByRole('region', { name: 'Needs Attention' })).toBeNull()
  cleanup()
  renderHome({ url: '/?campaigns=c02' })                                                                        // a campaign with no alerts
  expect(screen.queryByRole('region', { name: 'Needs Attention' })).toBeNull()
})

test('alerts loading show four placeholder cells; an error keeps the section and shows Try Again', () => {
  renderHome({ source: withAttention({ status: 'loading' }) })
  expect(document.querySelector('[data-attention="loading"]')!.children).toHaveLength(4)
  cleanup()
  renderHome({ source: withAttention({ status: 'error', error: new Error('Down'), retry: () => undefined }) })
  expect(within(attention()).getByRole('alert').textContent).toContain('Try Again')
})

// ---------------------------------------------------------------- Marketing Performance
test('busy: the six tiles in order with the mockup’s figures, % for counts and money, pt for rates and shares', () => {
  renderHome()
  const strip = screen.getByRole('group', { name: 'Marketing Performance' })
  expect([...strip.querySelectorAll('[data-kpi]')].map((node) => node.getAttribute('data-kpi')))
    .toEqual(['Delivered', 'Open Rate', 'Click Rate', 'Conversions', 'Attributed Revenue', 'Campaign Contribution'])
  expect(tile('Delivered').textContent).toContain('1,584,560')
  expect(tile('Delivered').textContent).toContain('52,819 per day')
  expect(within(tile('Delivered')).getByRole('img').getAttribute('aria-label')).toBe('Up 6.2% on the previous period')
  expect(tile('Open Rate').textContent).toContain('Email Only')
  expect(tile('Open Rate').textContent).toContain('37.5%')
  expect(tile('Open Rate').textContent).toContain('427,821 opened')
  expect(within(tile('Open Rate')).getByRole('img').getAttribute('aria-label')).toBe('Up 1.1 pt on the previous period')
  expect(within(tile('Open Rate')).getByText('Good')).toBeTruthy()
  expect(tile('Click Rate').textContent).toContain('3.9%')
  expect(tile('Click Rate').textContent).toContain('61,405 clicks')
  expect(within(tile('Click Rate')).getByRole('img').getAttribute('aria-label')).toBe('Down 0.3 pt on the previous period')
  expect(within(tile('Click Rate')).getByText('Fair')).toBeTruthy()
  expect(tile('Conversions').textContent).toContain('15,890')
  expect(tile('Conversions').textContent).toContain('25.9% of clicks')
  expect(tile('Attributed Revenue').textContent).toContain('$1.39M')
  expect(tile('Attributed Revenue').textContent).toContain('95% of $1.47M target')
  expect(within(tile('Attributed Revenue')).getByRole('progressbar')).toBeTruthy()
  expect(strip.textContent).not.toMatch(/Lowest|Furthest Behind/)
  expect(tile('Campaign Contribution').textContent).toContain('14.5%')
  expect(tile('Campaign Contribution').textContent).toContain('of $9.60M store revenue')
  expect(within(tile('Campaign Contribution')).getByRole('img').getAttribute('aria-label')).toBe('Up 0.6 pt on the previous period')
})

test('SMS: Open Rate is Not Tracked, "SMS does not report opens"; MMS says MMS', () => {
  renderHome({ url: '/?channel=SMS' })
  expect(tile('Open Rate').textContent).toContain('Not Tracked')
  expect(tile('Open Rate').textContent).toContain('SMS does not report opens')
  expect(tile('Open Rate').textContent).not.toContain('Email Only')
  cleanup()
  renderHome({ url: '/?channel=MMS' })
  expect(tile('Open Rate').textContent).toContain('MMS does not report opens')
})

test('no attribution: both revenue tiles Not Set Up Yet, a link for admins, a sentence for others, and never $0', () => {
  renderHome({ state: 'noAttribution' })
  for (const label of ['Attributed Revenue', 'Campaign Contribution']) {
    expect(tile(label).textContent).toContain('Not Set Up Yet')
    expect(within(tile(label)).getByRole('link', { name: 'Set Up Attribution' }).getAttribute('href')).toBe('/settings/integrations')
  }
  cleanup()
  renderHome({ state: 'noAttribution', viewer: member(['user.admin']) })
  for (const label of ['Attributed Revenue', 'Campaign Contribution']) {
    expect(within(tile(label)).queryByRole('link')).toBeNull()
    expect(tile(label).textContent).toContain('Ask an admin to set up attribution.')
  }
  expect(document.body.textContent).not.toContain('$0')
})

test('one campaign: a draft shows "—" rates with no tags or chips', () => {
  renderHome({ url: '/?campaigns=c02' })                                                                         // Holiday Preview, a draft
  for (const label of ['Open Rate', 'Click Rate']) {
    expect(within(tile(label)).getByText('—')).toBeTruthy()
    expect(within(tile(label)).queryByRole('img')).toBeNull()
    expect(tile(label).textContent).not.toMatch(/Good|Fair|Poor|0\.0%/)
  }
})

test('without report.view the strip is one line; the filters stay', () => {
  renderHome({ viewer: member(['report.view']) })
  expect(screen.queryByRole('group', { name: 'Marketing Performance' })).toBeNull()
  expect(screen.getByText('You don’t have access to performance reports.').className).toContain('border border-line')
  expect(screen.getByRole('group', { name: 'Filters' })).toBeTruthy()
})

// ---------------------------------------------------------------- Create New
test('Create New: one button per permission beside the greeting, each a link; Journey needs the feature, the permission and a create flow', () => {
  renderHome()
  const tiles = () => within(screen.getByRole('region', { name: 'Create New' })).getAllByRole('link')
  expect(tiles().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Campaign', '/campaigns/new'], ['Journey', '/'], ['Template', '/templates/new'], ['Contact List', '/contact-lists?new=1'],   // the sample's "#" stays on the page
  ])
  expect(tiles()[0].className).toContain('h-10')
  expect(tiles()[0].querySelector('.bg-plum-100')).toBeTruthy()
  cleanup()
  renderHome({ viewer: member(['template.edit', 'journey.edit']) })
  expect(tiles().map((link) => link.textContent)).toEqual(['Campaign', 'Contact List'])
  cleanup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'journeys' } })
  expect(tiles().map((link) => link.textContent)).not.toContain('Journey')
  cleanup()
  renderHome({ source: { ...createSampleSource('busy'), capabilities: liveSource.capabilities } })
  expect(tiles().map((link) => link.textContent)).toEqual(['Campaign', 'Template', 'Contact List'])            // no journey create flow yet
})

test('a viewer with no create permission gets no Create New section at all', () => {
  renderHome({ viewer: member(['campaign.edit', 'template.edit', 'list.edit', 'journey.edit']) })
  expect(screen.queryByRole('region', { name: 'Create New' })).toBeNull()
})
