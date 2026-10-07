import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from '../HomePage'
import { HomeDataProvider } from '../data/HomeDataProvider'
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
test('alert cards: red, then amber, then periwinkle, larger counts first; three cards until View All; each card one link', async () => {
  const user = userEvent.setup()
  renderHome({ source: withAttention({ status: 'ready', data: { freshness: 'Updated today at 6:00 AM', groups: [
    group('gov', 'governance', 900), group('block-small', 'blocking', 1), group('crit-small', 'critical', 2), group('block-big', 'blocking', 7), group('crit-big', 'critical', 5),
  ] } }) })
  const cards = () => [...attention().querySelectorAll('[data-alert]')] as HTMLElement[]
  expect(cards().map((card) => card.getAttribute('data-alert'))).toEqual(['crit-big', 'crit-small'])                     // the opportunity card takes the third slot
  const first = cards()[0]
  expect(first.tagName).toBe('LI')
  expect(first.className).toContain('rounded-lg border border-line bg-surface')
  expect(first.querySelector('[data-severity-icon="critical"]')).toBeTruthy()                                   // the icon on its tint, the count and category in words beside it
  expect(first.textContent).toContain('5 critical')
  expect(first.textContent).toContain('crit-big label')
  expect(within(first).getByRole('link', { name: 'crit-big action' }).getAttribute('href')).toBe('/go/crit-big')
  expect(within(first).getAllByRole('link')).toHaveLength(1)
  expect(first.closest('ul')!.className).toContain('@min-[1100px]:grid-cols-3')                                 // three cards across on a wide page
  expect(within(attention()).getByText('Updated today at 6:00 AM')).toBeTruthy()

  const toggle = within(attention()).getByRole('button', { name: 'View All (5)' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  await user.click(toggle)
  expect(cards()).toHaveLength(5)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(toggle.textContent).toBe('Show Fewer')
  await user.click(toggle)
  expect(cards()).toHaveLength(2)
  cleanup()
  renderHome({ source: { ...withAttention({ status: 'ready', data: { freshness: 'x', groups: [group('a', 'critical', 1), group('b', 'blocking', 1), group('c', 'governance', 1)] } }), useFunnel: () => ({ status: 'ready', data: [] }) } })
  expect(cards()).toHaveLength(3)                                                                                 // no opportunity: three alerts
  expect(within(attention()).queryByRole('button', { name: /View All/ })).toBeNull()
})

test('the opportunity card: the channel converting best against the others, from the funnel; nothing with one channel', () => {
  renderHome()
  const insight = attention().querySelector('[data-insight]') as HTMLElement
  expect(insight.textContent).toContain('Opportunity: Email is driving strongest conversion')
  expect(insight.textContent).toMatch(/Open rate is \d+%; SMS and MMS engagement is lower\./)
  expect(within(insight).getByRole('link', { name: 'View Insight' }).getAttribute('href')).toBe('/reports')
  cleanup()
  renderHome({ url: '/?channel=EMAIL' })
  expect(attention().querySelector('[data-insight]')).toBeNull()
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

test('alerts loading show three placeholder cards; an error keeps the section and shows Try Again', () => {
  renderHome({ source: withAttention({ status: 'loading' }) })
  expect(document.querySelector('[data-attention="loading"]')!.children).toHaveLength(3)
  cleanup()
  renderHome({ source: withAttention({ status: 'error', error: new Error('Down'), retry: () => undefined }) })
  expect(within(attention()).getByRole('alert').textContent).toContain('Try Again')
})

// ---------------------------------------------------------------- Key Figures
test('busy: the two heroes then the four ring KPIs with the mockup’s figures, % for counts and money, pt for rates and shares', () => {
  renderHome()
  const strip = screen.getByRole('group', { name: 'Key Figures' })
  expect([...strip.querySelectorAll('[data-kpi]')].map((node) => node.getAttribute('data-kpi')))
    .toEqual(['Attributed Revenue', 'Campaign ROI', 'Delivered', 'Open Rate', 'Click Rate', 'Conversions'])
  expect(tile('Delivered').className).toContain('rounded-lg border border-line bg-surface')                   // each figure its own card
  expect(tile('Delivered').querySelector('[data-ring]')).toBeTruthy()
  expect(tile('Delivered').textContent).toContain('1,584,560')
  expect(tile('Delivered').textContent).toContain('52,819 sends per day')
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
  expect(tile('Conversions').textContent).toContain('Steady click-to-conversion')
  expect(tile('Attributed Revenue').textContent).toContain('$1.39M')
  expect(tile('Attributed Revenue').textContent).toContain('95% of $1.47M goal')
  expect(tile('Attributed Revenue').querySelector('[data-hero-goal]')!.className).toContain('text-warning')         // under the goal
  expect(tile('Attributed Revenue').textContent).toContain('+9.7% on the previous period')
  expect(tile('Attributed Revenue').querySelector('[data-sparkline]')).toBeTruthy()
  expect(strip.textContent).not.toMatch(/Lowest|Furthest Behind/)
  expect(tile('Campaign ROI').textContent).toContain('12.5×')
  expect(within(tile('Campaign ROI')).getByText('High Return')).toBeTruthy()
  expect(tile('Campaign ROI').textContent).toContain('$111.3K campaign cost')
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
  for (const label of ['Attributed Revenue', 'Campaign ROI']) {
    expect(tile(label).textContent).toContain('Not Set Up Yet')
    expect(within(tile(label)).getByRole('link', { name: 'Set Up Attribution' }).getAttribute('href')).toBe('/settings/attribution')
  }
  cleanup()
  renderHome({ state: 'noAttribution', viewer: member(['user.admin']) })
  for (const label of ['Attributed Revenue', 'Campaign ROI']) {
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
  expect(screen.queryByRole('group', { name: 'Key Figures' })).toBeNull()
  expect(screen.getByText('You don’t have access to performance reports.').className).toContain('border border-line')
  expect(screen.getByRole('group', { name: 'Filters' })).toBeTruthy()
})

// ---------------------------------------------------------------- Create New
test('Create New: Contact List, Template and Journey outlined, Create Campaign filled, each by permission; each a button for its pop-up, never a link', () => {
  renderHome()
  const tiles = () => within(screen.getByRole('region', { name: 'Create New' })).getAllByRole('button')
  expect(tiles().map((button) => button.textContent)).toEqual(['Contact List', 'Template', 'Journey', 'Create Campaign'])
  expect(within(screen.getByRole('region', { name: 'Create New' })).queryAllByRole('link')).toHaveLength(0)
  expect(tiles().every((button) => button.getAttribute('aria-haspopup') === 'dialog')).toBe(true)
  expect(tiles()[3].className).toContain('bg-brand-600')
  expect(tiles()[0].className).not.toContain('bg-brand-600')
  expect(tiles()[0].className).toContain('border-line-control')                                                // Home's neutral outline
  expect(tiles()[0].querySelector('svg')).toBeTruthy()
  cleanup()
  renderHome({ viewer: member(['template.edit', 'journey.edit']) })
  expect(tiles().map((button) => button.textContent)).toEqual(['Contact List', 'Create Campaign'])
  cleanup()
  renderHome({ viewer: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'journeys' } })
  expect(tiles().map((button) => button.textContent)).toEqual(['Contact List', 'Template', 'Create Campaign'])
})

test('a viewer with no create permission gets no Create New section at all', () => {
  renderHome({ viewer: member(['campaign.edit', 'template.edit', 'list.edit', 'journey.edit']) })
  expect(screen.queryByRole('region', { name: 'Create New' })).toBeNull()
})

// ---------------------------------------------------------------- drips
test('Drip Problems: one grouped card with each problem’s sentence and its own link; with one problem it reads like any other card', async () => {
  const items = [
    { id: 'f', text: 'Message 3 of Loyalty Welcome Series failed. No one received it.', actionLabel: 'Review', href: '/campaigns/d1' },
    { id: 'p', text: 'Holiday Reminder Texts has been paused for 3 days. Message 2 was due Fri 16 Oct.', actionLabel: 'Open', href: '/campaigns/d2' },
  ]
  const drips: AttentionGroup = { id: 'drip-problems', severity: 'critical', category: 'Drip Problems', count: 2, label: items[0].text, actionLabel: 'Review', href: '/campaigns/d1', items }
  renderHome({ source: withAttention({ status: 'ready', data: { freshness: 'Updated today at 6:00 AM', groups: [drips] } }) })
  const card = attention().querySelector('[data-alert="drip-problems"]') as HTMLElement
  expect(card.className).toContain('rounded-lg border border-line bg-surface')
  expect(card.textContent).toContain('2 Drip Problems')
  expect(within(card).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['Review', '/campaigns/d1'], ['Open', '/campaigns/d2']])
  expect(within(card).getByText(items[1].text)).toBeTruthy()

  cleanup()
  renderHome({ source: withAttention({ status: 'ready', data: { freshness: 'Updated today at 6:00 AM', groups: [{ ...drips, category: 'Drip Problem', count: 1, items: [items[1]] }] } }) })
  const one = attention().querySelector('[data-alert="drip-problems"]') as HTMLElement
  expect(one.textContent).toBe(`1 Drip Problem${items[1].text}Open`)
})

test('the sample Home shows the drip states: Drip Problems, a drip message in Next 7 Days, and Recent’s progress line', async () => {
  const user = userEvent.setup()
  renderHome()
  await user.click(within(attention()).getByRole('button', { name: /^View All/ }))
  expect(attention().querySelector('[data-alert="drip-problems"]')!.textContent).toContain('Message 3 of Back to School Bundles failed. No one received it.')
  await user.click(within(screen.getByRole('radiogroup', { name: 'Pick a day' })).getAllByRole('radio')[1])
  const run = [...document.querySelectorAll('[data-run]')].find((row) => row.textContent?.includes('Back to School Bundles · Message 4 of 5'))!
  expect(run.textContent).toMatch(/· 08:00 E[DS]?T/)
  expect(run.textContent).toContain('Drip · Email')
  const recent = createSampleSource('busy').useRecentCampaigns({ campaignIds: [], channel: 'ALL', period: '30d' })
  expect(recent.status === 'ready' && recent.data.rows.find((row) => row.id === 'c09')?.contextLine).toBe('Drip · 3 of 5 messages sent')
})
