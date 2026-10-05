import { CircleCheck, MailOpen, MousePointerClick, Send } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState } from '@/components/States'
import { formatCompactMoney, formatNumber, formatPercent, formatPercentChange, formatShortDay } from '@/lib/format'

import { benchmarkFor } from '../benchmarks'
import { ChangeChip } from '../components/ChangeChip'
import { HeroCard } from '../components/HeroCard'
import { PlumChip, RingKpi } from '../components/RingKpi'
import { Sparkline } from '../components/Sparkline'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, Kpis, RevenueCostSeries, SectionResult } from '../data/types'
import { PERIOD_OPTIONS } from '../filterLabels'

/** counts and money change in %, rates and shares in points; no earlier figure, no change */
const percentChange = (value: number | null, previous: number | null) => (value === null || previous === null || previous === 0 ? null : ((value - previous) / previous) * 100)
const pointChange = (value: number | null, previous: number | null) => (value === null || previous === null ? null : value - previous)

/** ROI reads as a multiple of cost: 5× and above is a high return, 2× fair, below that low */
function roiBenchmark(roi: number): string {
  return roi >= 5 ? 'High Return' : roi >= 2 ? 'Fair Return' : 'Low Return'
}

/** click-to-conversion, read as a benchmark: a third of clicks or more is strong */
function conversionNote(percentOfClicks: number): 'Good' | 'Fair' | 'Poor' {
  return percentOfClicks >= 33 ? 'Good' : percentOfClicks >= 10 ? 'Fair' : 'Poor'
}

/** the running return, day by day: revenue so far over cost so far */
function runningReturn(series: RevenueCostSeries): number[] {
  let revenue = 0
  let cost = 0
  return series.points.map((point) => {
    revenue += point.revenue ?? 0
    cost += point.cost
    return cost > 0 ? revenue / cost : 0
  })
}

/** the admin's way to attribution, or a sentence for everyone else (Settings is admin-only) */
function SetUp({ canSetUp }: { canSetUp: boolean }) {
  return canSetUp
    ? <Link to="/settings/attribution" className="self-start text-sm font-semibold text-white underline underline-offset-2 hover:no-underline">Set Up Attribution</Link>
    : <p className="text-helper text-plum-100">Ask an admin to set up attribution.</p>
}

function Heroes({ kpis, revenueCost, period, canSetUp }: { kpis: Kpis; revenueCost: SectionResult<RevenueCostSeries>; period: string; canSetUp: boolean }) {
  const revenue = kpis.attributedRevenue.value
  const target = kpis.revenueTarget
  const series = revenueCost.status === 'ready' ? revenueCost.data : null
  const summary = series?.summary ?? null
  const roi = summary?.roi ?? null
  const points = series?.points ?? []
  const revenues = points.map((point) => point.revenue ?? 0)
  const peak = revenues.length ? revenues.indexOf(Math.max(...revenues)) : -1
  const pace = points.filter((point) => point.targetPace !== null)
  const change = percentChange(revenue, kpis.attributedRevenue.previous)

  const revenueHero = !kpis.attributionSetUp || revenue === null
    ? <HeroCard tone="navy" label="Attributed Revenue" chip={period} value="Not Set Up Yet" quiet><SetUp canSetUp={canSetUp} /></HeroCard>
    : (
      <HeroCard tone="navy" label="Attributed Revenue" chip={period} value={formatCompactMoney(revenue)}
        sub={summary && summary.cost > 0 ? `from ${formatCompactMoney(summary.cost)} spent` : undefined}
        spark={points.length > 1 ? <Sparkline values={revenues} mark="peak" level={pace.length ? pace.reduce((total, point) => total + point.targetPace!, 0) / pace.length : null} /> : undefined}
        axis={points.length > 1 && revenues[peak] > 0 ? [formatShortDay(points[0].day), `Peak ${formatShortDay(points[peak].day)} · ${formatCompactMoney(revenues[peak])}`] : undefined}
        footLeft={change === null ? 'Attributed to campaigns' : `${formatPercentChange(change)} on the previous period`}
        footRight={target ? `${formatPercent((revenue / target) * 100, 0)} of ${formatCompactMoney(target)} goal` : undefined}
        footWarning={Boolean(target && revenue < target)} />
    )

  const roiHero = !kpis.attributionSetUp
    ? <HeroCard tone="plum" label="Campaign ROI" value="Not Set Up Yet" quiet><SetUp canSetUp={canSetUp} /></HeroCard>
    : revenueCost.status === 'loading'
      ? <HeroCard tone="plum" label="Campaign ROI" loading />
      : roi === null || summary === null
        ? <HeroCard tone="plum" label="Campaign ROI" value="—" sub={summary && summary.cost > 0 ? `${formatCompactMoney(summary.cost)} campaign cost` : 'No campaign cost in this period.'} />
        : (
          <HeroCard tone="plum" label="Campaign ROI" chip={roiBenchmark(roi)} value={`${roi.toFixed(1)}×`} sub={`from ${formatCompactMoney(summary.cost)} campaign cost`}
            spark={points.length > 1 ? <Sparkline values={runningReturn(series!)} mark="last" /> : undefined}
            axis={points.length > 1 ? [formatShortDay(points[0].day), `Now · ${roi.toFixed(1)}×`] : undefined}
            footLeft="Revenue per $1 spent"
            footRight={summary.revenuePer1000Delivered === null ? undefined : `${formatCompactMoney(summary.revenuePer1000Delivered)} per 1,000 delivered`} />
        )
  return <>{revenueHero}{roiHero}</>
}

function Rings({ kpis, filters }: { kpis: Kpis; filters: HomeFilters }) {
  const { delivered, openRate, clickRate, conversions } = kpis
  const note = filters.channel === 'ALL' ? 'Email Only' : undefined
  const chips = (change: ReactNode, plum?: string) => <>{change}{plum && <PlumChip>{plum}</PlumChip>}</>
  return (
    <>
      <RingKpi label="Delivered" icon={Send} value={formatNumber(delivered.value)} percent={delivered.value > 0 ? 100 : 0}
        supporting={`${formatNumber(kpis.perDayDelivered)} sends per day`}
        chips={chips(<ChangeChip value={percentChange(delivered.value, delivered.previous)} unit="%" />)} />
      {openRate.value === 'not_tracked'
        ? <RingKpi label="Open Rate" icon={MailOpen} note={note} value="Not Tracked" quiet supporting={`${filters.channel === 'MMS' ? 'MMS' : 'SMS'} does not report opens`} />
        : openRate.value === null
          ? <RingKpi label="Open Rate" icon={MailOpen} note={note} value="—" />
          : <RingKpi label="Open Rate" icon={MailOpen} note={note} value={formatPercent(openRate.value)} percent={openRate.value}
            supporting={`${formatNumber(openRate.opened)} opened`}
            chips={chips(<ChangeChip value={pointChange(openRate.value, openRate.previous as number | null)} unit="pt" />, benchmarkFor('open', openRate.value))} />}
      {clickRate.value === null
        ? <RingKpi label="Click Rate" icon={MousePointerClick} value="—" />
        : <RingKpi label="Click Rate" icon={MousePointerClick} value={formatPercent(clickRate.value)} percent={clickRate.value}
          supporting={`${formatNumber(clickRate.clicked)} clicks`}
          chips={chips(<ChangeChip value={pointChange(clickRate.value, clickRate.previous)} unit="pt" />, benchmarkFor('click', clickRate.value))} />}
      {conversions.percentOfClicks === null
        ? <RingKpi label="Conversions" icon={CircleCheck} value={formatNumber(conversions.value)}
          chips={chips(<ChangeChip value={percentChange(conversions.value, conversions.previous)} unit="%" />)} />
        : <RingKpi label="Conversions" icon={CircleCheck} value={formatNumber(conversions.value)} percent={conversions.percentOfClicks}
          supporting={`${conversionNote(conversions.percentOfClicks) === 'Good' ? 'Strong' : conversionNote(conversions.percentOfClicks) === 'Fair' ? 'Steady' : 'Weak'} click-to-conversion`}
          chips={chips(undefined, `${conversionNote(conversions.percentOfClicks)} · ${formatPercent(conversions.percentOfClicks)} of clicks`)} />}
    </>
  )
}

const RING_LABELS: [string, typeof Send][] = [['Delivered', Send], ['Open Rate', MailOpen], ['Click Rate', MousePointerClick], ['Conversions', CircleCheck]]

/**
 * The two heroes (Attributed Revenue, Campaign ROI) then the four ring KPIs: side by side in three columns on a wide
 * page, the rings in a row of four under the heroes below that, stacked on a narrow one.
 */
function Layout({ children, rings }: { children: ReactNode; rings: ReactNode }) {
  return (
    <div role="group" aria-label="Key Figures" className="grid grid-cols-1 gap-4 @min-[840px]:grid-cols-2 @min-[1200px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(0,1.4fr)]">
      {children}
      <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2 @min-[840px]:col-span-2 @min-[1040px]:grid-cols-4 @min-[1200px]:col-span-1 @min-[1200px]:grid-cols-2">{rings}</div>
    </div>
  )
}

interface KeyFiguresProps {
  filters: HomeFilters
  /** the Marketing Performance card's revenue series: the heroes read its trend and summary */
  revenueCost: SectionResult<RevenueCostSeries>
}

/** The period's figures under the set-up card. Without report.view the section is one line. */
export function KeyFigures({ filters, revenueCost }: KeyFiguresProps) {
  const { source, viewer } = useHomeData()
  const allowed = viewer.can('report.view')
  const result = source.useKpis(filters, { enabled: allowed })
  const titleId = useId()
  const period = PERIOD_OPTIONS.find((option) => option.value === filters.period)!.label
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <h2 id={titleId} className="sr-only">Key Figures</h2>
      {!allowed ? (
        <p data-kpi-access className="rounded-lg border border-line bg-surface px-4 py-3 text-helper text-ink-800">You don’t have access to performance reports.</p>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="Performance figures could not be loaded" />
      ) : result.status === 'ready' ? (
        <Layout rings={<Rings kpis={result.data} filters={filters} />}>
          <Heroes kpis={result.data} revenueCost={revenueCost} period={period} canSetUp={viewer.can('user.admin')} />
        </Layout>
      ) : result.status === 'unavailable' ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-helper text-ink-800">Performance figures aren’t available yet.</p>
      ) : (
        <Layout rings={RING_LABELS.map(([label, icon]) => <RingKpi key={label} label={label} icon={icon} note={label === 'Open Rate' && filters.channel === 'ALL' ? 'Email Only' : undefined} loading />)}>
          <HeroCard tone="navy" label="Attributed Revenue" loading />
          <HeroCard tone="plum" label="Campaign ROI" loading />
        </Layout>
      )}
    </section>
  )
}
