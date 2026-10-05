import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { addDays, todayIn } from '@/features/reports/period'
import type { Campaign } from '@/lib/types'
import { atZone } from '@/lib/zonedTime'
import { installMockApi, makeCampaign, signIn } from '@/test/mockApi'
import { homeOverview, reportSummary } from '@/test/mockWorkspaceTools'

import { SAMPLE_VIEWER } from './sampleViewer'
import { DEFAULT_FILTERS, type HomeDataSource, type HomeFilters, type SectionResult } from './types'

beforeEach(() => {
  window.localStorage.clear()
  signIn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** the api client reads the session when it loads, so the source is loaded after signIn() */
async function load(url = '/') {
  vi.resetModules()
  const { liveSource } = await import('./liveSource')
  const { HomeDataProvider } = await import('./HomeDataProvider')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><HomeDataProvider source={liveSource} viewer={SAMPLE_VIEWER}>{children}</HomeDataProvider></MemoryRouter></QueryClientProvider>
  )
  return { liveSource, wrapper }
}

async function ready<T>(use: (source: HomeDataSource) => SectionResult<T>): Promise<T> {
  const { liveSource, wrapper } = await load()
  const { result } = renderHook(() => use(liveSource), { wrapper })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  return (result.current as { data: T }).data
}

const filters = (next: Partial<HomeFilters> = {}): HomeFilters => ({ ...DEFAULT_FILTERS, ...next })
const paths = (calls: { url: string }[], part: string) => calls.filter((call) => call.url.includes(part)).map((call) => call.url.replace(/^.*\/api\/v1/, ''))

test('Needs Attention from the overview: failed sends by id, awaiting publish, awaiting approval, in one request', async () => {
  const calls = installMockApi({ campaigns: [makeCampaign({ id: 'c-failed', name: 'Broke', status: 'FAILED' as Campaign['status'] })] })
  const attention = await ready((source) => source.useAttention(filters()))
  expect(attention.groups.map((group) => [group.label, group.count, group.severity, group.href])).toEqual([
    ['Campaigns with delivery failures', 1, 'critical', '/campaigns?saved=attention'],
    ['Campaigns awaiting production publish', 2, 'blocking', '/campaigns?status=TEST_PUBLISHED'],
    ['Campaigns waiting for approval', 1, 'blocking', '/campaigns?saved=approval'],
  ])
  expect(attention.freshness).toMatch(/^Updated at \d\d:\d\d E[DS]T$/)
  expect(paths(calls, '/home/overview/')).toHaveLength(1)
  expect(paths(calls, '/home/overview/')[0]).toMatch(/^\/home\/overview\/\?from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/)
  expect(paths(calls, '/campaigns/?')).toEqual([])                                                             // no list calls for the counts any more
})

test('one campaign: the overview says whether its send failed; publish and approval come from the campaign itself', async () => {
  installMockApi({ campaigns: [makeCampaign({ id: 'c-failed', status: 'TEST_PUBLISHED' })], campaign: makeCampaign({ id: 'c-failed', status: 'TEST_PUBLISHED' }) })
  const attention = await ready((source) => source.useAttention(filters({ campaignIds: ['c-failed'] })))
  expect(attention.groups.map((group) => [group.label, group.count])).toEqual([['Campaigns with delivery failures', 1], ['Campaigns awaiting production publish', 1]])
})

test('groups with nothing in them are left out', async () => {
  installMockApi({ workspaceTools: { overview: { ...homeOverview(), attention: { failed_ids: [], awaiting_publish: 0, awaiting_approval: 0 } } } })
  expect((await ready((source) => source.useAttention(filters()))).groups).toEqual([])
})

test('KPIs from /reports/summary/ for this period and the one before; no store revenue or targets from the API', async () => {
  const calls = installMockApi()
  const kpis = await ready((source) => source.useKpis(filters({ period: '7d' })))
  const summaries = paths(calls, '/reports/summary/')
  expect(summaries).toHaveLength(2)
  expect(summaries.every((path) => /from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/.test(path))).toBe(true)
  expect(new Set(summaries).size).toBe(2)
  expect(kpis.delivered).toEqual({ value: 17_924, previous: 17_924 })
  expect(kpis.openRate).toMatchObject({ value: 42.5, opened: 7_491 })   // email opens over email deliveries
  expect(kpis.clickRate).toMatchObject({ value: 6.3, clicked: 1_129 })
  expect(kpis.conversions).toMatchObject({ value: 212, percentOfClicks: 18.8 })
  expect(kpis.attributedRevenue.value).toBe(48_210.5)
  expect(kpis).toMatchObject({ attributionSetUp: true, storeRevenue: null, revenueTarget: null, perDayDelivered: 2_561 })
  expect(kpis.contribution.value).toBeNull()
})

test('the channel goes to the API; MMS is asked for as SMS and kept to MMS campaigns', async () => {
  const calls = installMockApi()
  const sms = await ready((source) => source.useKpis(filters({ channel: 'SMS' })))
  expect(paths(calls, '/reports/summary/').every((path) => path.includes('channel=SMS'))).toBe(true)
  expect(sms.openRate.value).toBe('not_tracked')
  const mms = await ready((source) => source.useKpis(filters({ channel: 'MMS' })))
  expect(mms.delivered.value).toBe(0)
  expect(mms.clickRate.value).toBeNull()                                                                    // nothing delivered: a dash, never 0%
})

test('a campaign filter sums the campaign rows, since the report takes no ids; revenue null means attribution is not set up', async () => {
  const calls = installMockApi()
  const two = await ready((source) => source.useKpis(filters({ campaignIds: ['c1', 'c3'] })))
  expect(paths(calls, '/reports/summary/').some((path) => path.includes('c1'))).toBe(false)
  expect(two.delivered.value).toBe(11_994)
  expect(two.openRate.value).toBe(43.6)
  expect(two.attributedRevenue.value).toBe(31_880)
  const sms = await ready((source) => source.useKpis(filters({ campaignIds: ['c3'] })))
  expect(sms.attributionSetUp).toBe(false)
  expect(sms.attributedRevenue.value).toBeNull()
})

test('the page on the live source: the ROI tile reads the overview’s cost; revenue tiles are Not Set Up when null; Journey is a button that opens its Setup, never a link', async () => {
  installMockApi()
  const { wrapper } = await load()
  const { HomePage } = await import('../HomePage')
  render(<HomePage />, { wrapper })
  const roi = await waitFor(() => {
    const node = document.querySelector('[data-kpi="Campaign ROI"]') as HTMLElement
    expect(node.textContent).toMatch(/campaign cost|×/)
    return node
  })
  expect(roi.querySelector('[data-kpi-loading]')).toBeNull()
  expect(document.querySelector('[data-kpi="Attributed Revenue"]')!.textContent).toMatch(/Attributed to campaigns|on the previous period/)
  expect(within(screen.getByRole('region', { name: 'Create New' })).queryByRole('link', { name: 'Journey' })).toBeNull()
  cleanup()

  const { wrapper: again } = await load('/?campaigns=c3')
  const { HomePage: Page } = await import('../HomePage')
  render(<Page />, { wrapper: again })
  await waitFor(() => expect(document.querySelector('[data-kpi="Attributed Revenue"]')!.textContent).toContain('Not Set Up Yet'))
  expect(document.querySelector('[data-kpi="Campaign ROI"]')!.textContent).toContain('Not Set Up Yet')
})

test('without report.view no summary is asked for', async () => {
  const calls = installMockApi()
  const { liveSource, wrapper } = await load()
  const { result } = renderHook(() => liveSource.useKpis(filters(), { enabled: false }), { wrapper })
  expect(result.current.status).toBe('unavailable')
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(paths(calls, '/reports/summary/')).toEqual([])
})

test('the funnel from /reports/summary/: by_channel for the counts, the campaign rows for conversions; no opens off email', async () => {
  installMockApi()
  const funnel = await ready((source) => source.useFunnel(filters()))
  expect(funnel).toEqual([
    { channel: 'EMAIL', delivered: 17_630, opened: 7_491, clicked: 1_120, converted: 212 },
    { channel: 'SMS', delivered: 294, opened: null, clicked: 9, converted: 0 },
  ])
  const one = await ready((source) => source.useFunnel(filters({ campaignIds: ['c1'] })))
  expect(one).toEqual([{ channel: 'EMAIL', delivered: 11_700, opened: 5_100, clicked: 800, converted: 150 }])
})

test('the funnel and the KPIs share one request per period', async () => {
  const calls = installMockApi()
  const { liveSource, wrapper } = await load()
  const { result } = renderHook(() => ({ kpis: liveSource.useKpis(filters()), funnel: liveSource.useFunnel(filters()) }), { wrapper })
  await waitFor(() => expect([result.current.kpis.status, result.current.funnel.status]).toEqual(['ready', 'ready']))
  expect(paths(calls, '/reports/summary/')).toHaveLength(2)                                                   // this period and the one before, not three
})

test('Revenue vs. Cost, Governance, Active Journeys and Needs Attention share one GET /home/overview/ for the filters', async () => {
  const calls = installMockApi()
  const { liveSource, wrapper } = await load()
  const { result } = renderHook(() => ({
    revenue: liveSource.useRevenueCost(filters({ channel: 'SMS', campaignIds: ['c1', 'c3'] })), governance: liveSource.useGovernance(filters({ channel: 'SMS', campaignIds: ['c1', 'c3'] })),
    journeys: liveSource.useJourneys(filters({ channel: 'SMS', campaignIds: ['c1', 'c3'] })), attention: liveSource.useAttention(filters({ channel: 'SMS', campaignIds: ['c1', 'c3'] })),
  }), { wrapper })
  await waitFor(() => expect(Object.values(result.current).map((part) => part.status)).toEqual(['ready', 'ready', 'ready', 'ready']))
  expect(paths(calls, '/home/overview/')).toEqual([expect.stringMatching(/^\/home\/overview\/\?from=.*&to=.*&channel=SMS&campaigns=c1%2Cc3$/)])
})

test('Revenue vs. Cost from the overview: the points, the top campaigns with the rest as one row, the four figures', async () => {
  installMockApi()
  const series = await ready((source) => source.useRevenueCost(filters()))
  expect(series.granularity).toBe('day')
  expect(series.points[0]).toEqual({ day: '2026-09-01', revenue: 6_000, cost: 400, targetPace: 7_000 })
  expect(series.byCampaign.top.map((row) => row.name)).toEqual(['Fall Launch', 'Spring Clearance'])
  expect(series.byCampaign.others).toEqual({ count: 3, revenue: 2_400 })
  expect(series.summary).toEqual({ revenue: 42_400, cost: 2_100, roi: 20.19, revenuePer1000Delivered: 2_365.6 })
})

test('a part the viewer cannot read is null in the overview and unavailable on the page', async () => {
  installMockApi({ workspaceTools: { overview: { ...homeOverview(), revenue_cost: null, governance: null, journeys: null } } })
  const { liveSource, wrapper } = await load()
  const { result } = renderHook(() => ({ revenue: liveSource.useRevenueCost(filters()), governance: liveSource.useGovernance(filters()), journeys: liveSource.useJourneys(filters()) }), { wrapper })
  await waitFor(() => expect(Object.values(result.current).map((part) => part.status)).toEqual(['unavailable', 'unavailable', 'unavailable']))
})

test('Governance from the overview: contacted, held back, the three reasons', async () => {
  installMockApi()
  expect(await ready((source) => source.useGovernance(filters()))).toEqual({ contacted: 12_380, heldBack: 940, reasons: { frequencyCap: 500, noConsent: 300, suppression: 140 } })
})

test('Active Journeys from the overview: a failing step with its time in the workspace zone, who paused, the channels', async () => {
  installMockApi()
  const journeys = await ready((source) => source.useJourneys(filters()))
  expect(journeys.totalJourneys).toBe(3)
  expect(journeys.rows.map((row) => [row.name, row.status, row.contextLine, row.inFlight, row.entered, row.conversionRate])).toEqual([
    ['Cart Recovery', 'FAILED', 'SMS step failing since 00:12 EDT', 1_206, 9_480, 12.9],
    ['Birthday Reward', 'PAUSED', 'Paused by Maya Patel, 28 Sep', 640, 1_880, 15.2],
    ['Welcome Series', 'ACTIVE', 'Email, SMS', 3_842, 6_120, 8.4],
  ])
})

const targets = (revenue: string) => ({ target_revenue: revenue, target_opens: null, target_clicks: null, target_conversions: null, target_redemptions: null, planned_cost: null, planned_offer_cost: null, notes: null })

test('Top and Bottom, target mode: the report’s campaign rows joined with each campaign’s target from the campaign list', async () => {
  const calls = installMockApi({ campaigns: [
    makeCampaign({ id: 'c1', name: 'Fall Launch', status: 'PRODUCTION_PUBLISHED', targets: targets('30000') }),
    makeCampaign({ id: 'c2', name: 'Spring Clearance', status: 'COMPLETED', targets: targets('20000') }),
  ] })
  const ranked = await ready((source) => source.useTopBottom(filters()))
  expect(ranked.mode).toBe('target')
  expect(ranked.top.map((row) => [row.id, row.value, row.figure])).toEqual([['c1', 106, 31_880]])                   // $31,880 of $30,000
  expect(ranked.bottom.map((row) => [row.id, row.value])).toEqual([['c2', 82]])
  expect(ranked.unmatched).toBe(1)                                                                                 // Weekend SMS is in the report but not in the list
  const list = paths(calls, '/campaigns/?').find((path) => path.includes('ordering=-updated_at'))!
  expect(new URL(list, 'http://x').searchParams.get('status')).toBe('PRODUCTION_PUBLISHED,SCHEDULED,ACTIVE,PAUSED,COMPLETED,CANCELLED')
  expect(list).toContain('page_size=200')                                                                        // one page, shared with the Campaign filter
})

test('Top and Bottom without attributed revenue: click rate against the average, from the report alone', async () => {
  const calls = installMockApi()
  const ranked = await ready((source) => source.useTopBottom(filters({ campaignIds: ['c3'] })))                   // Weekend SMS has no revenue
  expect(ranked).toMatchObject({ mode: 'clickRate', average: 3.1 })
  expect(ranked.top.map((row) => [row.id, row.value, row.change])).toEqual([['c3', 3.1, 0]])
  expect(paths(calls, '/campaigns/?').filter((path) => path.includes('ordering=-updated_at'))).toEqual([])
})

const ZONE = 'America/New_York'
const runAt = (id: string, at: string, status = 'SCHEDULED', label: string | null = null) => ({
  id, campaign: 'x', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status, test_mode: false, scheduled_at: at, started_at: status === 'COMPLETED' ? at : null,
  completed_at: null, created_at: at, updated_at: at, row_version: 1, sequence_label: label,
}) as Campaign['runs'][number]

function calendarWorkspace() {
  const today = todayIn(ZONE)
  return [
    makeCampaign({ id: 'c-a', name: 'Fall Launch', channel: 'EMAIL', status: 'PRODUCTION_PUBLISHED', runs: [
      runAt('r1', atZone(today, '00:01', ZONE), 'COMPLETED'),
      runAt('r2', atZone(addDays(today, 1), '22:30', ZONE)),                                        // 02:30 UTC the day after: still tomorrow in New York
    ] }),
    makeCampaign({ id: 'c-j', name: 'Welcome Series', channel: 'SMS', status: 'ACTIVE', is_journey_generated: true, runs: [runAt('r3', atZone(addDays(today, 2), '09:00', ZONE), 'SCHEDULED', 'Step 2')] }),
    makeCampaign({ id: 'c-late', name: 'Holiday', channel: 'SMS', status: 'PRODUCTION_PUBLISHED', runs: [runAt('r4', atZone(addDays(today, 9), '09:00', ZONE))] }),
  ]
}

test('the schedule from /campaigns/calendar/: the next seven days in the workspace zone, journey runs marked, sent runs marked', async () => {
  const calls = installMockApi({ campaigns: calendarWorkspace() })
  const schedule = await ready((source) => source.useSchedule(filters()))
  const today = todayIn(ZONE)
  const call = paths(calls, '/campaigns/calendar/')[0]
  expect(new URL(call, 'http://x').searchParams.get('date_from')).toBe(today)
  expect(new URL(call, 'http://x').searchParams.get('date_to')).toBe(addDays(today, 6))
  expect(schedule.timezone).toBe(ZONE)
  expect(schedule.total).toBe(3)
  expect(schedule.days.map((day) => day.runs.length)).toEqual([1, 1, 1, 0, 0, 0, 0])
  expect(schedule.days[0].runs[0]).toMatchObject({ name: 'Fall Launch', source: 'campaign', campaignId: 'c-a', channel: 'EMAIL', sent: true })
  expect(schedule.days[1].runs[0]).toMatchObject({ source: 'campaign', sent: false })
  expect(schedule.days[2].runs[0]).toMatchObject({ name: 'Welcome Series, Step 2', source: 'journey', campaignId: null, channel: 'SMS' })
  expect(schedule.days[2]).toMatchObject({ campaignRuns: 0, journeyRuns: 1 })
})

test('the schedule passes the channel on, and a campaign filter keeps those campaigns and drops journey runs', async () => {
  const calls = installMockApi({ campaigns: calendarWorkspace() })
  const sms = await ready((source) => source.useSchedule(filters({ channel: 'SMS' })))
  expect(paths(calls, '/campaigns/calendar/').at(-1)).toContain('channel=SMS')
  expect(sms.total).toBe(1)
  const one = await ready((source) => source.useSchedule(filters({ campaignIds: ['c-a', 'c-j'] })))
  expect(one.days.flatMap((day) => day.runs.map((run) => run.name))).toEqual(['Fall Launch', 'Fall Launch'])
})

test('Recent Campaigns: the 50 latest from the list, joined by id with the period’s report rows and each campaign’s target', async () => {
  const calls = installMockApi({ campaigns: [
    makeCampaign({ id: 'c1', name: 'Fall Launch', channel: 'EMAIL', status: 'PRODUCTION_PUBLISHED', targets: targets('30000') }),
    makeCampaign({ id: 'c3', name: 'Weekend SMS', channel: 'SMS', status: 'PRODUCTION_PUBLISHED' }),
    makeCampaign({ id: 'c9', name: 'Not Sent Yet', channel: 'EMAIL', status: 'DRAFT' }),
    makeCampaign({ id: 'c-failed', name: 'Broke', channel: 'EMAIL', status: 'PRODUCTION_PUBLISHED' }),
  ] })
  const recent = await ready((source) => source.useRecentCampaigns(filters()))
  expect(recent.total).toBe(4)
  expect(recent.attributionSetUp).toBe(true)
  const row = (id: string) => recent.rows.find((item) => item.id === id)!
  expect(row('c1')).toMatchObject({ delivered: 11_700, openRate: 43.6, revenue: 31_880, target: 30_000, status: 'PRODUCTION_PUBLISHED', attention: 4 })
  expect(row('c-failed')).toMatchObject({ attention: 0 })                                                        // the overview's failed ids mark the row
  expect(row('c3')).toMatchObject({ delivered: 294, openRate: 'not_tracked', revenue: null, target: null })
  expect(row('c9')).toMatchObject({ delivered: null, openRate: null, status: 'DRAFT' })
  expect(row('c9').contextLine).toMatch(/^Regular · edited \d{1,2} [A-Z][a-z]{2} \d{4}$/)
  const list = new URL(paths(calls, '/campaigns/?').find((path) => path.includes('page_size=50'))!, 'http://x').searchParams
  expect([list.get('ordering'), list.get('status')]).toEqual(['-updated_at', null])

  await ready((source) => source.useRecentCampaigns(filters({ channel: 'SMS' }), 'LIVE'))
  const live = new URL(paths(calls, '/campaigns/?').filter((path) => path.includes('page_size=50')).at(-1)!, 'http://x').searchParams
  expect([live.get('status'), live.get('channel')]).toEqual(['PRODUCTION_PUBLISHED,ACTIVE', 'SMS'])
})

test('e-receipts come out of the marketing figures and go to their own tile', async () => {
  const receipt = { ...reportSummary.campaigns[0], id: 'rcpt', name: 'Store Receipts', campaign_type: 'E_RECEIPT', sent: 5_000, delivered: 4_900, opened: 2_450, clicked: 300, revenue: 1_200, conversions: 40 }
  const original = { ...reportSummary, campaigns: [...reportSummary.campaigns], totals: { ...reportSummary.totals }, by_channel: { ...reportSummary.by_channel } }
  Object.assign(reportSummary, {
    campaigns: [...reportSummary.campaigns, receipt],
    totals: { ...reportSummary.totals, sent: reportSummary.totals.sent + 5_000, delivered: reportSummary.totals.delivered + 4_900, clicked: reportSummary.totals.clicked + 300, revenue: 49_410.5, conversions: 252 },
    by_channel: { ...reportSummary.by_channel, EMAIL: { ...reportSummary.by_channel.EMAIL, delivered: reportSummary.by_channel.EMAIL.delivered + 4_900, opened: reportSummary.by_channel.EMAIL.opened + 2_450, clicked: reportSummary.by_channel.EMAIL.clicked + 300 } },
  })
  try {
    installMockApi()
    const kpis = await ready((source) => source.useKpis(filters()))
    expect(kpis.delivered.value).toBe(17_924)                                                                    // as before the receipts
    expect(kpis.openRate.opened).toBe(7_491)
    expect(kpis.attributedRevenue.value).toBe(48_210.5)
    expect(kpis.conversions.value).toBe(212)
    const funnel = await ready((source) => source.useFunnel(filters()))
    expect(funnel[0]).toEqual({ channel: 'EMAIL', delivered: 17_630, opened: 7_491, clicked: 1_120, converted: 212 })
    const tile = await ready((source) => source.useEReceipts(filters({ channel: 'SMS', campaignIds: ['c1'] })))   // Home's filters don't apply
    expect(tile).toEqual({ sent: 5_000, openRate: 50, offerClicks: 300, offerRevenue: 1_200 })
  } finally {
    Object.assign(reportSummary, original)
  }
})

test('no e-receipts in the period: the tile has nothing to show', async () => {
  installMockApi()
  expect(await ready((source) => source.useEReceipts(filters()))).toBeNull()
})
