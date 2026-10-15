/** Sent / delivered / opened / clicked per hour or day, on the shared chart kit. Texts have no opens or clicks. */
import { Chart, type ChartSeries } from '@/components/charts/Chart'
import type { CampaignTimeseries } from '@/lib/types'

import { dateTimeInZone, isKnownZone } from '../zone'

const SERIES = [
  { key: 'sent', label: 'Sent', color: 'var(--color-chart-4)' },
  { key: 'delivered', label: 'Delivered', color: 'var(--color-chart-1)' },
  { key: 'opened', label: 'Opened', color: 'var(--color-chart-2)' },
  { key: 'clicked', label: 'Clicked', color: 'var(--color-chart-3)' },
] as const

interface TimeseriesChartProps {
  data: CampaignTimeseries | undefined
  texts: boolean
  zone: string
  loading: boolean
  error: unknown
  onRetry: () => void
}

export function TimeseriesChart({ data, texts, zone, loading, error, onRetry }: TimeseriesChartProps) {
  const bucket = data?.bucket ?? 'hour'
  const points = data?.points ?? []
  const safeZone = isKnownZone(zone) ? zone : 'UTC'
  const axis = new Intl.DateTimeFormat(undefined, { timeZone: safeZone, day: 'numeric', month: 'short', ...(bucket === 'hour' ? { hour: '2-digit', minute: '2-digit' } : {}) })
  const day = new Intl.DateTimeFormat(undefined, { timeZone: safeZone, dateStyle: 'medium' })
  const shown = SERIES.filter((item) => !texts || item.key === 'sent' || item.key === 'delivered')
  const series: ChartSeries[] = shown.map((item) => ({ ...item, values: points.map((point) => point[item.key]) }))
  return (
    <Chart
      title={`Messages ${shown.map((item) => item.label.toLowerCase()).join(', ')} per ${bucket}`}
      categoryHeader={bucket === 'day' ? 'Day' : 'Hour'}
      categories={points.map((point) => ({ key: point.at, label: axis.format(new Date(point.at)), detail: bucket === 'day' ? day.format(new Date(point.at)) : dateTimeInZone(point.at, safeZone) }))}
      series={series}
      loading={loading && !data}
      error={error}
      onRetry={onRetry}
      emptyText="Nothing has been sent yet. The chart fills in as messages go out."
    />
  )
}
