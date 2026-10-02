import { useId } from 'react'

import { ErrorState } from '@/components/States'
import { formatCompactMoney, formatNumber, formatPercent } from '@/lib/format'

import { benchmarkFor } from '../benchmarks'
import { KpiStrip, KpiTile } from '../components/KpiTile'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, Kpis, RevenueCostSeries, SectionResult } from '../data/types'

const LABELS: [string, string?][] = [['Delivered'], ['Open Rate', 'Email Only'], ['Click Rate'], ['Conversions'], ['Attributed Revenue'], ['Campaign ROI']]

/** counts and money change in %, rates and shares in points; no earlier figure, no change */
const percentChange = (value: number | null, previous: number | null) => (value === null || previous === null || previous === 0 ? null : ((value - previous) / previous) * 100)
const pointChange = (value: number | null, previous: number | null) => (value === null || previous === null ? null : value - previous)

/** ROI reads as a multiple of cost: 5× and above is a high return, 2× fair, below that low */
function roiBenchmark(roi: number): { benchmark: 'Good' | 'Fair' | 'Poor'; text: string } {
  if (roi >= 5) return { benchmark: 'Good', text: 'High return' }
  if (roi >= 2) return { benchmark: 'Fair', text: 'Fair return' }
  return { benchmark: 'Poor', text: 'Low return' }
}

/** click-to-conversion, read as a benchmark: a third of clicks or more is strong */
function conversionNote(percentOfClicks: number): 'Good' | 'Fair' | 'Poor' {
  return percentOfClicks >= 33 ? 'Good' : percentOfClicks >= 10 ? 'Fair' : 'Poor'
}

function Tiles({ kpis, revenueCost, filters, canSetUp }: { kpis: Kpis; revenueCost: SectionResult<RevenueCostSeries>; filters: HomeFilters; canSetUp: boolean }) {
  const { delivered, openRate, clickRate, conversions, attributedRevenue } = kpis
  const note = filters.channel === 'ALL' ? 'Email Only' : undefined
  const revenue = attributedRevenue.value
  const target = kpis.revenueTarget
  const summary = revenueCost.status === 'ready' ? revenueCost.data.summary : null
  const roi = summary?.roi ?? null
  return (
    <KpiStrip label="Key Figures">
      <KpiTile label="Delivered" value={formatNumber(delivered.value)} change={{ value: percentChange(delivered.value, delivered.previous), unit: '%' }}
        supporting={`${formatNumber(kpis.perDayDelivered)} sends per day`} />
      {openRate.value === 'not_tracked'
        ? <KpiTile label="Open Rate" note={note} state="notTracked" notTrackedText={`${filters.channel === 'MMS' ? 'MMS' : 'SMS'} does not report opens`} />
        : openRate.value === null
          ? <KpiTile label="Open Rate" note={note} value="—" />
          : <KpiTile label="Open Rate" note={note} value={formatPercent(openRate.value)} change={{ value: pointChange(openRate.value, openRate.previous as number | null), unit: 'pt' }}
            benchmark={benchmarkFor('open', openRate.value)} supporting={`${formatNumber(openRate.opened)} opened`} />}
      {clickRate.value === null
        ? <KpiTile label="Click Rate" value="—" />
        : <KpiTile label="Click Rate" value={formatPercent(clickRate.value)} change={{ value: pointChange(clickRate.value, clickRate.previous), unit: 'pt' }}
          benchmark={benchmarkFor('click', clickRate.value)} supporting={`${formatNumber(clickRate.clicked)} clicks`} />}
      {conversions.percentOfClicks === null
        ? <KpiTile label="Conversions" value={formatNumber(conversions.value)} change={{ value: percentChange(conversions.value, conversions.previous), unit: '%' }} />
        : <KpiTile label="Conversions" value={formatNumber(conversions.value)} benchmark={conversionNote(conversions.percentOfClicks)} benchmarkText={`${formatPercent(conversions.percentOfClicks)} of clicks`}
          supporting={conversionNote(conversions.percentOfClicks) === 'Good' ? 'Strong click-to-conversion' : conversionNote(conversions.percentOfClicks) === 'Fair' ? 'Steady click-to-conversion' : 'Weak click-to-conversion'} />}
      {!kpis.attributionSetUp || revenue === null
        ? <KpiTile label="Attributed Revenue" state="notSetUp" canSetUp={canSetUp} />
        : <KpiTile label="Attributed Revenue" value={formatCompactMoney(revenue)} change={{ value: percentChange(revenue, attributedRevenue.previous), unit: '%' }}
          supporting={target ? `${formatPercent((revenue / target) * 100, 0)} of ${formatCompactMoney(target)} target` : 'Attributed to campaigns'}
          progress={target ? { value: (revenue / target) * 100, label: 'Attributed revenue against target' } : undefined} />}
      {!kpis.attributionSetUp
        ? <KpiTile label="Campaign ROI" state="notSetUp" canSetUp={canSetUp} />
        : revenueCost.status === 'loading'
          ? <KpiTile label="Campaign ROI" state="loading" />
          : roi === null || summary === null
            ? <KpiTile label="Campaign ROI" state="unavailable" supporting={summary && summary.cost > 0 ? `${formatCompactMoney(summary.cost)} campaign cost` : 'No campaign cost in this period.'} />
            : <KpiTile label="Campaign ROI" value={`${roi.toFixed(1)}×`} benchmark={roiBenchmark(roi).benchmark} benchmarkText={roiBenchmark(roi).text}
              supporting={`${formatCompactMoney(summary.cost)} campaign cost`} />}
    </KpiStrip>
  )
}

interface KeyFiguresProps {
  filters: HomeFilters
  /** the Marketing Performance card's revenue series: the ROI tile reads its summary */
  revenueCost: SectionResult<RevenueCostSeries>
}

/** The six KPI cards under the alerts. Without report.view the strip is one line. */
export function KeyFigures({ filters, revenueCost }: KeyFiguresProps) {
  const { source, viewer } = useHomeData()
  const allowed = viewer.can('report.view')
  const result = source.useKpis(filters, { enabled: allowed })
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <h2 id={titleId} className="sr-only">Key Figures</h2>
      {!allowed ? (
        <p data-kpi-access className="rounded-lg border border-line px-4 py-3 text-helper text-ink-800">You don’t have access to performance reports.</p>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="Performance figures could not be loaded" />
      ) : result.status === 'ready' ? (
        <Tiles kpis={result.data} revenueCost={revenueCost} filters={filters} canSetUp={viewer.can('user.admin')} />
      ) : result.status === 'unavailable' ? (
        <p className="rounded-lg border border-line px-4 py-3 text-helper text-ink-800">Performance figures aren’t available yet.</p>
      ) : (
        <KpiStrip label="Key Figures">
          {LABELS.map(([label, note]) => <KpiTile key={label} label={label} note={label === 'Open Rate' && filters.channel !== 'ALL' ? undefined : note} state="loading" />)}
        </KpiStrip>
      )}
    </section>
  )
}
