import { CircleDollarSign } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { SegmentedControl } from '@/components/SegmentedControl'
import { BarList } from '@/components/charts/BarList'
import { Chart, ChartLegend, type ChartReference, type ChartSeries } from '@/components/charts/Chart'
import { useChartLegend } from '@/components/charts/legend'
import { buttonClass } from '@/components/buttonStyles'
import { formatAxisMoney, formatCompactMoney, formatMoney, formatPercent, formatShortDay } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, RevenueCostSeries } from '../data/types'

type View = 'total' | 'campaign'
const VIEWS: { value: View; label: string }[] = [{ value: 'total', label: 'Total' }, { value: 'campaign', label: 'By Campaign' }]
const HEIGHT = 300

/** revenue as bars, cost as the second series (Plum by the kit's pair rule), target pace as the dashed reference */
function chartParts(data: RevenueCostSeries | null): { series: ChartSeries[]; reference?: ChartReference } {
  const points = data?.points ?? []
  return {
    series: [
      { key: 'revenue', label: 'Revenue', mark: 'bar', values: points.map((point) => point.revenue ?? 0) },
      { key: 'cost', label: 'Cost', mark: 'line', values: points.map((point) => point.cost) },
    ],
    reference: points.some((point) => point.targetPace !== null) ? { key: 'target', label: 'Target Pace', values: points.map((point) => point.targetPace ?? 0) } : undefined,
  }
}

function Summary({ summary }: { summary: RevenueCostSeries['summary'] }) {
  const cells: [string, string][] = [
    ['Revenue', formatCompactMoney(summary.revenue)],
    ['Campaign Cost', formatCompactMoney(summary.cost)],
    ['ROI', summary.roi === null ? '—' : `${summary.roi.toFixed(1)}×`],
    ['Revenue per 1,000 Delivered', summary.revenuePer1000Delivered === null ? '—' : formatMoney(summary.revenuePer1000Delivered)],
  ]
  return (
    <dl data-revenue-summary className="grid grid-cols-2 border-t border-line-subtle min-[640px]:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1 p-4">
          <dt className="text-helper text-ink-800">{label}</dt>
          <dd className="font-display text-xl leading-tight font-semibold text-ink-900 cep-num">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function NotSetUp({ cost, canSetUp }: { cost: number; canSetUp: boolean }) {
  return (
    <div data-attribution="not-set-up" className="flex min-h-[380px] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-card-title font-semibold text-ink-900">Revenue attribution is not set up yet.</p>
      <p className="text-helper text-ink-800">{cost > 0 ? `Campaign cost for this period: ${formatCompactMoney(cost)}.` : 'No campaign cost in this period.'}</p>
      {canSetUp
        ? <Link to="/settings/integrations" className={`${buttonClass({ variant: 'primary', size: 'sm' })} mt-2`}>Set Up Attribution</Link>
        : <p className="mt-2 text-helper text-ink-800">Ask an admin to set up attribution.</p>}
    </div>
  )
}

/** Attributed revenue against campaign cost over the period, in total or by campaign, with the four summary figures. */
export function RevenueCost({ filters, singleCampaign }: { filters: HomeFilters; singleCampaign: boolean }) {
  const { source, viewer } = useHomeData()
  const result = source.useRevenueCost(filters)
  const [picked, setPicked] = useState<View>('total')
  const legend = useChartLegend()
  if (result.status === 'unavailable') return null

  const data = result.status === 'ready' ? result.data : null
  const attributed = !data || data.summary.revenue !== null
  const view: View = singleCampaign ? 'total' : picked
  const weekly = data?.granularity === 'week'
  const { series, reference } = chartParts(data)
  const total = data?.summary.revenue ?? 0

  return (
    <HomeCard title="Attributed Revenue vs. Campaign Cost" icon={CircleDollarSign} flush
      actions={attributed && view === 'total' && data ? <ChartLegend series={series} reference={reference} hidden={legend.hidden} onToggle={legend.toggle} /> : undefined}>
      {!attributed && data ? <NotSetUp cost={data.summary.cost} canSetUp={viewer.can('user.admin')} /> : (
        <div className="flex h-full flex-col">
          <div className="flex flex-1 flex-col gap-4 p-4">
            {!singleCampaign && <div className="self-start"><SegmentedControl label="Revenue View" variant="outline" options={VIEWS} value={view} onChange={setPicked} /></div>}
            {view === 'total' ? (
              <Chart
                title={`Attributed revenue and campaign cost per ${weekly ? 'week' : 'day'}, with target pace`}
                categoryHeader={weekly ? 'Week' : 'Day'}
                categories={(data?.points ?? []).map((point) => ({
                  key: point.day,
                  label: formatShortDay(point.day),
                  detail: `${weekly ? 'Week of ' : ''}${formatShortDay(point.day)} ${point.day.slice(0, 4)}`,
                }))}
                series={series}
                reference={reference}
                type="bar"
                legend="none"
                hidden={legend.hidden}
                formatValue={formatCompactMoney}
                formatTick={formatAxisMoney}
                height={HEIGHT}
                loading={result.status === 'loading'}
                error={result.status === 'error' ? result.error : undefined}
                onRetry={result.status === 'error' ? result.retry : undefined}
                emptyText="Nothing was sent in this period."
              />
            ) : (
              <BarList
                title="Attributed revenue by campaign"
                rows={[
                  ...(data?.byCampaign.top ?? []).map((row) => ({ key: row.id, label: row.name, value: row.revenue, valueText: formatCompactMoney(row.revenue), secondary: total ? formatPercent((row.revenue / total) * 100) : undefined })),
                  ...(data?.byCampaign.others ? [{
                    key: 'others', label: `Others (${data.byCampaign.others.count} Campaigns)`, value: data.byCampaign.others.revenue,
                    valueText: formatCompactMoney(data.byCampaign.others.revenue), secondary: total ? formatPercent((data.byCampaign.others.revenue / total) * 100) : undefined,
                  }] : []),
                ]}
                loading={result.status === 'loading'}
                error={result.status === 'error' ? result.error : undefined}
                onRetry={result.status === 'error' ? result.retry : undefined}
                emptyText="No campaign has attributed revenue in this period."
              />
            )}
          </div>
          {data && data.points.length > 0 && <Summary summary={data.summary} />}
        </div>
      )}
    </HomeCard>
  )
}
