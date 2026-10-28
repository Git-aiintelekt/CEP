/** Explain → What This Means (docs/mockups/executive-explain-free.html, option D1): rules, no AI, in every workspace; Benchmarks set what good is. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsBenchmarkOffers, installMockApi, me, signIn, workspaceAssistantNow } from '@/test/mockApi'
import { meaningNumber, meaningText } from './components/meaningWords'
import type { Meaning } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string, before?: () => void) {
  const calls = installMockApi({ me: withInsights as never })
  before?.()
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('figures read as the rules write them, and the brief copies as plain text', () => {
  expect([meaningNumber(96.4072, 'percent'), meaningNumber(0.2484, 'percent'), meaningNumber(291034, 'money'), meaningNumber(805, 'integer'), meaningNumber(null, 'percent')])
    .toEqual(['96.4%', '0.25%', '$291K', '805', '—'])
  const meaning: Meaning = {
    verdict: { tone: 'act', chip: 'Act on the List', title: 'Delivery is likely on target; engagement is likely low.', summary: '805 of 835 emails delivered (96.4%).' },
    figures: [{ key: 'f_delivery_rate', label: 'Delivered', value: 96.41, format: 'percent', band: 'good', sure: false, state: 'judged', range: [94.92, 97.47], words: 'Likely On Target', target: 'target 95.0%', earlier: null, estimated: false },
      { key: 'people_opened', label: 'People Who Opened', value: 0.25, format: 'percent', band: null, sure: false, state: 'estimate', range: [0.07, 0.9], words: '', target: '', earlier: null, estimated: true }],
    reasons: [{ text: 'All 6 clicks were on one link: locations.cititrends.com. 0 unsubscribed.', report: { id: 'r-links', name: 'Link Clicks' } }],
    actions: [{ text: 'Hard bounces are above 2.0%: remove the 29 addresses that hard-failed.', kind: 'export_failed', label: 'Export the 29 Addresses', report: null }],
    read: { reports: 4, earlier: null, benchmarks: 4, campaign: 'Sep03 - Star Bag' }, notes: [], pack: 'email-campaigns', ready: true, can_set: true,
  }
  expect(meaningText('Campaign KPIs', meaning)).toBe([
    'Campaign KPIs: Delivery is likely on target; engagement is likely low.', '805 of 835 emails delivered (96.4%).', '',
    'Delivered: 96.4% (likely on target, target 95.0%)', 'People Who Opened: about 0.25%, estimated', '',
    'Why', '- All 6 clicks were on one link: locations.cititrends.com. 0 unsubscribed.', '', 'Do next', '1. Hard bounces are above 2.0%: remove the 29 addresses that hard-failed.'].join('\n'))
})

test('Explain shows What This Means even with the AI switched off, and says how to get a verdict', async () => {
  const calls = await renderAppAt('/insights/reports/rep-1', () => { workspaceAssistantNow.explain = false })
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Explain' }, { timeout: 5000 }))
  const explained = await screen.findByRole('region', { name: 'Explanation' })
  expect(await within(explained).findByText('No Benchmark')).toBeTruthy()
  expect(within(explained).getByText('Largest Campaign: Fall Launch, 1,200 (60.0% of Sent Count).')).toBeTruthy()
  expect(within(explained).getByText('Free · No AI')).toBeTruthy()
  expect(within(explained).getByText('Written by rules from 1 report and no benchmarks · instant')).toBeTruthy()
  expect(within(explained).getByRole('link', { name: 'Set a Benchmark' }).getAttribute('href')).toBe('/insights/benchmarks')
  expect(within(explained).queryByRole('tab')).toBeNull()                                        // no AI tab where the AI is off
  expect(calls.some((call) => call.url.endsWith('/insights/reports/rep-1/explain/'))).toBe(false)
})

test('Benchmarks: a pack’s defaults are added, and Act on the wrong side of Good is refused', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/benchmarks', () => { insightsBenchmarkOffers.push({ pack: 'email-campaigns', name: 'Email Campaign Reports', missing: 4 }) })
  await screen.findByRole('heading', { name: 'Benchmarks' })
  expect(await screen.findByText(/No benchmarks yet/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add the Email Campaign Defaults' }))
  const table = await screen.findByRole('table', { name: 'Benchmarks' })
  expect(within(table).getByText('Sent Count')).toBeTruthy()
  expect(within(table).getByText('1,500 or more')).toBeTruthy()
  expect(within(table).getByText('1,000 to 1,500')).toBeTruthy()
  expect(within(table).getByText('under 1,000')).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/insights/benchmarks/defaults/') && (call.body as { pack: string }).pack === 'email-campaigns')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Add the Email Campaign Defaults' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Add a Benchmark' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Benchmark' })
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Better When/ }), 'lower')
  await user.type(within(dialog).getByRole('textbox', { name: /^Good/ }), '2')
  await user.type(within(dialog).getByRole('textbox', { name: /^Act/ }), '1')
  expect(within(dialog).getByText('Act is at or above Good when lower is better.')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Add Benchmark' }) as HTMLButtonElement).disabled).toBe(true)
})
