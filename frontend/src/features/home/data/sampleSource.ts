/**
 * Believable sample data for /dev/home, in four account states. Figures come from the mockup where it gives them
 * (the busy account with no filters); everything else is derived from a small campaign catalogue, so the filters
 * change what the sections show: a channel narrows the campaigns, one campaign shows its own figures, and the period
 * scales the 30-day numbers.
 */
import { addDays, todayIn } from '@/features/reports/period'
import { formatClock, formatShortDay, zoneAbbreviation } from '@/lib/format'
import { atZone } from '@/lib/zonedTime'

import { PERIOD_DAYS } from '../period'
import { buildKpis, sumFigures, type CampaignFigures, type Figures } from './kpiMath'
import { rankTopBottom, type RankCandidate } from './rankTopBottom'
import { contextLine } from './recentContext'
import type {
  AttentionGroup, CampaignOption, EReceipts, FunnelChannel, Governance, HomeDataSource, HomeFilters, Journeys, Kpis, MessageChannel,
  RecentCampaigns, RecentStatus, RevenueCostSeries, Schedule, ScheduledRun, SectionResult, TopBottom, JourneyRow,
} from './types'

/** liveToday: busy figures, but Revenue vs. Cost, Active Journeys and Governance unavailable, as the live source is today */
export type SampleState = 'busy' | 'light' | 'noAttribution' | 'noAlerts' | 'liveToday'

export const SAMPLE_STATES: { value: SampleState; label: string }[] = [
  { value: 'busy', label: 'Busy' },
  { value: 'light', label: 'Light' },
  { value: 'noAttribution', label: 'No Attribution' },
  { value: 'noAlerts', label: 'No Alerts' },
  { value: 'liveToday', label: 'Live Today' },
]

interface SampleCampaign {
  id: string
  name: string
  channel: MessageChannel
  /** 30-day figures */
  delivered: number
  openRate: number | null
  clickRate: number
  conversions: number
  revenue: number
  percentOfTarget: number | null
  change: number | null
  status: string
  daysAgo: number
  contextLine: string
}

const campaign = (
  id: string, name: string, channel: MessageChannel, delivered: number, openRate: number | null, clickRate: number, conversions: number, revenue: number,
  percentOfTarget: number | null, change: number | null, status: string, daysAgo: number, contextLine: string,
): SampleCampaign => ({ id, name, channel, delivered, openRate, clickRate, conversions, revenue, percentOfTarget, change, status, daysAgo, contextLine })

// campaign statuses use the locked vocabulary; the sent ones sum to the mockup's 1,584,560 delivered, 15,890 conversions and $1.39M
const UNSENT = new Set(['DRAFT', 'TEST_PUBLISHED', 'SCHEDULED'])
const BUSY: SampleCampaign[] = [
  campaign('c01', 'October Newsletter', 'EMAIL', 0, null, 0, 0, 0, null, null, 'SCHEDULED', 0, 'Scheduled for 1 Oct, 09:00 · All Subscribers'),
  campaign('c02', 'Holiday Preview', 'EMAIL', 0, null, 0, 0, 0, null, null, 'DRAFT', 1, 'Draft · edited 2 hours ago'),
  campaign('c03', 'Gift Guide 2026', 'EMAIL', 0, null, 0, 0, 0, null, null, 'TEST_PUBLISHED', 2, 'Test sent to 4 reviewers'),
  campaign('c04', 'Weekend Flash Deal', 'SMS', 96_200, null, 2.6, 610, 24_900, 45, -18.7, 'PRODUCTION_PUBLISHED', 3, 'One-time send · All Subscribers'),
  campaign('c05', 'Black Friday Early Access', 'SMS', 0, null, 0, 0, 0, null, null, 'DRAFT', 4, 'Draft · edited yesterday'),
  campaign('c06', 'Fall Boots Launch', 'EMAIL', 286_400, 36.8, 4.4, 3420, 312_800, 112, 9.8, 'PRODUCTION_PUBLISHED', 5, 'One-time send · Loyalty Members'),
  campaign('c07', 'VIP Early Access: Autumn Collection for Platinum and Gold Members', 'EMAIL', 142_000, 51.3, 7.2, 1900, 214_000, 108, 16.4, 'SENDING', 6, 'Sending now · VIP Members'),
  campaign('c08', 'Loyalty Points Statement', 'EMAIL', 164_000, 39.5, 4.6, 1720, 98_400, 109, 4.6, 'PRODUCTION_PUBLISHED', 7, 'Recurring monthly · Loyalty Members'),
  campaign('c09', 'Back to School Bundles', 'EMAIL', 142_000, 36.8, 3.9, 1380, 121_000, 96, 3.2, 'PRODUCTION_PUBLISHED', 8, 'Drip series · Parents'),
  campaign('c10', 'Store Opening, Austin Domain Northside', 'EMAIL', 58_000, 44.1, 3.2, 410, 41_200, 118, 22.0, 'PRODUCTION_PUBLISHED', 9, 'One-time send · Texas Shoppers'),
  campaign('c11', 'Fall Denim Drop', 'EMAIL', 118_000, 18.4, 1.7, 520, 21_300, 28, -31.0, 'PRODUCTION_PUBLISHED', 10, 'One-time send · Denim Fans'),
  campaign('c12', 'Birthday Rewards', 'SMS', 74_000, null, 3.3, 690, 52_000, 88, 1.6, 'PRODUCTION_PUBLISHED', 11, 'Recurring daily · Birthdays Today'),
  campaign('c13', 'Price Drop Alerts', 'SMS', 92_000, null, 2.1, 480, 33_000, 65, -8.9, 'PRODUCTION_PUBLISHED', 12, 'Recurring weekly · Wishlist Owners'),
  campaign('c14', 'Back to School Lookbook', 'MMS', 41_000, null, 2.4, 230, 38_400, 64, -12.4, 'PRODUCTION_PUBLISHED', 13, 'One-time send · Style Club'),
  campaign('c15', 'Weekly Deals Digest', 'EMAIL', 370_960, 29.6, 2.8, 4530, 433_000, 91, -2.3, 'PRODUCTION_PUBLISHED', 14, 'Recurring weekly · Deal Seekers'),
]

const LIGHT: SampleCampaign[] = [
  campaign('l1', 'Welcome Series: New Members', 'EMAIL', 4200, 46.3, 6.4, 96, 7400, 92, 4.1, 'PRODUCTION_PUBLISHED', 1, 'Drip series · New Members'),
  campaign('l2', 'Spring Sale Reminder', 'SMS', 2600, null, 3.1, 41, 2900, 74, -6.3, 'PRODUCTION_PUBLISHED', 4, 'One-time send · All Subscribers'),
]

// 427,821 opens of 1,140,856 email deliveries is the mockup's 37.5%; 15,890 of 61,405 clicks its 25.9%
const MOCKUP = {
  opened: 427_821, emailDelivered: 1_140_856, clicked: 61_405, storeRevenue: 9_600_000, targetRatio: 1_470_000 / 1_390_000,
  // the mockup's figure; the catalogue's own revenue ÷ delivered would give $877.22
  revenuePer1000: 874.75,
  funnel: { delivered: 1_142_300, opened: 427_821, clicked: 49_447, converted: 11_130 },
}
/** the Recent Campaigns Status chip: Live is production published or sending now */
const RECENT_STATUSES: Record<RecentStatus, string[]> = {
  ALL: ['DRAFT', 'TEST_PUBLISHED', 'PRODUCTION_PUBLISHED', 'SCHEDULED', 'SENDING', 'ACTIVE', 'PAUSED', 'COMPLETED'],
  LIVE: ['PRODUCTION_PUBLISHED', 'SENDING', 'ACTIVE'],
  SCHEDULED: ['SCHEDULED'],
  DRAFT: ['DRAFT'],
}
/** the sample's campaign with a failed send, as Needs Attention counts one */
const FAILED_SAMPLE = 'c11'

/** $111.3K of cost on the busy month's 1,584,560 deliveries */
const COST_PER_DELIVERED = 111_300 / 1_584_560
/** the previous period, as the mockup's changes: delivered +6.2%, open +1.1 pt, click −0.3 pt, conversions +4.8%, revenue +9.7%, store revenue +5% */
function previousOf(now: Figures): Figures {
  const delivered = Math.round(now.delivered / 1.062)
  const emailDelivered = Math.round(now.emailDelivered / 1.062)
  const openRate = now.emailDelivered ? (now.opened / now.emailDelivered) * 100 - 1.1 : 0
  const clickRate = now.delivered ? (now.clicked / now.delivered) * 100 + 0.3 : 0
  return {
    delivered, emailDelivered,
    opened: Math.round((emailDelivered * openRate) / 100),
    clicked: Math.round((delivered * clickRate) / 100),
    conversions: Math.round(now.conversions / 1.048),
    revenue: now.revenue === null ? null : Math.round(now.revenue / 1.097),
  }
}

// ranked red, then amber, then periwinkle
const ALERTS: AttentionGroup[] = [
  { id: 'delivery-failures', severity: 'critical', category: 'Delivery Failure', count: 3, label: 'Campaigns with delivery failures', actionLabel: 'Review Failures', href: '/campaigns?view=attention' },
  { id: 'bounce-rate', severity: 'critical', category: 'Delivery Failure', count: 2, label: 'Campaigns with bounce rate above 5%', actionLabel: 'Check Lists', href: '/contact-lists' },
  { id: 'awaiting-publish', severity: 'blocking', category: 'Blocking a Send', count: 4, label: 'Campaigns awaiting production publish', actionLabel: 'Publish', href: '/campaigns?status=TEST_PUBLISHED' },
  { id: 'journey-template', severity: 'blocking', category: 'Blocking a Send', count: 1, label: 'Journey step missing an approved template', actionLabel: 'Fix Journey', href: '/journeys' },
  { id: 'frequency-caps', severity: 'governance', category: 'Governance', count: 21_300, label: 'Customers held back by frequency caps', actionLabel: 'Review Caps', href: '#' },
  { id: 'consent-source', severity: 'governance', category: 'Governance', count: 2, label: 'Contact lists missing consent source', actionLabel: 'Review Lists', href: '/contact-lists' },
]

// the rest of the busy workspace's fourteen journeys, all quieter than the five the card shows
const QUIET_JOURNEYS = ['Post-Purchase Thank You', 'Loyalty Tier Upgrade', 'Replenishment Reminder', 'Review Request', 'VIP Onboarding', 'Back in Stock', 'Store Visit Follow-Up', 'Referral Thank You', 'Points Expiry Nudge']

interface PlannedRun { day: number; time: string; channel: MessageChannel; name: string; source: 'campaign' | 'journey'; campaignId: string | null }
const run = (day: number, time: string, channel: MessageChannel, name: string, source: 'campaign' | 'journey', campaignId: string | null = null): PlannedRun =>
  ({ day, time, channel, name, source, campaignId })

// the mockup's week from today (a Tuesday there): 6, 2, 0, 4, 1, 0, 2
const BUSY_PLAN: PlannedRun[] = [
  run(0, '08:00', 'EMAIL', 'October Newsletter Preview', 'campaign', 'c01'), run(0, '09:30', 'EMAIL', 'Welcome Series, Step 2', 'journey'),
  run(0, '11:30', 'SMS', 'Flash Sale Reminder', 'campaign', 'c04'), run(0, '14:00', 'EMAIL', 'Fall Boots Launch', 'campaign', 'c06'),
  run(0, '18:00', 'MMS', 'Weekend Lookbook Preview', 'campaign'), run(0, '20:00', 'SMS', 'Cart Recovery Nudge', 'journey'),
  run(1, '09:00', 'EMAIL', 'October Newsletter', 'campaign', 'c01'), run(1, '15:00', 'SMS', 'Birthday Reward, Step 1', 'journey'),
  run(3, '08:00', 'EMAIL', 'Win-Back 90 Days, Step 1', 'journey'), run(3, '10:00', 'SMS', 'Weekend Flash Deal', 'campaign', 'c04'),
  run(3, '14:00', 'EMAIL', 'Loyalty Points Statement', 'campaign', 'c08'), run(3, '16:00', 'EMAIL', 'Browse Abandonment, Step 1', 'journey'),
  run(4, '10:00', 'SMS', 'Price Drop Alerts', 'campaign', 'c13'),
  run(6, '09:00', 'EMAIL', 'Weekly Deals Digest', 'campaign', 'c15'), run(6, '13:00', 'SMS', 'Birthday Rewards', 'campaign', 'c12'),
]
const LIGHT_PLAN: PlannedRun[] = [
  run(1, '10:00', 'EMAIL', 'Welcome Series: New Members', 'campaign', 'l1'), run(4, '14:00', 'SMS', 'Spring Sale Reminder', 'campaign', 'l2'),
  run(6, '10:00', 'EMAIL', 'Welcome Series: New Members', 'campaign', 'l1'),
]

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ready = <T,>(data: T): SectionResult<T> => ({ status: 'ready', data })
const round1 = (value: number) => Math.round(value * 10) / 10
/** a steady 0–1 value per index, the same on every render */
const noise = (index: number) => {
  const value = Math.sin(index * 12.9898 + 4.1414) * 43_758.5453
  return value - Math.floor(value)
}

export function createSampleSource(state: SampleState, now: () => Date = () => new Date(), zone = 'America/New_York'): HomeDataSource {
  const catalogue = state === 'light' ? LIGHT : BUSY
  const attribution = state !== 'noAttribution'
  const storeRevenue = state === 'light' ? 410_000 : MOCKUP.storeRevenue

  const pick = (filters: HomeFilters) => catalogue.filter((item) =>
    (filters.channel === 'ALL' || item.channel === filters.channel) && (filters.campaignIds.length === 0 || filters.campaignIds.includes(item.id)))
  const unfiltered = (filters: HomeFilters) => state !== 'light' && filters.channel === 'ALL' && filters.campaignIds.length === 0
  const scale = (filters: HomeFilters) => PERIOD_DAYS[filters.period] / 30
  const money = (value: number) => (attribution ? value : null)

  const figuresOf = (item: SampleCampaign, factor: number): CampaignFigures => {
    const delivered = Math.round(item.delivered * factor)
    const email = item.channel === 'EMAIL'
    return {
      tracksOpens: email, delivered, emailDelivered: email ? delivered : 0, opened: Math.round((delivered * (item.openRate ?? 0)) / 100),
      clicked: Math.round((delivered * item.clickRate) / 100), conversions: Math.round(item.conversions * factor), revenue: money(Math.round(item.revenue * factor)),
    }
  }

  const kpis = (filters: HomeFilters): Kpis => {
    const factor = scale(filters)
    const campaigns = pick(filters).map((item) => figuresOf(item, factor))
    const summed = sumFigures(campaigns)
    const now = unfiltered(filters)
      ? { ...summed, opened: Math.round(MOCKUP.opened * factor), emailDelivered: Math.round(MOCKUP.emailDelivered * factor), clicked: Math.round(MOCKUP.clicked * factor) }
      : summed
    const store = storeRevenue * factor
    return buildKpis({
      now, before: previousOf(now), days: PERIOD_DAYS[filters.period],
      tracksOpens: filters.channel !== 'SMS' && filters.channel !== 'MMS' && campaigns.some((row) => row.tracksOpens),
      revenueTarget: now.revenue === null ? null : Math.round(now.revenue * MOCKUP.targetRatio),
      storeRevenue: { now: Math.round(store), before: Math.round(store / 1.05) },
    })
  }

  const topBottom = (filters: HomeFilters): TopBottom => {
    const factor = scale(filters)
    const candidates: RankCandidate[] = pick(filters).map((item, index) => {
      const revenue = Math.round(item.revenue * factor)
      const delivered = Math.round(item.delivered * factor)
      const clickRate = item.clickRate
      return {
        id: item.id, name: item.name, channel: item.channel, delivered, clicked: Math.round((delivered * clickRate) / 100),
        revenue: attribution && item.delivered > 0 ? revenue : null,
        target: item.percentOfTarget ? Math.round((revenue / item.percentOfTarget) * 100) : null,
        previousRevenue: item.change === null ? null : Math.round(revenue / (1 + item.change / 100)),
        // a steady nudge either way, so the click-rate view has changes to show
        previousClickRate: round1(clickRate - (noise(index + 7) - 0.4)),
      }
    })
    if (attribution) return rankTopBottom({ mode: 'target', candidates })
    const clickRate = kpis(filters).clickRate.value
    return rankTopBottom({ mode: 'clickRate', candidates, average: clickRate })
  }

  const revenueCost = (filters: HomeFilters): RevenueCostSeries => {
    const items = pick(filters)
    const days = PERIOD_DAYS[filters.period]
    const factor = scale(filters)
    const delivered = sum(items.map((item) => item.delivered)) * factor
    const revenue = sum(items.map((item) => item.revenue)) * factor
    const cost = Math.round(delivered * COST_PER_DELIVERED)
    const today = todayIn(zone, now())
    // a believable daily shape (revenue $25K–$71K, cost $3K–$4.5K on the busy month), scaled to the period's totals
    const revenueShape = Array.from({ length: days }, (_, index) => 25 + 46 * noise(index))
    const costShape = Array.from({ length: days }, (_, index) => 3 + 1.5 * noise(index + 101))
    const spread = (total: number, shape: number[]) => shape.map((weight) => (total * weight) / sum(shape))
    const dailyRevenue = spread(revenue, revenueShape)
    const dailyCost = spread(cost, costShape)
    const weekly = filters.period === '90d'
    const step = weekly ? 7 : 1
    const target = revenue * MOCKUP.targetRatio
    // nothing in scope: no points, so the chart says so instead of drawing zeros
    const points = items.length === 0 ? [] : Array.from({ length: Math.ceil(days / step) }, (_, index) => {
      const from = index * step
      const span = Math.min(step, days - from)
      return {
        day: addDays(today, -(days - 1) + from),
        revenue: money(Math.round(sum(dailyRevenue.slice(from, from + span)))),
        cost: Math.round(sum(dailyCost.slice(from, from + span))),
        targetPace: attribution ? Math.round((target * span) / days) : null,
      }
    })
    const byRevenue = [...items].filter((item) => item.revenue > 0).sort((a, b) => b.revenue - a.revenue)
    const others = byRevenue.slice(5)
    return {
      granularity: weekly ? 'week' : 'day',
      points,
      byCampaign: {
        top: byRevenue.slice(0, 5).map((item) => ({ id: item.id, name: item.name, revenue: Math.round(item.revenue * factor) })),
        others: others.length ? { count: others.length, revenue: Math.round(sum(others.map((item) => item.revenue)) * factor) } : null,
      },
      summary: {
        revenue: money(Math.round(revenue)),
        cost,
        roi: attribution && cost ? round1(revenue / cost) : null,
        revenuePer1000Delivered: !attribution || !delivered ? null : unfiltered(filters) ? MOCKUP.revenuePer1000 : Math.round((revenue / delivered) * 100_000) / 100,
      },
    }
  }

  const funnel = (filters: HomeFilters): FunnelChannel[] => {
    const factor = scale(filters)
    // the light workspace sends email only
    const channels = [...new Set(pick(filters).map((item) => item.channel))].filter((channel) => state !== 'light' || channel === 'EMAIL')
    return channels.map((channel) => {
      if (channel === 'EMAIL' && unfiltered(filters)) {
        return { channel, delivered: Math.round(MOCKUP.funnel.delivered * factor), opened: Math.round(MOCKUP.funnel.opened * factor), clicked: Math.round(MOCKUP.funnel.clicked * factor), converted: Math.round(MOCKUP.funnel.converted * factor) }
      }
      const items = pick(filters).filter((item) => item.channel === channel)
      return {
        channel,
        delivered: Math.round(sum(items.map((item) => item.delivered)) * factor),
        opened: channel === 'EMAIL' ? Math.round(sum(items.map((item) => (item.delivered * (item.openRate ?? 0)) / 100)) * factor) : null,
        clicked: Math.round(sum(items.map((item) => (item.delivered * item.clickRate) / 100)) * factor),
        converted: Math.round(sum(items.map((item) => item.conversions)) * factor),
      }
    }).filter((row) => row.delivered > 0)
  }

  const schedule = (filters: HomeFilters): Schedule => {
    const today = todayIn(zone, now())
    // the sample's clock stands at 10:15 today, so the morning's runs always read as sent
    const sampleNow = new Date(atZone(today, '10:15', zone))
    const plan = state === 'light' ? LIGHT_PLAN : BUSY_PLAN
    const days = Array.from({ length: 7 }, (_, offset) => {
      const day = addDays(today, offset)
      const runs: ScheduledRun[] = plan
        .filter((item) => item.day === offset && (filters.channel === 'ALL' || item.channel === filters.channel))
        .filter((item) => filters.campaignIds.length === 0 || (item.source === 'campaign' && item.campaignId !== null && filters.campaignIds.includes(item.campaignId)))
        .map((item, index) => {
          const at = atZone(day, item.time, zone)
          return { id: `${day}-${index}`, at, channel: item.channel, name: item.name, source: item.source, campaignId: item.campaignId, sent: new Date(at) < sampleNow }
        })
      return { day, campaignRuns: runs.filter((run) => run.source === 'campaign').length, journeyRuns: runs.filter((run) => run.source === 'journey').length, runs }
    })
    return { timezone: zone, days, total: sum(days.map((day) => day.runs.length)) }
  }

  const journeys = (): Journeys => {
    if (state === 'light') return { rows: [], totalJourneys: 0 }
    const today = todayIn(zone, now())
    const failingSince = atZone(today, '00:12', zone)
    const rows: JourneyRow[] = [
      { id: 'j-cart', name: 'Cart Recovery', status: 'FAILED', contextLine: `SMS step failing since ${formatClock(failingSince, zone)} ${zoneAbbreviation(zone, new Date(failingSince))}`, inFlight: 1206, entered: 9480, conversionRate: 12.9 },
      { id: 'j-birthday', name: 'Birthday Reward', status: 'PAUSED', contextLine: `Paused by Maya Patel, ${formatShortDay(addDays(today, -2))}`, inFlight: 640, entered: 1880, conversionRate: 15.2 },
      { id: 'j-welcome', name: 'Welcome Series', status: 'ACTIVE', contextLine: 'Email, SMS', inFlight: 3842, entered: 6120, conversionRate: 8.4 },
      { id: 'j-winback', name: 'Win-Back 90 Days', status: 'ACTIVE', contextLine: 'Email', inFlight: 2915, entered: 3210, conversionRate: 4.1 },
      { id: 'j-browse', name: 'Browse Abandonment', status: 'ACTIVE', contextLine: 'Email', inFlight: 2410, entered: 7340, conversionRate: 6.6 },
      ...QUIET_JOURNEYS.map((name, index) => ({ id: `j-${index}`, name, status: 'ACTIVE' as const, contextLine: index % 2 ? 'Email, SMS' : 'Email', inFlight: 1800 - index * 170, entered: 2600 + index * 310, conversionRate: round1(3 + index * 0.7) })),
    ]
    return { rows, totalJourneys: rows.length }
  }

  const recent = (filters: HomeFilters, status: RecentStatus = 'ALL'): RecentCampaigns => {
    const factor = scale(filters)
    const today = todayIn(zone, now())
    const items = pick(filters).filter((item) => RECENT_STATUSES[status].includes(item.status))
    return {
      rows: items.map((item) => {
        const sent = !UNSENT.has(item.status) && item.delivered > 0
        const lastActivity = atZone(addDays(today, -item.daysAgo), '09:00', zone)
        const typeLabel = item.contextLine.startsWith('Drip') ? 'Drip' : 'Regular'
        return {
          id: item.id,
          name: item.name,
          contextLine: contextLine({
            typeLabel, status: item.status, editedAt: lastActivity, lastSentAt: sent ? lastActivity : null, sendingNow: item.status === 'SENDING',
            nextRunAt: item.status === 'SCHEDULED' ? atZone(addDays(today, 2), '08:00', zone) : null, testSentAt: item.status === 'TEST_PUBLISHED' ? lastActivity : null,
          }, zone),
          channel: item.channel,
          status: item.status,
          delivered: sent ? Math.round(item.delivered * factor) : null,
          openRate: sent ? item.openRate ?? 'not_tracked' : null,
          clickRate: sent ? item.clickRate : null,
          revenue: sent ? money(Math.round(item.revenue * factor)) : null,
          target: attribution && item.percentOfTarget !== null ? Math.round(((item.revenue * factor) / item.percentOfTarget) * 100) : null,
          lastActivity,
          attention: item.id === FAILED_SAMPLE ? 0 : item.status === 'TEST_PUBLISHED' ? 2 : item.status === 'PAUSED' ? 3 : 4,
        }
      }),
      total: items.length,
      attributionSetUp: attribution,
    }
  }

  const governance = (filters: HomeFilters): Governance => {
    const share = sum(pick(filters).map((item) => item.delivered)) / sum(catalogue.map((item) => item.delivered))
    const factor = (state === 'light' ? 0.004 : 1) * share * scale(filters)
    const round = (value: number) => Math.round(value * factor)
    const reasons = { frequencyCap: round(21_300), noConsent: round(9_840), suppression: round(7_800) }
    return { contacted: round(412_380), heldBack: sum(Object.values(reasons)), reasons }
  }

  const eReceipts = (filters: HomeFilters): EReceipts | null => {
    if (state === 'light') return null
    const factor = scale(filters)
    return { sent: Math.round(214_600 * factor), openRate: 61.2, offerClicks: Math.round(8_940 * factor), offerRevenue: money(Math.round(48_200 * factor)) }
  }

  const attention = (filters: HomeFilters): AttentionGroup[] => {
    if (state === 'noAlerts') return []
    if (state === 'light') return ALERTS.slice(5).map((group) => ({ ...group, count: 1 }))
    if (filters.campaignIds.length !== 1) return ALERTS
    // one campaign: only the groups a single campaign can be in, counting it once
    const one = catalogue.find((item) => item.id === filters.campaignIds[0])
    if (one?.status === 'TEST_PUBLISHED') return [{ ...ALERTS[2], count: 1 }]
    if (one?.id === 'c11') return [{ ...ALERTS[0], count: 1 }]
    return []
  }

  const liveToday = state === 'liveToday'

  return {
    capabilities: { journeyCreateFlow: true },
    useCampaignOptions: () => ready({ options: catalogue.map(({ id, name, channel }): CampaignOption => ({ id, name, channel })), more: false }),
    useAttention: (filters) => ready({ groups: attention(filters), freshness: 'Updated today at 6:00 AM' }),
    useKpis: (filters) => ready(kpis(filters)),
    useTopBottom: (filters) => ready(topBottom(filters)),
    useRevenueCost: (filters) => (liveToday ? { status: 'unavailable' } : ready(revenueCost(filters))),
    useFunnel: (filters) => ready(funnel(filters)),
    useSchedule: (filters) => ready(schedule(filters)),
    useJourneys: () => (liveToday ? { status: 'unavailable' } : ready(journeys())),
    useRecentCampaigns: (filters, status) => ready(recent(filters, status)),
    useGovernance: (filters) => (liveToday ? { status: 'unavailable' } : ready(governance(filters))),
    useEReceipts: (filters) => ready(eReceipts(filters)),
  }
}
