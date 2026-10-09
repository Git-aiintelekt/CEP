import { Lightbulb } from 'lucide-react'
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
import { IntroScope } from '../intro'
import type { HomeFilters, RevenueCostSeries } from '../data/types'
import { revenueInsight, type RevenueInsight } from '../revenueInsight'

type View = 'total' | 'campaign'
const VIEWS: { value: View; label: string }[] = [{ value: 'total', label: 'Total' }, { value: 'campaign', label: 'By Campaign' }]
const HEIGHT = 260

/** revenue as solid blue bars, cost as the second series (the kit's pair colour), target pace as the dashed reference */
function chartParts(data: RevenueCostSeries | null): { series: ChartSeries[]; reference?: ChartReference } {
  const points = data?.points ?? []
  return {
    series: [
      { key: 'revenue', label: 'Revenue', mark: 'bar', values: points.map((point) => point.revenue ?? 0) },
      { key: 'cost', label: 'Campaign Cost', mark: 'line', values: points.map((point) => point.cost) },
    ],
    reference: points.some((point) => point.targetPace !== null) ? { key: 'target', label: 'Target Pace', values: points.map((point) => point.targetPace ?? 0) } : undefined,
  }
}

function Insight({ insight }: { insight: RevenueInsight }) {
  return (
    <div data-revenue-insight={insight.behind ? 'behind' : 'on-track'}
      className={`flex items-start gap-3 rounded-md border px-3.5 py-3 ${insight.behind ? 'cep-home-insight border-high-bg' : 'border-line-subtle bg-surface-subtle'}`}>
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

/** the period in four figures under the chart, edge to edge with hairlines between */
function Totals({ summary }: { summary: RevenueCostSeries['summary'] }) {
  const figures = [
    { label: 'Revenue', value: formatMoney(summary.revenue, { whole: true }) },
    { label: 'Campaign Cost', value: formatMoney(summary.cost, { whole: true }) },
    { label: 'ROI', value: summary.roi === null ? '—' : `${summary.roi.toFixed(1)}×` },
    { label: 'Per 1,000 Delivered', value: summary.revenuePer1000Delivered === null ? '—' : formatMoney(summary.revenuePer1000Delivered, { whole: true }) },
  ]
  return (
    <dl data-revenue-totals className="-mx-6 -mb-6 grid grid-cols-2 border-t border-line-subtle @min-[520px]:grid-cols-4">
      {figures.map((figure) => (
        <div key={figure.label} className="flex flex-col gap-0.5 border-line-subtle px-6 py-4 not-first:border-l @max-[519px]:nth-3:border-l-0 @max-[519px]:nth-[n+3]:border-t">
          <dt className="text-helper text-ink-800">{figure.label}</dt>
          <dd className="text-card-heading font-semibold text-ink-900 cep-num">{figure.value}</dd>
        </div>
      ))}
    </dl>
  )
}

interface RevenueCostProps {
  filters: HomeFilters
  singleCampaign: boolean
}

/**
 * Attributed revenue against campaign cost over the period, in total or by campaign, one sentence on how the period is
 * going, and the period's totals. The page-wide filters sit above the key figures.
 */
export function RevenueCost({ filters, singleCampaign }: RevenueCostProps) {
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
    <HomeCard title="Attributed Revenue vs. Campaign Cost"
      actions={attributed && data ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {view === 'total' && <ChartLegend series={series} reference={reference} hidden={legend.hidden} onToggle={legend.toggle} />}
          {!singleCampaign && <SegmentedControl label="Revenue View" variant="outline" options={VIEWS} value={view} onChange={setPicked} />}
        </div>
      ) : undefined}>
      {!attributed && data ? <NotSetUp cost={data.summary.cost} canSetUp={viewer.can('user.admin')} /> : (
        <div className="@container flex h-full flex-col gap-4">
          {view === 'total' ? (
            <>
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
                labelStep={!weekly && (data?.points.length ?? 0) > 14 ? 7 : undefined}
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
          {data && data.points.length > 0 && <div className={insight ? '' : 'mt-auto'}><Totals summary={data.summary} /></div>}
        </div>
      )}
    </HomeCard>
  )
}
