import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, me, signIn, type Call } from '@/test/mockApi'

import { HomePage } from './HomePage'
import { HomeDataProvider } from './data/HomeDataProvider'
import { createSampleSource } from './data/sampleSource'
import { SAMPLE_VIEWER } from './data/sampleViewer'

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}
const apiPaths = (calls: Call[]) => calls.map((call) => `${call.method} ${call.url.replace(/^.*\/api\/v1/, '')}`)
const region = (name: string) => screen.queryByRole('region', { name })

test('the Campaign filter lists sent campaigns from the API, without drafts, archived campaigns or e-receipts', async () => {
  signIn()
  const calls = installMockApi({ campaigns: [
    makeCampaign({ id: 'a', name: 'Fall Launch', status: 'PRODUCTION_PUBLISHED' }),
    makeCampaign({ id: 'b', name: 'Holiday Draft', status: 'DRAFT' }),
    makeCampaign({ id: 'c', name: 'Old One', status: 'ARCHIVED' }),
    makeCampaign({ id: 'd', name: 'Store Receipts', status: 'PRODUCTION_PUBLISHED', campaign_type: 'E_RECEIPT' }),
    makeCampaign({ id: 'e', name: 'Winter Sale', status: 'COMPLETED' }),
  ] })
  vi.resetModules()
  const { liveSource } = await import('./data/liveSource')
  const { HomeDataProvider: Provider } = await import('./data/HomeDataProvider')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter><Provider source={liveSource} viewer={SAMPLE_VIEWER}>{children}</Provider></MemoryRouter></QueryClientProvider>
  const { result } = renderHook(() => liveSource.useCampaignOptions(), { wrapper })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  const data = (result.current as { data: { options: { name: string }[]; more: boolean } }).data
  expect(data.options.map((option) => option.name).sort()).toEqual(['Fall Launch', 'Winter Sale'])
  expect(data.more).toBe(false)
  const list = new URL(apiPaths(calls).find((path) => path.includes('page_size=200'))!.split(' ')[1], 'http://x').searchParams
  expect([list.get('ordering'), list.get('status')]).toEqual(['-updated_at', 'PRODUCTION_PUBLISHED,SCHEDULED,ACTIVE,PAUSED,COMPLETED,CANCELLED'])
})

test('more than 200 campaigns: the menu says it shows the 200 most recently updated', async () => {
  const user = userEvent.setup()
  const source = createSampleSource('busy')
  const withMore = { ...source, useCampaignOptions: () => { const result = source.useCampaignOptions(); return result.status === 'ready' ? { ...result, data: { ...result.data, more: true } } : result } }
  render(<MemoryRouter><HomeDataProvider source={withMore} viewer={SAMPLE_VIEWER}><HomePage /></HomeDataProvider></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: 'All Campaigns' }))
  expect(screen.getByText('Showing the 200 most recently updated campaigns.').className).toContain('text-helper text-ink-800')
})

test('"/" is the new Home: the greeting, every live section, and no request made twice', async () => {
  const calls = installMockApi()
  await renderAppAt('/')
  expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })).toBeTruthy()
  await waitFor(() => expect(region('Recent Campaigns')).toBeTruthy())
  await waitFor(() => expect(region('Next 7 Days')).toBeTruthy())
  for (const name of ['Marketing Performance', 'Create New']) expect(region(name)).toBeTruthy()
  await waitFor(() => expect(region('Needs Attention')).toBeNull())                                                                   // loaded, and the mock workspace has nothing needing attention
  for (const name of ['Attributed Revenue vs. Campaign Cost', 'Active Journeys', 'Governance']) expect(region(name)).toBeNull()        // no data behind them yet
  expect(screen.getByRole('button', { name: 'All Campaigns' })).toBeTruthy()                                                          // the Campaign filter, live
  await new Promise((resolve) => setTimeout(resolve, 50))
  const requests = apiPaths(calls).filter((path) => path.startsWith('GET') && path !== 'GET /contact-lists/imports/')                  // the shell's upload poll repeats by design
  const repeated = requests.filter((path, index) => requests.indexOf(path) !== index)
  expect(repeated).toEqual([])
  expect(requests.some((path) => path.includes('/dashboard/summary/'))).toBe(false)
})

test('without report.view: no report is asked for, the KPI access line shows, and the report-based cards step aside', async () => {
  const calls = installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: me.principal.permissions.filter((code) => code !== 'report.view') } } })
  await renderAppAt('/')
  expect(await screen.findByText('You don’t have access to performance reports.')).toBeTruthy()
  await waitFor(() => expect(region('Recent Campaigns')).toBeTruthy())
  for (const name of ['Top and Bottom Campaigns', 'Engagement Funnel by Channel', 'E-Receipts']) expect(region(name)).toBeNull()
  expect(apiPaths(calls).some((path) => path.includes('/reports/summary/'))).toBe(false)
  expect(within(region('Recent Campaigns')!).getAllByRole('row').length).toBeGreaterThan(1)
})

test('journeys and e-receipts switched off, and a section the viewer may not load (403), all hide without an error', async () => {
  installMockApi({ me: { features: { journeys: false, ereceipt: false } } })
  const fetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    (String(input).includes('/campaigns/calendar/') ? Promise.resolve(new Response(JSON.stringify({ detail: 'Not allowed.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })) : fetch(input, init)))
  await renderAppAt('/')
  await waitFor(() => expect(region('Recent Campaigns')).toBeTruthy())
  expect(region('Next 7 Days')).toBeNull()
  expect(region('E-Receipts')).toBeNull()
  expect(region('Active Journeys')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
