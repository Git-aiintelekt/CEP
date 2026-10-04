import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from '../HomePage'
import { HomeDataProvider } from '../data/HomeDataProvider'
import { createSampleSource, type SampleState } from '../data/sampleSource'
import { SAMPLE_VIEWER } from '../data/sampleViewer'
import type { HomeDataSource, HomeViewer, RevenueCostSeries } from '../data/types'
import { revenueInsight } from '../revenueInsight'

afterEach(cleanup)

const renderHome = ({ url = '/', state = 'busy', source, viewer = SAMPLE_VIEWER }: { url?: string; state?: SampleState; source?: HomeDataSource; viewer?: HomeViewer } = {}) =>
  render(<MemoryRouter initialEntries={[url]}><HomeDataProvider source={source ?? createSampleSource(state)} viewer={viewer}><HomePage /></HomeDataProvider></MemoryRouter>)
const revenueCard = () => screen.getByRole('region', { name: 'Marketing Performance' })
const funnelCard = () => screen.getByRole('region', { name: 'Engagement Funnel' })
const plot = () => within(revenueCard()).getByRole('group', { name: /^Attributed revenue and campaign cost per/ })

// ---------------------------------------------------------------- Marketing Performance
test('Total: revenue bars, the cost line in Plum, the dashed target pace; the legend under the chart; the tooltip reads all three', async () => {
  const user = userEvent.setup()
  renderHome()
  const card = revenueCard()
  expect(card.querySelectorAll('[data-series="revenue"] path')).toHaveLength(30)
  expect(card.querySelector('[data-series="cost"] path')!.getAttribute('stroke')).toBe('var(--color-chart-pair)')
  expect(card.querySelector('[data-reference="target"] path')!.getAttribute('stroke-dasharray')).toBe('4 4')
  const legend = within(card).getByRole('group', { name: 'Series' })
  expect(card.querySelector('[data-section-header="card"]')!.contains(legend)).toBe(false)
  expect(plot().compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(legend).getByRole('button', { name: 'Revenue' }).querySelector('[data-swatch="square"]')).toBeTruthy()
  expect(within(legend).getByRole('button', { name: 'Cost' }).querySelector('[data-swatch="line"]')).toBeTruthy()
  expect(legend.querySelector('[data-legend-reference] [data-swatch="dashed"]')).toBeTruthy()
  expect(plot().getAttribute('aria-label')).toBe('Attributed revenue and campaign cost per day, with target pace')
  expect(card.querySelector('[data-revenue-summary]')).toBeNull()                                           // the figures live in the key figures now

  plot().focus()
  await user.keyboard('{ArrowRight}')
  const tip = card.querySelector('[data-chart-tooltip]')!
  expect(tip.textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}Revenue\$[\d.]+KCost\$[\d.]+KTarget Pace\$49\.0K$/)
})

test('the insight line: behind or ahead of the target pace with the figures, or against cost without a target; nothing without revenue', () => {
  renderHome()
  const insight = revenueCard().querySelector('[data-revenue-insight]')!
  expect(insight.textContent).toContain('Revenue is behind target pace')
  expect(insight.textContent).toContain('Attributed revenue is $1.39M from $111.3K campaign cost (12.5× return), 95% of the $1.47M expected by now.')
  expect(insight.textContent).toContain('Review the campaigns furthest under target')

  const series = (summary: Partial<RevenueCostSeries['summary']>, targetPace: number | null): RevenueCostSeries => ({
    granularity: 'day', byCampaign: { top: [], others: null },
    points: [{ day: '2026-10-01', revenue: 4300, cost: 127, targetPace }],
    summary: { revenue: 4300, cost: 127, roi: 33.9, revenuePer1000Delivered: null, ...summary },
  })
  expect(revenueInsight(series({}, 3000))).toEqual({
    title: 'Revenue is ahead of target pace',
    detail: 'Attributed revenue is $4.3K from $127 campaign cost (33.9× return), 143% of the $3.0K expected by now. Consider scaling the best-performing audience before the next send window.',
  })
  expect(revenueInsight(series({}, null))).toEqual({
    title: 'Revenue is well ahead of cost',
    detail: 'Attributed revenue is $4.3K from $127 campaign cost (33.9× return). Set revenue targets on campaigns to track pace here.',
  })
  expect(revenueInsight(series({ revenue: null, roi: null }, null))).toBeNull()
  expect(revenueInsight({ ...series({}, null), points: [] })).toBeNull()
})

test('90 days: weekly categories', () => {
  renderHome({ url: '/?period=90d' })
  expect(revenueCard().querySelectorAll('[data-series="revenue"] path')).toHaveLength(13)
  expect(plot().getAttribute('aria-label')).toBe('Attributed revenue and campaign cost per week, with target pace')
  const table = within(revenueCard()).getByRole('table')
  expect(within(table).getAllByRole('rowheader')[0].textContent).toMatch(/^Week of \d{1,2} [A-Z][a-z]{2} \d{4}$/)
})

test('By Campaign: a radio toggle to the top five and the others, each with its share; the legend goes, the insight stays', async () => {
  const user = userEvent.setup()
  renderHome()
  const toggle = within(revenueCard()).getByRole('radiogroup', { name: 'Revenue View' })
  expect(within(toggle).getByRole('radio', { name: 'Total' }).getAttribute('aria-checked')).toBe('true')
  await user.click(within(toggle).getByRole('radio', { name: 'By Campaign' }))
  const rows = within(within(revenueCard()).getByRole('list', { name: 'Attributed revenue by campaign' })).getAllByRole('listitem')
  expect(rows).toHaveLength(6)
  expect(rows[0].textContent).toBe('Weekly Deals Digest $433.0K31.2%')
  expect(rows[5].textContent).toMatch(/^Others \(6 Campaigns\) \$[\d.]+K[\d.]+%$/)
  expect(within(revenueCard()).queryByRole('group', { name: 'Series' })).toBeNull()
  expect(revenueCard().querySelector('[data-revenue-insight]')).toBeTruthy()
})

test('one campaign: no Total / By Campaign toggle', () => {
  renderHome({ url: '/?campaigns=c06' })
  expect(within(revenueCard()).queryByRole('radiogroup')).toBeNull()
  expect(revenueCard().querySelector('[data-chart-plot]')).toBeTruthy()
})

test('no attribution: the message and the period’s cost; a button for admins, a sentence for others; no chart, no insight', () => {
  renderHome({ state: 'noAttribution' })
  const card = revenueCard()
  expect(card.textContent).toContain('Revenue attribution is not set up yet.')
  expect(card.textContent).toContain('Campaign cost for this period: $111.3K.')
  const button = within(card).getByRole('link', { name: 'Set Up Attribution' })
  expect(button.getAttribute('href')).toBe('/settings/attribution')
  expect(button.className).toContain('bg-brand-600')
  expect(card.querySelector('[data-chart-plot]')).toBeNull()
  expect(within(card).queryByRole('radiogroup')).toBeNull()
  expect(card.querySelector('[data-revenue-insight]')).toBeNull()
  cleanup()
  renderHome({ state: 'noAttribution', viewer: { ...SAMPLE_VIEWER, can: (permission) => permission !== 'user.admin' } })
  expect(within(revenueCard()).queryByRole('link')).toBeNull()
  expect(revenueCard().textContent).toContain('Ask an admin to set up attribution.')
})

test('revenue unavailable: the card is gone and the funnel pairs with Top Campaigns, half and half', () => {
  renderHome({ source: { ...createSampleSource('busy'), useRevenueCost: () => ({ status: 'unavailable' }) } })
  expect(screen.queryByRole('region', { name: 'Marketing Performance' })).toBeNull()
  const row = funnelCard().closest('[data-row]')!
  expect(row.getAttribute('data-layout')).toBe('1:1')
  expect(row.contains(screen.getByRole('region', { name: 'Top Campaigns' }))).toBe(true)
})

// ---------------------------------------------------------------- Engagement Funnel
const steps = () => within(within(funnelCard()).getByRole('list')).getAllByRole('listitem')
const barWidth = (step: string) => (funnelCard().querySelector(`[data-bar-row="${step}"] [data-bar] > span`) as HTMLElement | null)?.style.width
const rates = () => [...funnelCard().querySelectorAll('[data-funnel-rates] > div')].map((tile) => tile.textContent)

test('email: the four steps against Delivered, the drop-off between each, and the two end-to-end rates with two decimals', () => {
  renderHome()
  expect(within(funnelCard()).getByRole('list', { name: 'Email engagement funnel' })).toBeTruthy()
  expect(steps().map((step) => step.querySelector('[data-bar-row] > div, div')!.textContent)).toEqual(['Delivered 1,142,300', 'Opened 427,821', 'Clicked 49,447', 'Converted 11,130'])
  expect(barWidth('delivered')).toBe('100%')
  expect(Number.parseFloat(barWidth('opened')!)).toBeCloseTo(37.45, 1)
  expect([...funnelCard().querySelectorAll('[data-drop-off]')].map((node) => node.textContent)).toEqual(['Drop-off 62.5%', 'Drop-off 88.4%', 'Drop-off 77.5%'])
  expect(rates()).toEqual(['0.97%Delivered → Converted', '37.45%Delivered → Opened'])
})

test('SMS: Opened is Not Tracked with no bar and no connector; the drop-off to Clicked is from Delivered; the second rate is to Clicked', async () => {
  const user = userEvent.setup()
  renderHome()
  await user.click(within(within(funnelCard()).getByRole('radiogroup', { name: 'Funnel Channel' })).getByRole('radio', { name: 'SMS' }))
  const opened = funnelCard().querySelector('[data-bar-row="opened"]')!
  expect(opened.textContent).toContain('Not Tracked')
  expect(opened.querySelector('[data-bar]')).toBeNull()
  expect(funnelCard().querySelector('[data-bar-row="delivered"] [data-drop-off]')).toBeNull()               // nothing into Opened
  expect(opened.querySelector('[data-drop-off]')!.textContent).toBe('Drop-off 97.4% from Delivered')
  expect(rates()).toEqual(['0.68%Delivered → Converted', '2.62%Delivered → Clicked'])
})

test('the channel toggle sits in the header, and hides when the page is filtered to a channel or only one channel has data', () => {
  renderHome()
  expect(funnelCard().querySelector('[data-section-header="card"]')!.contains(within(funnelCard()).getByRole('radiogroup', { name: 'Funnel Channel' }))).toBe(true)
  cleanup()
  renderHome({ url: '/?channel=MMS' })
  expect(within(funnelCard()).queryByRole('radiogroup')).toBeNull()
  expect(within(funnelCard()).getByRole('list', { name: 'MMS engagement funnel' })).toBeTruthy()
  cleanup()
  renderHome({ state: 'light' })
  expect(within(funnelCard()).queryByRole('radiogroup')).toBeNull()
  expect(within(funnelCard()).getByRole('list', { name: 'Email engagement funnel' })).toBeTruthy()
})

test('Row A: the two cards share the row 2:1 and stretch to the same height', () => {
  renderHome()
  const row = revenueCard().closest('[data-row]')!
  expect(row.getAttribute('data-layout')).toBe('2:1')
  expect(row.contains(funnelCard())).toBe(true)
  expect(funnelCard().className).toContain('flex')
  expect(funnelCard().querySelector('[data-funnel-rates]')!.parentElement!.className).toContain('mt-auto')
})

test('the revenue axis reads whole ("$80K") while the tooltip keeps a decimal ("$64.0K"); both toggles are the outline kind', async () => {
  const user = userEvent.setup()
  renderHome()
  const ticks = [...revenueCard().querySelectorAll('svg text')].map((text) => text.textContent)
  expect(ticks).toEqual(expect.arrayContaining(['$0', '$20K', '$40K', '$60K', '$80K']))
  plot().focus()
  await user.keyboard('{ArrowRight}')
  expect(revenueCard().querySelector('[data-chart-tooltip]')!.textContent).toMatch(/Revenue\$\d+\.\dK/)
  for (const [card, name, picked] of [[revenueCard(), 'Revenue View', 'Total'], [funnelCard(), 'Funnel Channel', 'Email']] as const) {
    const selected = within(within(card).getByRole('radiogroup', { name })).getByRole('radio', { name: picked })
    expect(selected.getAttribute('aria-checked')).toBe('true')
    expect(selected.className).toContain('border-brand-600 bg-brand-100 text-brand-800')
  }
})
