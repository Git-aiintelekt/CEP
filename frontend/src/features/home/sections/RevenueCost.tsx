import { ChartColumn, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { SegmentedControl } from '@/components/SegmentedControl'
import { BarList } from '@/components/charts/BarList'
import { Chart, ChartLegend, type ChartReference, type ChartSeries } from '@/components/charts/Chart'
import { useChartLegend } from '@/components/charts/legend'
import { buttonClass } from '@/components/buttonStyles'
import { formatAxisMoney, formatCompactMoney, formatPercent, formatShortDay } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { HomeFilterBar } from '../components/HomeFilterBar'
import { useHomeData } from '../data/homeDataContext'
import { IntroScope } from '../intro'
import type { HomeFilters, RevenueCostSeries } from '../data/types'
import { revenueInsight, type RevenueInsight } from '../revenueInsight'

type View = 'total' | 'campaign'
const VIEWS: { value: View; label: string }[] = [{ value: 'total', label: 'Total' }, { value: 'campaign', label: 'By Campaign' }]
const HEIGHT = 260

/** revenue as bars, cost as the second series (Plum by the kit's pair rule), target pace as the dashed reference */
function chartParts(data: RevenueCostSeries | null): { series: ChartSeries[]; reference?: ChartReference } {
  const points = data?.points ?? []
  return {
    series: [
      // Home's approved gradient: plum at the top of each bar into blue
      { key: 'revenue', label: 'Revenue', mark: 'bar', values: points.map((point) => point.revenue ?? 0), gradient: ['var(--color-plum-500)', 'var(--color-brand-600)'] },
      { key: 'cost', label: 'Cost', mark: 'line', area: true, values: points.map((point) => point.cost) },
    ],
    reference: points.some((point) => point.targetPace !== null) ? { key: 'target', label: 'Target Pace', values: points.map((point) => point.targetPace ?? 0) } : undefined,
  }
}

function Insight({ insight }: { insight: RevenueInsight }) {
  return (
    <div data-revenue-insight={insight.behind ? 'behind' : 'on-track'}
      className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 ${insight.behind ? 'cep-home-insight border-high-bg' : 'cep-home-strip border-line-subtle'}`}>
      <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control-md ${insight.behind ? 'cep-home-insight-badge text-on-brand' : 'cep-home-badge text-plum-700'}`}>
        <Lightbulb size={15} strokeWidth={1.5} />
      </span>
      <p className={`min-w-0 text-helper ${insight.behind ? 'text-warning-text' : 'text-ink-800'}`}>
        <span className="font-semibold">{insight.title}.</span> {insight.detail}
      </p>
    </div>
  )
}

function NotSetUp({ cost, canSetUp }: { cost: number; canSetUp: boolean }) {
  return (
    <div data-attribution="not-set-up" className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-card-title font-semibold text-ink-900">Revenue attribution is not set up yet.</p>
      <p className="text-helper text-ink-800">{cost > 0 ? `Campaign cost for this period: ${formatCompactMoney(cost)}.` : 'No campaign cost in this period.'}</p>
      {canSetUp
        ? <Link to="/settings/attribution" className={`${buttonClass({ variant: 'primary', size: 'sm' })} mt-2`}>Set Up Attribution</Link>
        : <p className="mt-2 text-helper text-ink-800">Ask an admin to set up attribution.</p>}
    </div>
  )
}

interface RevenueCostProps {
  filters: HomeFilters
  onChange: (next: Partial<HomeFilters>) => void
  onClear: () => void
  singleCampaign: boolean
}

/**
 * Marketing Performance: attributed revenue against campaign cost over the period, in total or by campaign, with the
 * page-wide filters in its header and one sentence on how the period is going.
 */
export function RevenueCost({ filters, onChange, onClear, singleCampaign }: RevenueCostProps) {
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
  const insight = data && attributed ? revenueInsight(data) : null

  return (
    <HomeCard title="Marketing Performance" icon={ChartColumn} strip actions={<HomeFilterBar filters={filters} onChange={onChange} onClear={onClear} />}>
      {!attributed && data ? <NotSetUp cost={data.summary.cost} canSetUp={viewer.can('user.admin')} /> : (
        <div className="flex h-full flex-col gap-4">
          {!singleCampaign && <div className="self-start"><SegmentedControl label="Revenue View" variant="outline" options={VIEWS} value={view} onChange={setPicked} /></div>}
          {view === 'total' ? (
            <>
              {data && <ChartLegend series={series} reference={reference} hidden={legend.hidden} onToggle={legend.toggle} />}
              <IntroScope key={result.status} enabled={result.status === 'ready' && (data?.points.length ?? 0) > 0} className="cep-intro-rise">
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
              </IntroScope>
            </>
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
          {insight && <div className="mt-auto"><Insight insight={insight} /></div>}
        </div>
      )}
    </HomeCard>
  )
}
