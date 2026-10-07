import { expect, test } from 'vitest'

import { benchmarkFor } from './benchmarks'
import { liveSource } from './data/liveSource'
import { createSampleSource } from './data/sampleSource'
import { DEFAULT_FILTERS, type HomeDataSource, type HomeFilters } from './data/types'
import { campaignChipLabel } from './filterLabels'
import { homePeriod } from './period'
import { sortRecent } from './sortRecent'

test('the period ends today in the workspace zone; the previous one is the same length, just before it', () => {
  const now = new Date('2026-09-30T02:00:00Z') // still 29 Sep in New York
  expect(homePeriod('7d', 'America/New_York', now)).toEqual({ from: '2026-09-23', to: '2026-09-29', previousFrom: '2026-09-16', previousTo: '2026-09-22' })
  expect(homePeriod('30d', 'UTC', now)).toEqual({ from: '2026-09-01', to: '2026-09-30', previousFrom: '2026-08-02', previousTo: '2026-08-31' })
  expect(homePeriod('90d', 'UTC', now)).toMatchObject({ from: '2026-07-03', previousTo: '2026-07-02', previousFrom: '2026-04-04' })
})

test('benchmarks: open Poor under 20, Fair to 30, Good from 30; click Poor under 2, Fair to 4.5, Good from 4.5', () => {
  expect([19.9, 20, 29.9, 30].map((value) => benchmarkFor('open', value))).toEqual(['Poor', 'Fair', 'Fair', 'Good'])
  expect([1.9, 2, 4.4, 4.5].map((value) => benchmarkFor('click', value))).toEqual(['Poor', 'Fair', 'Fair', 'Good'])
})

test('the campaign chip reads All Campaigns, one name, or a count', () => {
  const options = [{ id: 'a', name: 'Fall Launch', channel: 'EMAIL' as const }, { id: 'b', name: 'Flash Sale', channel: 'SMS' as const }]
  expect(campaignChipLabel([], options)).toBe('All Campaigns')
  expect(campaignChipLabel(['b'], options)).toBe('Flash Sale')
  expect(campaignChipLabel(['a', 'b'], options)).toBe('2 Campaigns')
})

const ready = <T,>(result: { status: string; data?: T }) => {
  expect(result.status).toBe('ready')
  return result.data as T
}
const filters = (next: Partial<HomeFilters> = {}): HomeFilters => ({ ...DEFAULT_FILTERS, ...next })

test('sample busy account: the mockup’s figures with no filters', () => {
  const source = createSampleSource('busy', () => new Date('2026-09-30T14:00:00Z'))
  const kpis = ready(source.useKpis(filters()))
  expect(kpis.delivered.value).toBe(1_584_560)
  expect(kpis.openRate.value).toBe(37.5)
  expect(kpis.clickRate.value).toBe(3.9)
  expect(kpis.conversions.value).toBe(15_890)
  expect(kpis.attributedRevenue.value).toBe(1_390_000)
  expect(kpis.revenueTarget).toBe(1_470_000)
  expect(kpis.storeRevenue).toBe(9_600_000)
  expect(kpis.openRate.opened).toBe(427_821)
  expect(kpis.clickRate.clicked).toBe(61_405)
  expect(kpis.conversions.percentOfClicks).toBe(25.9)                                   // "25.9% of clicks"
  const alerts = ready(source.useAttention(filters())).groups
  expect(alerts.map((group) => [group.severity, group.count, group.label, group.actionLabel])).toEqual([
    ['critical', 3, 'Campaigns with delivery failures', 'Review Failures'],
    ['critical', 2, 'Campaigns with bounce rate above 5%', 'Check Lists'],
    ['critical', 2, 'Message 3 of Back to School Bundles failed. No one received it.', 'Review'],                 // the drip problems, one group
    ['blocking', 4, 'Campaigns awaiting production publish', 'Publish'],
    ['blocking', 1, 'Journey step missing an approved template', 'Fix Journey'],
    ['governance', 21_300, 'Customers held back by frequency caps', 'Review Caps'],
    ['governance', 2, 'Contact lists missing consent source', 'Review Lists'],
  ])
  const topBottom = ready(source.useTopBottom(filters()))
  expect([topBottom.top.length, topBottom.middle.count, topBottom.bottom.length]).toEqual([3, 5, 3])
  expect(ready(source.useJourneys(filters())).totalJourneys).toBe(14)
  expect(ready(source.useRecentCampaigns(filters())).total).toBe(15)
  expect(sumRuns(source)).toBe(17)                                                        // the mockup's 15, and two drip messages
  expect(ready(source.useGovernance(filters()))).toMatchObject({ contacted: 412_380, heldBack: 38_940 })
  expect(ready(source.useEReceipts(filters()))?.sent).toBe(214_600)
})

const sumRuns = (source: HomeDataSource) => ready(source.useSchedule(filters())).total

test('sample data answers the filters: SMS has no opens, one campaign shows its own figures, the period scales', () => {
  const source = createSampleSource('busy')
  expect(ready(source.useKpis(filters({ channel: 'SMS' }))).openRate.value).toBe('not_tracked')
  const one = ready(source.useKpis(filters({ campaignIds: ['c06'] })))
  expect(one.delivered.value).toBe(286_400)
  expect(one.openRate.value).toBe(36.8)
  expect(ready(source.useRecentCampaigns(filters({ campaignIds: ['c06'] }))).total).toBe(1)
  expect(ready(source.useKpis(filters({ period: '7d' }))).delivered.value).toBeLessThan(1_584_560 / 4)
  expect(ready(source.useRevenueCost(filters({ period: '7d' }))).points).toHaveLength(7)
  expect(ready(source.useRevenueCost(filters({ period: '90d' })))).toMatchObject({ granularity: 'week' })
  expect(ready(source.useFunnel(filters({ channel: 'SMS' })))).toEqual([expect.objectContaining({ channel: 'SMS', opened: null })])
})

test('sample states: no alerts, a light account, and no attribution (revenue null, never $0)', () => {
  expect(ready(createSampleSource('noAlerts').useAttention(filters())).groups).toEqual([])
  const light = createSampleSource('light')
  expect(ready(light.useCampaignOptions()).options).toHaveLength(2)
  expect(ready(light.useJourneys(filters()))).toEqual({ rows: [], totalJourneys: 0 })
  expect(ready(light.useEReceipts(filters()))).toBeNull()
  const none = createSampleSource('noAttribution')
  const kpis = ready(none.useKpis(filters()))
  expect(kpis.attributionSetUp).toBe(false)
  expect(kpis.attributedRevenue.value).toBeNull()
  expect(kpis.contribution.value).toBeNull()
  expect(ready(none.useRevenueCost(filters())).summary.revenue).toBeNull()
  expect(ready(none.useEReceipts(filters()))?.offerRevenue).toBeNull()
})

test('the live source wires every section; a journey cannot be created from the app yet', () => {
  expect(Object.keys(liveSource).sort()).toEqual(['capabilities', 'useAttention', 'useCampaignOptions', 'useEReceipts', 'useFunnel', 'useGovernance', 'useJourneys', 'useKpis', 'useRecentCampaigns',
                                                  'useRevenueCost', 'useSchedule', 'useSetup', 'useTopBottom'])
  expect(liveSource.capabilities.journeyCreateFlow).toBe(true)
})

test('sample campaigns use the locked status vocabulary, and the six most recent match the mockup', () => {
  for (const state of ['busy', 'light'] as const) {
    const source = createSampleSource(state)
    const statuses = ready(source.useCampaignOptions()).options.map((option) => ready(source.useRecentCampaigns(filters({ campaignIds: [option.id] }))).rows[0].status)
    expect(statuses.every((status) => ['DRAFT', 'TEST_PUBLISHED', 'PRODUCTION_PUBLISHED', 'SCHEDULED', 'SENDING'].includes(status))).toBe(true)
  }
  const recent = sortRecent(ready(createSampleSource('busy').useRecentCampaigns(filters())).rows, 'recent', true).slice(0, 6)
  expect(recent.map((row) => [row.name, row.channel, row.status])).toEqual([
    ['October Newsletter', 'EMAIL', 'SCHEDULED'], ['Holiday Preview', 'EMAIL', 'DRAFT'], ['Gift Guide 2026', 'EMAIL', 'TEST_PUBLISHED'],
    ['Weekend Flash Deal', 'SMS', 'PRODUCTION_PUBLISHED'], ['Black Friday Early Access', 'SMS', 'DRAFT'], ['Fall Boots Launch', 'EMAIL', 'PRODUCTION_PUBLISHED'],
  ])
  expect(recent[3]).toMatchObject({ delivered: 96_200, revenue: 24_900, openRate: 'not_tracked' })
  expect(recent[5]).toMatchObject({ delivered: 286_400, openRate: 36.8, revenue: 312_800 })
  expect(Math.round((recent[5].revenue! / recent[5].target!) * 100)).toBe(112)
  expect(Math.round((recent[3].revenue! / recent[3].target!) * 100)).toBe(45)
  expect(recent[1]).toMatchObject({ delivered: null, revenue: null })                  // a draft has sent nothing
})
