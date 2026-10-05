/** The shapes every Home section reads, whichever source feeds them (sample data now, the API later). */
import type { Feature, PermissionCode, WorkspaceSetup } from '@/lib/types'

export type HomeChannel = 'ALL' | 'EMAIL' | 'SMS' | 'MMS'
export type MessageChannel = Exclude<HomeChannel, 'ALL'>
export type HomePeriod = '7d' | '30d' | '90d'

export interface HomeFilters {
  campaignIds: string[]
  channel: HomeChannel
  period: HomePeriod
}

export const DEFAULT_FILTERS: HomeFilters = { campaignIds: [], channel: 'ALL', period: '30d' }

/** 'unavailable': the backend cannot provide this yet, so the section hides */
export type SectionResult<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'unavailable' }
  | { status: 'ready'; data: T }

/** the Campaign filter's choices; `more`: there were more campaigns than the list returned */
export interface CampaignOptions {
  options: CampaignOption[]
  more: boolean
}

export interface CampaignOption {
  id: string
  name: string
  channel: MessageChannel
}

export type Severity = 'critical' | 'blocking' | 'governance'

export interface AttentionGroup {
  id: string
  severity: Severity
  /** the tag text: "Delivery Failure", "Blocking a Send", "Governance" */
  category: string
  count: number
  /** a sentence: "Campaigns with delivery failures" */
  label: string
  /** the count is a floor: more exist than were counted ("100+") */
  atLeast?: boolean
  actionLabel: string
  href: string
}

export interface Attention {
  groups: AttentionGroup[]
  /** "Updated today at 6:00 AM", "Updated at 14:05 EDT" */
  freshness: string
}

/** previous is null when there is no earlier figure to compare with */
export interface KpiValue<T> {
  value: T
  previous: T | null
}

/** Rates are null when nothing was delivered: shown as "—", never 0%. */
export interface Kpis {
  delivered: KpiValue<number>
  /** email only; 'not_tracked' when nothing in scope reports opens (SMS, MMS) */
  openRate: KpiValue<number | null | 'not_tracked'> & { opened: number | null }
  clickRate: KpiValue<number | null> & { clicked: number }
  conversions: KpiValue<number> & { percentOfClicks: number | null }
  /** null without attribution: never shown as $0 */
  attributedRevenue: KpiValue<number | null>
  /** attributed revenue as a percentage of store revenue; null when store revenue isn't known */
  contribution: KpiValue<number | null>
  attributionSetUp: boolean
  revenueTarget: number | null
  storeRevenue: number | null
  perDayDelivered: number
}

/** target: attributed revenue against each campaign's target; clickRate (no attribution): click rate against the account average */
export type TopBottomMode = 'target' | 'clickRate'

export interface TopBottomRow {
  id: string
  name: string
  channel: MessageChannel
  /** percent of target, or the click rate */
  value: number
  /** value less the centre (100%, or the average): the bar's direction and length */
  deviation: number
  /** 0–1: the bar's share of its half, against the largest deviation shown */
  scale: number
  /** revenue (target mode) or the click rate (clickRate mode) */
  figure: number
  /** on the previous period: % for revenue, points for click rate; null with no earlier figure */
  change: number | null
}

export interface TopBottom {
  mode: TopBottomMode
  top: TopBottomRow[]
  /** the campaigns ranked between the two groups, in `value` units */
  middle: { count: number; min: number; max: number }
  /** weakest last */
  bottom: TopBottomRow[]
  /** the account's click rate for the period (clickRate mode) */
  average: number | null
  /** live target mode: campaigns in the report the campaign list didn't return, so they couldn't be ranked */
  unmatched?: number
}

export interface RevenueCostPoint {
  /** YYYY-MM-DD; the first day of the week when weekly */
  day: string
  revenue: number | null
  cost: number
  targetPace: number | null
}

export interface CampaignRevenue {
  id: string
  name: string
  revenue: number
}

/** revenue is null throughout when attribution isn't set up; cost is always known */
export interface RevenueCostSeries {
  granularity: 'day' | 'week'
  points: RevenueCostPoint[]
  /** the top five campaigns by revenue, then everything else as one row */
  byCampaign: { top: CampaignRevenue[]; others: { count: number; revenue: number } | null }
  /** roi is revenue ÷ cost */
  summary: { revenue: number | null; cost: number; roi: number | null; revenuePer1000Delivered: number | null }
}

export interface FunnelChannel {
  channel: MessageChannel
  delivered: number
  /** null: the channel does not track opens */
  opened: number | null
  clicked: number
  /** null: conversions can't be split out for this channel */
  converted: number | null
}

export interface ScheduledRun {
  id: string
  at: string
  channel: MessageChannel
  name: string
  source: 'campaign' | 'journey'
  /** the run's campaign, for the Campaign filter; null for a run no campaign filter can pick */
  campaignId: string | null
  /** sent or sending, or its time has passed */
  sent: boolean
}

export interface ScheduleDay {
  /** YYYY-MM-DD in the workspace zone */
  day: string
  campaignRuns: number
  journeyRuns: number
  runs: ScheduledRun[]
}

/** today and the six days after it, in `timezone` */
export interface Schedule {
  timezone: string
  days: ScheduleDay[]
  total: number
}

export interface JourneyRow {
  id: string
  name: string
  status: 'ACTIVE' | 'PAUSED' | 'FAILED'
  contextLine: string
  inFlight: number
  entered: number
  conversionRate: number
}

export interface Journeys {
  /** every journey the source knows; the card shows the top five */
  rows: JourneyRow[]
  totalJourneys: number
}

/** the Recent Campaigns card's own Status chip: Live is production published or sending now */
export type RecentStatus = 'ALL' | 'LIVE' | 'SCHEDULED' | 'DRAFT'

export interface RecentCampaignRow {
  id: string
  name: string
  /** "Regular · sends 2 Oct 2026, 08:00 EDT": the type, then what happened last */
  contextLine: string
  channel: MessageChannel
  /** display status and its label, for StatusBadge */
  status: string
  statusLabel?: string
  /** null: nothing delivered in the period */
  delivered: number | null
  openRate: number | null | 'not_tracked'
  clickRate: number | null
  revenue: number | null
  target: number | null
  /** the last thing that happened to it (edited or sent), for Most Recent */
  lastActivity: string
  /** the campaign's owner by name; null when nobody owns it */
  owner: string | null
  /** for Needs Attention: 0 a failed send, 1 waiting for approval, 2 awaiting production publish, 3 paused, 4 the rest */
  attention: number
}

export interface RecentCampaigns {
  /** every campaign that matches (the card sorts and shows six); live, the latest 50 */
  rows: RecentCampaignRow[]
  total: number
  attributionSetUp: boolean
}

export interface Governance {
  contacted: number
  heldBack: number
  reasons: { frequencyCap: number; noConsent: number; suppression: number }
}

export interface EReceipts {
  sent: number
  openRate: number
  offerClicks: number
  offerRevenue: number | null
}

export interface HomeViewer {
  firstName: string
  timezone: string
  can: (permission: PermissionCode) => boolean
  has: (feature: Feature) => boolean
}

/** One hook per section. Each takes the filters and answers with a SectionResult; the page never fetches directly. */
export interface HomeCapabilities {
  /** a journey can be created from the app: Home's Journey button opens the journey Setup pop-up */
  journeyCreateFlow: boolean
}

export interface HomeDataSource {
  capabilities: HomeCapabilities
  useCampaignOptions: () => SectionResult<CampaignOptions>
  useAttention: (filters: HomeFilters) => SectionResult<Attention>
  /** enabled: false skips the request (a viewer without report.view) */
  useKpis: (filters: HomeFilters, options?: { enabled?: boolean }) => SectionResult<Kpis>
  useTopBottom: (filters: HomeFilters) => SectionResult<TopBottom>
  useRevenueCost: (filters: HomeFilters) => SectionResult<RevenueCostSeries>
  useFunnel: (filters: HomeFilters) => SectionResult<FunnelChannel[]>
  useSchedule: (filters: HomeFilters) => SectionResult<Schedule>
  useJourneys: (filters: HomeFilters) => SectionResult<Journeys>
  useRecentCampaigns: (filters: HomeFilters, status?: RecentStatus) => SectionResult<RecentCampaigns>
  useGovernance: (filters: HomeFilters) => SectionResult<Governance>
  /** ready with null: the workspace sends no e-receipts */
  useEReceipts: (filters: HomeFilters) => SectionResult<EReceipts | null>
  /** the set-up card: null for anyone but an administrator; the card itself decides whether to show */
  useSetup: () => SectionResult<WorkspaceSetup | null>
}
