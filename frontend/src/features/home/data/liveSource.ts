/** The real page's source. Sections the API can feed are wired; the rest are 'unavailable' (hidden) until a later phase. */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { api, ApiError } from '@/lib/api'
import { formatClock, zoneAbbreviation } from '@/lib/format'
import { typeShortLabel } from '@/features/campaigns/vocabulary'
import { addDays, todayIn } from '@/features/reports/period'
import type { Campaign, CampaignCalendarData, CountedPage, ReportCampaignRow, ReportSummary } from '@/lib/types'

import { homePeriod, PERIOD_DAYS } from '../period'
import { useHomeData } from './homeDataContext'
import { buildKpis, sumFigures, type CampaignFigures, type Figures } from './kpiMath'
import { rankTopBottom, type RankCandidate } from './rankTopBottom'
import { marketingOnly, receiptFigures } from './receipts'
import { contextLine } from './recentContext'
import type { Attention, AttentionGroup, CampaignOptions, EReceipts, FunnelChannel, HomeDataSource, HomeFilters, Kpis, MessageChannel, RecentCampaigns, RecentStatus, Schedule, ScheduledRun, SectionResult, TopBottom } from './types'

const unavailable = <T,>(): SectionResult<T> => ({ status: 'unavailable' })
/** the attention view is read in one page; a longer list shows as "100+" */
const PAGE = 100

/** a section whose request the viewer may not make (403) hides like one the API can't feed */
const forbidden = (error: unknown) => error instanceof ApiError && error.status === 403

function combine<T>(queries: UseQueryResult<unknown>[], build: () => T): SectionResult<T> {
  const failed = queries.find((query) => query.isError)
  if (failed && forbidden(failed.error)) return { status: 'unavailable' }
  if (failed) return { status: 'error', error: failed.error, retry: () => queries.forEach((query) => void query.refetch()) }
  if (queries.some((query) => query.isPending)) return { status: 'loading' }
  return { status: 'ready', data: build() }
}

const GROUPS = {
  failures: { id: 'delivery-failures', severity: 'critical', category: 'Delivery Failure', label: 'Campaigns with delivery failures', actionLabel: 'Review Failures', href: '/campaigns?saved=attention' },
  publish: { id: 'awaiting-publish', severity: 'blocking', category: 'Blocking a Send', label: 'Campaigns awaiting production publish', actionLabel: 'Publish', href: '/campaigns?status=TEST_PUBLISHED' },
  approval: { id: 'awaiting-approval', severity: 'blocking', category: 'Blocking a Send', label: 'Campaigns waiting for approval', actionLabel: 'Review', href: '/campaigns?saved=approval' },
} satisfies Record<string, Omit<AttentionGroup, 'count'>>

/** the attention view (paused, a failed send in the last week, waiting for approval), shared by Needs Attention and Recent Campaigns */
const attentionQuery = {
  queryKey: ['home', 'attention', 'failures'],
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<CountedPage<Campaign>>('/campaigns/', { view: 'attention', page_size: PAGE }, signal),
}

/** view=attention is paused, a failed production send in the last 7 days, or waiting for approval: only the failures are left here */
const failedSend = (campaign: Campaign) => campaign.status !== 'PAUSED' && campaign.approval?.status !== 'REQUESTED'

function useAttention(filters: HomeFilters): SectionResult<Attention> {
  const { viewer } = useHomeData()
  const single = filters.campaignIds.length === 1 ? filters.campaignIds[0] : null
  const attention = useQuery(attentionQuery)
  const publish = useQuery({ queryKey: ['home', 'attention', 'publish'], enabled: !single,
    queryFn: ({ signal }) => api.get<CountedPage<Campaign>>('/campaigns/', { status: 'TEST_PUBLISHED', page_size: 1 }, signal) })
  const approval = useQuery({ queryKey: ['home', 'attention', 'approval'], enabled: !single,
    queryFn: ({ signal }) => api.get<CountedPage<Campaign>>('/campaigns/', { approval: 'requested', page_size: 1 }, signal) })
  const one = useQuery({ queryKey: ['campaigns', 'detail', single], enabled: Boolean(single), queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${single}/`, undefined, signal) })

  return combine(single ? [attention, one] : [attention, publish, approval], () => {
    const rows = attention.data!.results
    const loadedAt = Math.max(attention.dataUpdatedAt, publish.dataUpdatedAt, approval.dataUpdatedAt, one.dataUpdatedAt)
    const at = new Date(loadedAt)
    const freshness = `Updated at ${formatClock(at.toISOString(), viewer.timezone)} ${zoneAbbreviation(viewer.timezone, at)}`
    const groups: AttentionGroup[] = single
      ? [
        { ...GROUPS.failures, count: rows.some((row) => row.id === single && failedSend(row)) ? 1 : 0 },
        { ...GROUPS.publish, count: one.data!.status === 'TEST_PUBLISHED' ? 1 : 0 },
        { ...GROUPS.approval, count: one.data!.approval?.status === 'REQUESTED' ? 1 : 0 },
      ]
      : [
        { ...GROUPS.failures, count: rows.filter(failedSend).length, atLeast: attention.data!.count > rows.length },
        { ...GROUPS.publish, count: publish.data!.count },
        { ...GROUPS.approval, count: approval.data!.count },
      ]
    return { groups: groups.filter((group) => group.count > 0), freshness }
  })
}

const rowFigures = (row: ReportCampaignRow): CampaignFigures => {
  const email = row.channel === 'EMAIL'
  return {
    tracksOpens: email, delivered: row.delivered, emailDelivered: email ? row.delivered : 0, opened: email ? row.opened : 0,
    clicked: row.clicked, conversions: row.conversions, revenue: row.revenue,
  }
}

const totalFigures = (summary: ReportSummary): Figures => ({
  delivered: summary.totals.delivered, emailDelivered: summary.by_channel.EMAIL?.delivered ?? 0, opened: summary.by_channel.EMAIL?.opened ?? 0,
  clicked: summary.totals.clicked, conversions: summary.totals.conversions, revenue: summary.totals.revenue,
})

/** the report takes EMAIL or SMS; MMS is counted with SMS */
const reportChannel = (filters: HomeFilters) => (filters.channel === 'ALL' ? undefined : filters.channel === 'MMS' ? 'SMS' : filters.channel)

/** one summary per period and channel, shared by the KPIs and the funnel */
const rawSummaryQuery = (from: string, to: string, channel: string | undefined) => ({
  queryKey: ['home', 'summary', { from, to, channel }],
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<ReportSummary>('/reports/summary/', { from, to, channel }, signal),
})

/** the same request as every marketing figure reads it: e-receipts left out (see marketingOnly) */
const summaryQuery = (from: string, to: string, channel: string | undefined) => ({ ...rawSummaryQuery(from, to, channel), select: marketingOnly })

/**
 * /reports/summary/ takes a period and EMAIL or SMS, not campaign ids and not MMS (MMS is counted with SMS). With a campaign
 * filter or MMS the totals are summed from the campaign rows; otherwise the report's own totals are used.
 */
function useKpis(filters: HomeFilters, options: { enabled?: boolean } = {}): SectionResult<Kpis> {
  const { viewer } = useHomeData()
  const enabled = options.enabled ?? true
  const range = homePeriod(filters.period, viewer.timezone)
  const channel = reportChannel(filters)
  const current = useQuery({ ...summaryQuery(range.from, range.to, channel), enabled })
  const previous = useQuery({ ...summaryQuery(range.previousFrom, range.previousTo, channel), enabled })
  if (!enabled) return unavailable()

  return combine([current, previous], () => {
    const byRows = filters.campaignIds.length > 0 || filters.channel === 'MMS'
    const inScope = (summary: ReportSummary) => summary.campaigns
      .filter((row) => (filters.campaignIds.length === 0 || filters.campaignIds.includes(row.id)) && (filters.channel !== 'MMS' || row.channel === 'MMS'))
    const campaigns = inScope(current.data!).map(rowFigures)
    const figures = (summary: ReportSummary) => (byRows ? sumFigures(inScope(summary).map(rowFigures)) : totalFigures(summary))
    return buildKpis({
      now: figures(current.data!),
      before: figures(previous.data!),
      tracksOpens: filters.channel !== 'SMS' && filters.channel !== 'MMS' && (!byRows || campaigns.some((row) => row.tracksOpens)),
      days: PERIOD_DAYS[filters.period],
      revenueTarget: null, // targets live on each campaign; summing them needs the whole campaign list
      storeRevenue: null, // no endpoint yet
    })
  })
}

const CHANNELS: MessageChannel[] = ['EMAIL', 'SMS', 'MMS']

/**
 * by_channel gives delivered / opened / clicked per family (MMS inside SMS) but no conversions, so conversions come from the
 * campaign rows, which carry their channel. MMS is its campaign rows; SMS is the SMS family less them. A campaign filter uses rows only.
 */
function useFunnel(filters: HomeFilters): SectionResult<FunnelChannel[]> {
  const { viewer } = useHomeData()
  const range = homePeriod(filters.period, viewer.timezone)
  const reports = viewer.can('report.view')
  const current = useQuery({ ...summaryQuery(range.from, range.to, reportChannel(filters)), enabled: reports })
  if (!reports) return unavailable()
  return combine([current], () => {
    const summary = current.data!
    const rows = summary.campaigns.filter((row) => filters.campaignIds.length === 0 || filters.campaignIds.includes(row.id))
    const byRows = (channel: MessageChannel) => rows.filter((row) => row.channel === channel)
    const total = (list: ReportCampaignRow[], key: 'delivered' | 'opened' | 'clicked' | 'conversions') => list.reduce((sum, row) => sum + row[key], 0)
    const counts = (channel: MessageChannel) => {
      const own = byRows(channel)
      if (filters.campaignIds.length > 0 || channel === 'MMS') return { delivered: total(own, 'delivered'), opened: total(own, 'opened'), clicked: total(own, 'clicked') }
      const family = summary.by_channel[channel]
      const mms = channel === 'SMS' ? byRows('MMS') : []
      return { delivered: (family?.delivered ?? 0) - total(mms, 'delivered'), opened: family?.opened ?? 0, clicked: (family?.clicked ?? 0) - total(mms, 'clicked') }
    }
    return CHANNELS
      .filter((channel) => filters.channel === 'ALL' || filters.channel === channel)
      .map((channel) => {
        const { delivered, opened, clicked } = counts(channel)
        return { channel, delivered, opened: channel === 'EMAIL' ? opened : null, clicked, converted: total(byRows(channel), 'conversions') }
      })
      .filter((row) => row.delivered > 0)
  })
}

/** campaigns that have sent, most recently changed first: the ones most likely to have results in the period */
const SENT_STATUSES = 'PRODUCTION_PUBLISHED,SCHEDULED,ACTIVE,PAUSED,COMPLETED,CANCELLED'
/** one page of 200 (the list's most): the Campaign filter's choices, and the targets Top and Bottom joins with */
const OPTIONS_PAGE = 200
const sentCampaignsQuery = {
  queryKey: ['campaigns', 'home-sent', { status: SENT_STATUSES, ordering: '-updated_at', page_size: OPTIONS_PAGE }],
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<CountedPage<Campaign>>('/campaigns/', { status: SENT_STATUSES, ordering: '-updated_at', page_size: OPTIONS_PAGE }, signal),
}

/**
 * Target mode joins the report's campaign rows with each campaign's target from the campaign list; a campaign the list
 * didn't return is left out (counted as unmatched). With no attribution, or no targets in the list, it ranks by click rate.
 */
function useTopBottom(filters: HomeFilters): SectionResult<TopBottom> {
  const { viewer } = useHomeData()
  const range = homePeriod(filters.period, viewer.timezone)
  const channel = reportChannel(filters)
  const reports = viewer.can('report.view')
  const current = useQuery({ ...summaryQuery(range.from, range.to, channel), enabled: reports })
  const previous = useQuery({ ...summaryQuery(range.previousFrom, range.previousTo, channel), enabled: reports })
  const inScope = (summary: ReportSummary) => summary.campaigns
    .filter((row) => (filters.campaignIds.length === 0 || filters.campaignIds.includes(row.id)) && (filters.channel !== 'MMS' || row.channel === 'MMS'))
  const byRows = filters.campaignIds.length > 0 || filters.channel === 'MMS'
  const attributed = current.data ? (byRows ? sumFigures(inScope(current.data).map(rowFigures)) : totalFigures(current.data)).revenue !== null : false
  const campaigns = useQuery({ ...sentCampaignsQuery, enabled: attributed, select: (page: CountedPage<Campaign>) => page.results })
  if (!reports) return unavailable()

  return combine(attributed ? [current, previous, campaigns] : [current, previous], () => {
    const rows = inScope(current.data!)
    const before = new Map(inScope(previous.data!).map((row) => [row.id, row]))
    const targets = new Map((campaigns.data ?? []).map((campaign) => [campaign.id, campaign.targets]))
    const hasTargets = (campaigns.data ?? []).some((campaign) => campaign.targets !== undefined)
    const candidates: RankCandidate[] = rows.map((row) => {
      const earlier = before.get(row.id)
      const target = Number(targets.get(row.id)?.target_revenue ?? 0)
      return {
        id: row.id, name: row.name, channel: row.channel as MessageChannel, delivered: row.delivered, clicked: row.clicked, revenue: row.revenue,
        target: target > 0 ? target : null,
        previousRevenue: earlier?.revenue ?? null,
        previousClickRate: earlier && earlier.delivered > 0 ? (earlier.clicked / earlier.delivered) * 100 : null,
      }
    })
    if (attributed && hasTargets) {
      return { ...rankTopBottom({ mode: 'target', candidates }), unmatched: rows.filter((row) => !targets.has(row.id)).length }
    }
    const totals = byRows ? sumFigures(rows.map(rowFigures)) : totalFigures(current.data!)
    return rankTopBottom({ mode: 'clickRate', candidates, average: totals.delivered ? Math.round((totals.clicked / totals.delivered) * 1000) / 10 : null })
  })
}

/**
 * The next seven days from the campaign calendar. PROJECTED sends are a recurrence's coming occurrences (real runs the
 * planner hasn't created yet), so they count; PLANNED ones belong to unpublished drafts, so they don't.
 */
function useSchedule(filters: HomeFilters): SectionResult<Schedule> {
  const { viewer } = useHomeData()
  const today = todayIn(viewer.timezone)
  const window = { date_from: today, date_to: addDays(today, 6) }
  const channel = filters.channel === 'ALL' ? undefined : filters.channel
  const calendar = useQuery({
    queryKey: ['campaigns', 'calendar', window, { channel }],
    queryFn: ({ signal }) => api.get<CampaignCalendarData>('/campaigns/calendar/', { ...window, channel }, signal),
  })
  return combine([calendar], () => {
    const data = calendar.data!
    const zone = data.timezone || viewer.timezone
    const now = calendar.dataUpdatedAt // when the calendar loaded: "earlier than now" at that moment
    const byDay = new Map<string, ScheduledRun[]>()
    for (const span of data.spans) {
      if (filters.campaignIds.length > 0 && (span.is_journey_generated || !filters.campaignIds.includes(span.campaign))) continue
      if (channel && span.channel !== channel) continue
      span.sends.forEach((send, index) => {
        if (send.state === 'PLANNED') return
        const day = todayIn(zone, new Date(send.at))
        if (day < window.date_from || day > window.date_to) return
        const runs = byDay.get(day) ?? []
        runs.push({
          id: `${span.campaign}-${index}`, at: send.at, channel: span.channel as MessageChannel, name: send.label ? `${span.name}, ${send.label}` : span.name,
          source: span.is_journey_generated ? 'journey' : 'campaign', campaignId: span.is_journey_generated ? null : span.campaign,
          sent: send.state === 'SENT' || send.state === 'SENDING' || new Date(send.at).getTime() < now,
        })
        byDay.set(day, runs)
      })
    }
    const days = Array.from({ length: 7 }, (_, offset) => {
      const day = addDays(window.date_from, offset)
      const runs = (byDay.get(day) ?? []).sort((a, b) => a.at.localeCompare(b.at))
      return { day, campaignRuns: runs.filter((run) => run.source === 'campaign').length, journeyRuns: runs.filter((run) => run.source === 'journey').length, runs }
    })
    return { timezone: zone, days, total: days.reduce((total, day) => total + day.runs.length, 0) }
  })
}

/** e-receipts over the period, whatever Home's Campaign and Channel filters say */
function useEReceipts(filters: HomeFilters): SectionResult<EReceipts | null> {
  const { viewer } = useHomeData()
  const range = homePeriod(filters.period, viewer.timezone)
  const reports = viewer.can('report.view')
  const summary = useQuery({ ...rawSummaryQuery(range.from, range.to, undefined), select: receiptFigures, enabled: reports })
  if (!reports) return unavailable()
  return combine([summary], () => summary.data ?? null)
}

const RECENT_PAGE = 50
/** Live on the list's own statuses: production published, or active (sending now) */
const RECENT_STATUS: Record<RecentStatus, string | undefined> = { ALL: undefined, LIVE: 'PRODUCTION_PUBLISHED,ACTIVE', SCHEDULED: 'SCHEDULED', DRAFT: 'DRAFT' }
const latest = (values: (string | null | undefined)[]) => values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null

/**
 * The 50 most recently changed campaigns for the card's Status and Home's Channel, joined by id with the period's report
 * rows for their figures. Best Performing and Needs Attention sort within those 50, on the page.
 */
function useRecentCampaigns(filters: HomeFilters, status: RecentStatus = 'ALL'): SectionResult<RecentCampaigns> {
  const { viewer } = useHomeData()
  const zone = viewer.timezone
  const range = homePeriod(filters.period, zone)
  const channel = filters.channel === 'ALL' ? undefined : filters.channel
  const query = { ordering: '-updated_at', page_size: RECENT_PAGE, status: RECENT_STATUS[status], channel }
  const list = useQuery({ queryKey: ['campaigns', 'home-recent', query], queryFn: ({ signal }) => api.get<CountedPage<Campaign>>('/campaigns/', query, signal) })
  // without report.view the list still shows, with no figures
  const reports = viewer.can('report.view')
  const summary = useQuery({ ...summaryQuery(range.from, range.to, reportChannel(filters)), enabled: reports })
  const attention = useQuery(attentionQuery)

  return combine(reports ? [list, summary, attention] : [list, attention], () => {
    const report = new Map((summary.data?.campaigns ?? []).map((row) => [row.id, row]))
    const failed = new Set(attention.data!.results.filter(failedSend).map((campaign) => campaign.id))
    const picked = filters.campaignIds.length > 0 ? list.data!.results.filter((campaign) => filters.campaignIds.includes(campaign.id)) : list.data!.results
    const rows = picked.map((campaign) => {
      const row = report.get(campaign.id)
      const delivered = row && row.delivered > 0 ? row.delivered : null
      const production = (campaign.runs ?? []).filter((run) => !run.test_mode)
      const lastSentAt = latest(production.map((run) => run.completed_at ?? run.started_at))
      const email = campaign.channel === 'EMAIL'
      const target = Number(campaign.targets?.target_revenue ?? 0)
      return {
        id: campaign.id,
        name: campaign.name,
        contextLine: contextLine({
          typeLabel: typeShortLabel(campaign.campaign_type), status: campaign.display_status, editedAt: campaign.updated_at, nextRunAt: campaign.next_run_at,
          testSentAt: latest((campaign.runs ?? []).filter((run) => run.test_mode).map((run) => run.started_at)), lastSentAt,
          sendingNow: production.some((run) => run.status === 'SENDING' || run.status === 'PREPARING'),
        }, zone),
        channel: campaign.channel as MessageChannel,
        status: campaign.display_status,
        statusLabel: campaign.display_status_label,
        delivered,
        openRate: delivered === null ? null : email ? Math.round((row!.opened / delivered) * 1000) / 10 : 'not_tracked' as const,
        clickRate: delivered === null ? null : Math.round((row!.clicked / delivered) * 1000) / 10,
        revenue: row?.revenue ?? null,
        target: target > 0 ? target : null,
        lastActivity: latest([campaign.updated_at, lastSentAt])!,
        attention: failed.has(campaign.id) ? 0 : campaign.approval?.status === 'REQUESTED' ? 1 : campaign.display_status === 'TEST_PUBLISHED' ? 2 : campaign.display_status === 'PAUSED' ? 3 : 4,
      }
    })
    return { rows, total: filters.campaignIds.length > 0 ? rows.length : list.data!.count, attributionSetUp: !summary.data || summary.data.totals.revenue !== null }
  })
}

/** the sent campaigns without e-receipts (they are kept out of the marketing figures) */
function useCampaignOptions(): SectionResult<CampaignOptions> {
  const list = useQuery(sentCampaignsQuery)
  return combine([list], () => ({
    options: list.data!.results.filter((campaign) => campaign.campaign_type !== 'E_RECEIPT').map((campaign) => ({ id: campaign.id, name: campaign.name, channel: campaign.channel as MessageChannel })),
    more: list.data!.count > list.data!.results.length,
  }))
}

export const liveSource: HomeDataSource = {
  capabilities: { journeyCreateFlow: false },
  useCampaignOptions, // GET /campaigns/?status=…&ordering=-updated_at&page_size=200 (one page; the menu says so when there are more)
  useAttention, // GET /campaigns/?view=attention, ?status=TEST_PUBLISHED, ?approval=requested; bounce rate, frequency caps and journey alerts: no endpoint yet
  useKpis, // GET /reports/summary/ for this period and the one before
  useTopBottom, // GET /reports/summary/ (this period and the one before) joined with GET /campaigns/ targets
  useRevenueCost: unavailable, // no endpoint yet: /reports/summary/ days carry no revenue, and actual cost (campaign_actual) is per campaign, not per day
  useFunnel, // GET /reports/summary/ (the KPIs' own request): by_channel and the campaign rows
  useSchedule, // GET /campaigns/calendar/?date_from&date_to (journey runs come as journey-generated campaigns)
  useJourneys: unavailable, // no journey stats endpoint yet: GET /journeys/ has names and statuses, no in-flight, entered, conversion or failure reason
  useRecentCampaigns, // GET /campaigns/?ordering=-updated_at&page_size=50 joined with GET /reports/summary/; the other sorts are within those 50
  useGovernance: unavailable, // no governance endpoint yet: /suppressions/summary/ counts suppressed contacts, not customers held back by caps or consent
  useEReceipts, // the e-receipt campaign rows of GET /reports/summary/ (the marketing figures leave them out)
}
