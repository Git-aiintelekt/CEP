/** The Performance tab: Results, Engagement over time, Economics, Runs (each production run opens), mailbox providers or replies. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, me, signIn } from '@/test/mockApi'
import type { CampaignTargets } from '@/lib/types'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const run = (overrides: Record<string, unknown>) => ({ id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
  started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:02:00Z', row_version: 1, ...overrides })
const threeRuns = [run({}), run({ id: 'r2', run_number: 2 }), run({ id: 'r3', run_number: 3, test_mode: true, sequence_label: 'Test' })]
const noTargets: CampaignTargets = { target_revenue: null, target_opens: null, target_clicks: null, target_conversions: null, target_redemptions: null, planned_cost: null, planned_offer_cost: null, notes: null }
const completed = (overrides = {}) => makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z', runs: threeRuns as never, send_timezone: 'America/Chicago', ...overrides })

async function openPerformance(campaign: ReturnType<typeof makeCampaign>, options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ campaign, ...options })
  await renderAppAt(`/campaigns/${campaign.id}?tab=performance`)
  await screen.findByRole('region', { name: 'Results' })
  return calls
}

const card = (name: string) => screen.getByRole('region', { name })
const metricNames = () => [...card('Results').querySelectorAll('[data-metric]')].map((item) => item.getAttribute('data-metric'))

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('cards in order, 24px apart: Results, Engagement over time, Economics, Runs, By mailbox provider', async () => {
  await openPerformance(completed())
  await screen.findByRole('region', { name: 'Economics' })
  const cards = [...document.querySelectorAll('section[aria-labelledby]')].map((section) => section.querySelector('h2')?.textContent)
  expect(cards).toEqual(['Results', 'Engagement over Time', 'Economics', 'Runs', 'By Mailbox Provider'])
  expect(card('Results').parentElement!.className).toContain('gap-6')
})

test('Results for an email: every tile and note in order, 3 per row, with when it was last sent', async () => {
  await openPerformance(completed())
  await within(card('Results')).findByText('52.6% of delivered')
  expect(metricNames()).toEqual(['Sent', 'Delivered', 'Opened', 'Clicked', 'Bounced', 'Unsubscribed', 'Spam Complaints', 'Conversions'])
  const tile = (label: string) => [...card('Results').querySelectorAll(`[data-metric="${label}"] dd`)].map((item) => item.textContent)
  expect(tile('Sent')).toEqual(['80', '1 failed'])
  expect(tile('Delivered')).toEqual(['76', '95% of sent'])
  expect(tile('Opened')).toEqual(['40', '52.6% of delivered'])
  expect(tile('Clicked')).toEqual(['12', '15.8% of delivered'])
  expect(tile('Bounced')).toEqual(['4', '5% of sent'])
  expect(tile('Unsubscribed')).toEqual(['2', '2.6% of delivered'])
  expect(tile('Spam Complaints')).toEqual(['0'])
  expect(tile('Conversions')).toEqual(['5', '$1,250 attributed'])
  expect(card('Results').querySelector('dl')!.className).toContain('lg:grid-cols-3')
  expect(within(card('Results')).getByText(/^Last sent .+ · updated /)).toBeTruthy()

  cleanup()
  await openPerformance(completed(), { metrics: { counts: { queued: 12, sent: 80, failed: 1, delivered: 76, opened: 40, clicked: 12, bounced: 4, complained: 0, unsubscribed: 2, replied: 0 }, revenue: null } })
  expect(await within(card('Results')).findByText('12 still queued')).toBeTruthy()
  expect(within(card('Results')).getByText('Arrives with the attribution feed')).toBeTruthy()
})

test('Results for a text: Sent, Delivered, Replies, Opted out, Conversions, and the breakdown note at the bottom', async () => {
  await openPerformance(completed({ channel: 'SMS' }), { texts: true, metrics: { breakdown: { by: 'carrier', rows: [], note: 'Carrier breakdowns arrive with the delivery receipts.' } } })
  await within(card('Results')).findByText('Carrier breakdowns arrive with the delivery receipts.')
  expect(metricNames()).toEqual(['Sent', 'Delivered', 'Replies', 'Opted Out (STOP)', 'Conversions'])
  expect(screen.queryByRole('region', { name: 'By Mailbox Provider' })).toBeNull()
})

test('the chart: By hour / By day, a legend that hides a series, and the numbers as a table', async () => {
  const user = userEvent.setup()
  const calls = await openPerformance(completed())
  const chart = card('Engagement over Time')
  expect(await within(chart).findByRole('group', { name: 'Messages sent, delivered, opened, clicked per hour' })).toBeTruthy()
  const legend = within(chart).getByRole('group', { name: 'Series' })
  expect(within(legend).getAllByRole('button').map((item) => item.textContent)).toEqual(['Sent', 'Delivered', 'Opened', 'Clicked'])
  await user.click(within(legend).getByRole('button', { name: 'Opened' }))
  expect(within(legend).getByRole('button', { name: 'Opened' }).getAttribute('aria-pressed')).toBe('false')
  expect(chart.querySelector('[data-series="opened"]')).toBeNull()

  const table = within(chart).getByRole('table', { name: /per hour/ })
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Hour', 'Sent', 'Delivered', 'Opened', 'Clicked'])
  expect(within(table).getAllByRole('row')).toHaveLength(3)

  await user.click(within(chart).getByRole('radio', { name: 'By Day' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/metrics/timeseries/') && call.url.includes('bucket=day'))).toBe(true))
  expect(await within(chart).findByRole('group', { name: 'Messages sent, delivered, opened, clicked per day' })).toBeTruthy()

  cleanup()
  await openPerformance(completed({ channel: 'SMS' }), { texts: true })
  const legendTexts = within(await within(card('Engagement over Time')).findByRole('group', { name: 'Series' })).getAllByRole('button')
  expect(legendTexts.map((item) => item.textContent)).toEqual(['Sent', 'Delivered'])
})

test('Economics: the headline from the data, the planned spend, target against actual with signed, coloured differences, and the meters', async () => {
  const targets: CampaignTargets = { ...noTargets, target_opens: 30, target_clicks: 40, target_revenue: '1000.00', planned_cost: '500', planned_offer_cost: '200', notes: 'Holiday push' }
  await openPerformance(completed({ targets }))
  const economics = await screen.findByRole('region', { name: 'Economics' })
  expect(within(economics).getByTestId('economics-headline').textContent).toBe('5 conversions from 76 delivered')
  expect(within(economics).getByText('Against a planned spend of $700.00.')).toBeTruthy()

  const rows = within(economics).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
  expect(rows).toEqual([
    ['Opens', '30', '40', '+10'],
    ['Clicks', '40', '12', '−28'],
    ['Conversions', '—', '5', '—'],
    ['Revenue', '$1,000.00', '$1,250.00', '+$250.00'],
    ['Offer Redemptions', '—', '—', '—'],
    ['Campaign Cost', '$500.00', '—', '—'],
    ['Offer Cost', '$200.00', '—', '—'],
  ])
  const tone = (text: string) => within(economics).getByText(text)
  expect(tone('+10').className).toContain('text-success-text')
  expect(tone('−28').className).toContain('text-warning-text')
  expect(tone('+$250.00').className).toContain('text-success-text')
  expect(within(economics).getAllByText('—').filter((cell) => cell.getAttribute('data-tone') === 'none').every((cell) => cell.className.includes('text-ink-800'))).toBe(true)

  expect(within(economics).getByRole('progressbar', { name: 'Clicks against target' }).getAttribute('aria-valuenow')).toBe('30')
  expect(within(economics).getByRole('progressbar', { name: 'Revenue against target' })).toBeTruthy()
  expect(within(economics).getByText('Holiday push')).toBeTruthy()
  expect(within(economics).getByText('Planning estimates come from your own inputs. They aren’t guaranteed outcomes.')).toBeTruthy()
})

test('Economics without targets says so, with "Edit Targets" only when the campaign may be edited', async () => {
  await openPerformance(makeCampaign({ status: 'DRAFT', runs: [run({})] as never, actions: ['edit', 'clone', 'results'] }))
  const economics = await screen.findByRole('region', { name: 'Economics' })
  expect(within(economics).getByText('No targets were set for this campaign.')).toBeTruthy()
  expect(within(economics).getByRole('link', { name: 'Edit Targets' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=targets')
  expect(within(economics).queryByRole('table')).toBeNull()

  cleanup()
  await openPerformance(completed({ targets: noTargets }))                                              // saved, but empty
  expect(within(await screen.findByRole('region', { name: 'Economics' })).getByText('No targets were set for this campaign.')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Edit Targets' })).toBeNull()                              // published: fixed

  cleanup()
  await openPerformance(makeCampaign({ status: 'DRAFT', runs: [run({})] as never, actions: ['edit', 'clone', 'results'] }), { me: { principal: { ...me.principal, permissions: ['campaign.view'] } } as never })
  expect(within(await screen.findByRole('region', { name: 'Economics' })).queryByRole('link', { name: 'Edit Targets' })).toBeNull()
})

test('Runs: the latest production run starts open; others open by mouse or keyboard; test runs never open', async () => {
  const user = userEvent.setup()
  const calls = await openPerformance(completed())
  const runs = card('Runs')
  expect(within(runs).getByText('3 runs · 2 production, 1 test')).toBeTruthy()
  const latest = within(runs).getByRole('button', { name: 'Results of run #2' })
  expect(latest.getAttribute('aria-expanded')).toBe('true')
  const opened = await within(runs).findByRole('region', { name: 'Results of run 2' })
  expect(await within(opened).findByText('On the Lists')).toBeTruthy()
  expect(within(opened).getByText('Left Out of This Run')).toBeTruthy()
  expect(within(opened).getByRole('table', { name: 'Left out of run 2' })).toBeTruthy()
  expect(opened.className).not.toContain('border')                                                    // no card inside the card
  expect(within(runs).queryByRole('button', { name: 'Results of run #3' })).toBeNull()

  const first = within(runs).getByRole('button', { name: 'Results of run #1' })
  expect(first.getAttribute('aria-expanded')).toBe('false')
  await user.click(first)
  expect(await within(runs).findByRole('region', { name: 'Results of run 1' })).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/campaign-runs/r1/results/'))).toBe(true)
  await user.click(first)
  expect(within(runs).queryByRole('region', { name: 'Results of run 1' })).toBeNull()

  latest.focus()
  await user.keyboard('{Enter}')
  expect(latest.getAttribute('aria-expanded')).toBe('false')
  await user.keyboard(' ')
  expect(latest.getAttribute('aria-expanded')).toBe('true')
})

test('By mailbox provider: Domain, Sent, Delivered, Opened, Bounced', async () => {
  await openPerformance(completed())
  const mailbox = await screen.findByRole('region', { name: 'By Mailbox Provider' })
  expect(within(mailbox).getByText("The recipients' domains, largest first.")).toBeTruthy()
  const table = within(mailbox).getByRole('table')
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Domain', 'Sent', 'Delivered', 'Opened', 'Bounced'])
  expect(within(table).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['northwind.example', '50', '49', '30', '1'])
})

test('Replies for a text campaign, in a card of their own', async () => {
  await openPerformance(completed({ channel: 'SMS' }), { texts: true })
  const replies = await screen.findByRole('region', { name: 'Replies' })
  expect(within(replies).getByText(/STOP and START are applied the moment they arrive/)).toBeTruthy()
  const items = within(replies).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByText('Do you have it in blue?')).toBeTruthy()
  expect(within(items[1]).getByText('Opted Out')).toBeTruthy()
  expect(within(items[1]).getByText(/C[SD]T$/)).toBeTruthy()
})

test('before a production send, the tab says there are no results yet', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'COMPLETED', runs: [run({ test_mode: true })] as never }) })
  await renderAppAt('/campaigns/c1?tab=performance')
  expect(await screen.findByText('No results yet')).toBeTruthy()
})

test('an opened run shows every number in the usual ink; the tags carry the status', async () => {
  await openPerformance(completed())
  const opened = await screen.findByRole('region', { name: 'Results of run 2' })
  await within(opened).findByText('On the Lists')
  const values = [...opened.querySelectorAll('dl [data-fact] dd span')]
  expect(values.length).toBe(7)
  for (const value of values) expect(value.className).not.toMatch(/text-(success|danger)/)
})

test('consent reads by channel in run results: email, text, MMS', async () => {
  await openPerformance(completed())
  expect(await within(await screen.findByRole('region', { name: 'Results of run 2' })).findByText('No Email Consent')).toBeTruthy()

  cleanup()
  await openPerformance(completed({ channel: 'SMS' }), { texts: true })
  expect(await within(await screen.findByRole('region', { name: 'Results of run 2' })).findByText('No Text Consent')).toBeTruthy()

  cleanup()
  await openPerformance(completed({ channel: 'MMS' }), { texts: true })
  expect(await within(await screen.findByRole('region', { name: 'Results of run 2' })).findByText('No MMS Consent')).toBeTruthy()
})

test('on a phone the numeric grids stay compact tables; the runs stay cards', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: 375 >= Number(/(\d+)px/.exec(query)?.[1] ?? 0), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  await openPerformance(completed({ targets: { ...noTargets, target_clicks: 40 } }))

  const economics = within(await screen.findByRole('region', { name: 'Economics' })).getByRole('table')
  expect(economics.className).toContain('text-helper')
  expect(within(economics).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Measure', 'Target', 'Actual', 'Difference'])
  expect(within(economics).getAllByRole('cell')[1].className).toMatch(/px-1 py-2/)                  // 8px between columns

  const mailbox = await screen.findByRole('region', { name: 'By Mailbox Provider' })
  const headers = () => within(within(mailbox).getByRole('table')).getAllByRole('columnheader').map((cell) => cell.textContent)
  expect(headers()).toEqual(['Domain', 'Sent', 'Delivered', 'Bounced'])
  await user.click(within(mailbox).getByRole('button', { name: 'Show All Columns' }))
  expect(headers()).toEqual(['Domain', 'Sent', 'Delivered', 'Opened', 'Bounced'])

  const runs = screen.getByRole('region', { name: 'Runs' })
  expect(within(runs).queryByRole('table', { name: 'Campaign runs' })).toBeNull()
  expect(within(runs).getByRole('list', { name: 'Campaign runs' })).toBeTruthy()
})
