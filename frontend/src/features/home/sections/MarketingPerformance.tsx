import { ChartNoAxesColumn } from 'lucide-react'
import { useId } from 'react'

import { ErrorState } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatCompactMoney, formatNumber, formatPercent } from '@/lib/format'

import { benchmarkFor } from '../benchmarks'
import { HomeFilterBar } from '../components/HomeFilterBar'
import { KpiStrip, KpiTile } from '../components/KpiTile'
import { SectionHeader } from '../components/SectionHeader'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, Kpis } from '../data/types'

const LABELS: [string, string?][] = [['Delivered'], ['Open Rate', 'Email Only'], ['Click Rate'], ['Conversions'], ['Attributed Revenue'], ['Campaign Contribution']]

/** counts and money change in %, rates and shares in points; no earlier figure, no change */
const percentChange = (value: number | null, previous: number | null) => (value === null || previous === null || previous === 0 ? null : ((value - previous) / previous) * 100)
const pointChange = (value: number | null, previous: number | null) => (value === null || previous === null ? null : value - previous)

function Tiles({ kpis, filters, canSetUp }: { kpis: Kpis; filters: HomeFilters; canSetUp: boolean }) {
  const { delivered, openRate, clickRate, conversions, attributedRevenue, contribution } = kpis
  const note = filters.channel === 'ALL' ? 'Email Only' : undefined
  const revenue = attributedRevenue.value
  const target = kpis.revenueTarget
  return (
    <KpiStrip label="Marketing Performance">
      <KpiTile label="Delivered" value={formatNumber(delivered.value)} change={{ value: percentChange(delivered.value, delivered.previous), unit: '%' }}
        supporting={`${formatNumber(kpis.perDayDelivered)} per day`} />
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
      <KpiTile label="Conversions" value={formatNumber(conversions.value)} change={{ value: percentChange(conversions.value, conversions.previous), unit: '%' }}
        supporting={conversions.percentOfClicks === null ? undefined : `${formatPercent(conversions.percentOfClicks)} of clicks`} />
      {!kpis.attributionSetUp || revenue === null
        ? <KpiTile label="Attributed Revenue" state="notSetUp" canSetUp={canSetUp} />
        : <KpiTile label="Attributed Revenue" value={formatCompactMoney(revenue)} change={{ value: percentChange(revenue, attributedRevenue.previous), unit: '%' }}
          supporting={target ? `${formatPercent((revenue / target) * 100, 0)} of ${formatCompactMoney(target)} target` : 'Attributed to campaigns'}
          progress={target ? { value: (revenue / target) * 100, label: 'Attributed revenue against target' } : undefined} />}
      {!kpis.attributionSetUp
        ? <KpiTile label="Campaign Contribution" state="notSetUp" canSetUp={canSetUp} />
        : kpis.storeRevenue === null || contribution.value === null
          ? <KpiTile label="Campaign Contribution" state="unavailable" supporting="Store revenue isn’t connected yet." />
          : <KpiTile label="Campaign Contribution" value={formatPercent(contribution.value)} change={{ value: pointChange(contribution.value, contribution.previous), unit: 'pt' }}
            supporting={`of ${formatCompactMoney(kpis.storeRevenue)} store revenue`} />}
    </KpiStrip>
  )
}

interface MarketingPerformanceProps {
  filters: HomeFilters
  onChange: (next: Partial<HomeFilters>) => void
  onClear: () => void
  /** the single-campaign view's campaign */
  singleCampaign?: string
}

/** The page-wide filters and the six KPIs. Without report.view the strip is one line; the filters stay. */
export function MarketingPerformance({ filters, onChange, onClear, singleCampaign }: MarketingPerformanceProps) {
  const { source, viewer } = useHomeData()
  const allowed = viewer.can('report.view')
  const result = source.useKpis(filters, { enabled: allowed })
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <SectionHeader level="page" title="Marketing Performance" titleId={titleId} icon={ChartNoAxesColumn} actions={<HomeFilterBar filters={filters} onChange={onChange} onClear={onClear} />} />
      {singleCampaign !== undefined && (
        <div data-single-campaign className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex min-w-0 text-helper text-ink-800">
            <span className="shrink-0">Single-Campaign View:&nbsp;</span>
            <TruncatedText text={singleCampaign} focusable className="min-w-0 font-semibold text-ink-900" />
          </p>
          <button type="button" className={`${buttonClass({ variant: 'link', size: 'sm' })} -ml-3`} onClick={() => onChange({ campaignIds: [] })}>Show All Campaigns</button>
        </div>
      )}
      {!allowed ? (
        <p data-kpi-access className="rounded-lg border border-line px-4 py-3 text-helper text-ink-800">You don’t have access to performance reports.</p>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="Performance figures could not be loaded" />
      ) : result.status === 'ready' ? (
        <Tiles kpis={result.data} filters={filters} canSetUp={viewer.can('user.admin')} />
      ) : result.status === 'unavailable' ? (
        <p className="rounded-lg border border-line px-4 py-3 text-helper text-ink-800">Performance figures aren’t available yet.</p>
      ) : (
        <KpiStrip label="Marketing Performance">
          {LABELS.map(([label, note]) => <KpiTile key={label} label={label} note={label === 'Open Rate' && filters.channel !== 'ALL' ? undefined : note} state="loading" />)}
        </KpiStrip>
      )}
    </section>
  )
}
