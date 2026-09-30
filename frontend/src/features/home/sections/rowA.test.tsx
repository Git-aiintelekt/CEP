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
const revenueCard = () => screen.getByRole('region', { name: 'Attributed Revenue vs. Campaign Cost' })
const funnelCard = () => screen.getByRole('region', { name: 'Engagement Funnel by Channel' })
const plot = () => within(revenueCard()).getByRole('group', { name: /^Attributed revenue and campaign cost per/ })

// ---------------------------------------------------------------- Attributed Revenue vs. Campaign Cost
test('Total: revenue bars, the cost line in Plum, the dashed target pace; the legend in the header; the tooltip reads all three', async () => {
  const user = userEvent.setup()
  renderHome()
  const card = revenueCard()
  expect(card.querySelectorAll('[data-series="revenue"] path')).toHaveLength(30)
  expect(card.querySelector('[data-series="cost"] path')!.getAttribute('stroke')).toBe('var(--color-chart-pair)')
  expect(card.querySelector('[data-reference="target"] path')!.getAttribute('stroke-dasharray')).toBe('4 4')
  const legend = within(card.querySelector('[data-section-header="card"]') as HTMLElement).getByRole('group', { name: 'Series' })
  expect(within(legend).getByRole('button', { name: 'Revenue' }).querySelector('[data-swatch="square"]')).toBeTruthy()
  expect(within(legend).getByRole('button', { name: 'Cost' }).querySelector('[data-swatch="line"]')).toBeTruthy()
  expect(legend.querySelector('[data-legend-reference] [data-swatch="dashed"]')).toBeTruthy()
  expect(plot().getAttribute('aria-label')).toBe('Attributed revenue and campaign cost per day, with target pace')

  plot().focus()
  await user.keyboard('{ArrowRight}')
  const tip = card.querySelector('[data-chart-tooltip]')!
  expect(tip.textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}Revenue\$[\d.]+KCost\$[\d.]+KTarget Pace\$49\.0K$/)
})

test('the summary: revenue, cost, ROI as revenue ÷ cost, revenue per 1,000 delivered', () => {
  renderHome()
  const cells = [...revenueCard().querySelectorAll('[data-revenue-summary] > div')].map((cell) => [cell.querySelector('dt')!.textContent, cell.querySelector('dd')!.textContent])
  expect(cells).toEqual([['Revenue', '$1.39M'], ['Campaign Cost', '$111.3K'], ['ROI', '12.5×'], ['Revenue per 1,000 Delivered', '$874.75']])
})

test('90 days: weekly categories', () => {
  renderHome({ url: '/?period=90d' })
  expect(revenueCard().querySelectorAll('[data-series="revenue"] path')).toHaveLength(13)
  expect(plot().getAttribute('aria-label')).toBe('Attributed revenue and campaign cost per week, with target pace')
  const table = within(revenueCard()).getByRole('table')
  expect(within(table).getAllByRole('rowheader')[0].textContent).toMatch(/^Week of \d{1,2} [A-Z][a-z]{2} \d{4}$/)
})

test('By Campaign: a radio toggle to the top five and the others, each with its share; the legend goes', async () => {
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
  expect(revenueCard().querySelector('[data-revenue-summary]')).toBeTruthy()
})

test('one campaign: no Total / By Campaign toggle', () => {
  renderHome({ url: '/?campaigns=c06' })
  expect(within(revenueCard()).queryByRole('radiogroup')).toBeNull()
  expect(revenueCard().querySelector('[data-chart-plot]')).toBeTruthy()
})

test('no attribution: the message and the period’s cost; a button for admins, a sentence for others; no chart', () => {
  renderHome({ state: 'noAttribution' })
  const card = revenueCard()
  expect(card.textContent).toContain('Revenue attribution is not set up yet.')
  expect(card.textContent).toContain('Campaign cost for this period: $111.3K.')
  const button = within(card).getByRole('link', { name: 'Set Up Attribution' })
  expect(button.getAttribute('href')).toBe('/settings/integrations')
  expect(button.className).toContain('bg-brand-600')
  expect(card.querySelector('[data-chart-plot]')).toBeNull()
  expect(within(card).queryByRole('radiogroup')).toBeNull()
  expect(card.querySelector('[data-revenue-summary]')).toBeNull()
  cleanup()
  renderHome({ state: 'noAttribution', viewer: { ...SAMPLE_VIEWER, can: (permission) => permission !== 'user.admin' } })
  expect(within(revenueCard()).queryByRole('link')).toBeNull()
  expect(revenueCard().textContent).toContain('Ask an admin to set up attribution.')
})

test('revenue unavailable: the card is gone and the funnel pairs with Top and Bottom, one third beside two', () => {
  renderHome({ source: { ...createSampleSource('busy'), useRevenueCost: () => ({ status: 'unavailable' }) } })
  expect(screen.queryByRole('region', { name: 'Attributed Revenue vs. Campaign Cost' })).toBeNull()
  const row = funnelCard().closest('[data-row]')!
  expect(row.getAttribute('data-layout')).toBe('2:1')
  expect(row.contains(screen.getByRole('region', { name: 'Top and Bottom Campaigns' }))).toBe(true)
})

// ---------------------------------------------------------------- Engagement Funnel
const steps = () => within(within(funnelCard()).getByRole('list')).getAllByRole('listitem')
const barWidth = (step: string) => (funnelCard().querySelector(`[data-bar-row="${step}"] [data-bar] > span`) as HTMLElement | null)?.style.width

test('email: the four steps against Delivered, the drop-off between each, and Delivered to Converted with two decimals', () => {
  renderHome()
  expect(within(funnelCard()).getByRole('list', { name: 'Email engagement funnel' })).toBeTruthy()
  expect(steps().map((step) => step.querySelector('[data-bar-row] > div, div')!.textContent)).toEqual(['Delivered 1,142,300', 'Opened 427,821', 'Clicked 49,447', 'Converted 11,130'])
  expect(barWidth('delivered')).toBe('100%')
  expect(Number.parseFloat(barWidth('opened')!)).toBeCloseTo(37.45, 1)
  expect([...funnelCard().querySelectorAll('[data-drop-off]')].map((node) => node.textContent)).toEqual(['Drop-off 62.5%', 'Drop-off 88.4%', 'Drop-off 77.5%'])
  expect(funnelCard().querySelector('[data-funnel-footer]')!.textContent).toBe('Delivered to Converted0.97%')
})

test('SMS: Opened is Not Tracked with no bar and no connector; the drop-off to Clicked is from Delivered', async () => {
  const user = userEvent.setup()
  renderHome()
  await user.click(within(within(funnelCard()).getByRole('radiogroup', { name: 'Funnel Channel' })).getByRole('radio', { name: 'SMS' }))
  const opened = funnelCard().querySelector('[data-bar-row="opened"]')!
  expect(opened.textContent).toContain('Not Tracked')
  expect(opened.querySelector('[data-bar]')).toBeNull()
  expect(funnelCard().querySelector('[data-bar-row="delivered"] [data-drop-off]')).toBeNull()               // nothing into Opened
  expect(opened.querySelector('[data-drop-off]')!.textContent).toBe('Drop-off 97.4% from Delivered')
  expect(funnelCard().querySelector('[data-funnel-footer]')!.textContent).toBe('Delivered to Converted0.68%')
})

test('the channel toggle hides when the page is filtered to a channel, or when only one channel has data', () => {
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
  expect(funnelCard().querySelector('[data-funnel-footer]')!.parentElement!.className).toContain('border-t')
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
