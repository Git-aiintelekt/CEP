/** The Journey Details chart: 6 weeks, 3 grouped bars each (Enrolled / Goal Converted / Exited Early), on the
 * shared chart kit — per [[feedback-charts-one-style]], every chart uses components/charts/, never a one-off. */
import { Chart, type ChartSeries } from '@/components/charts/Chart'
import type { JourneyTrendWeek } from '@/lib/types'

const SERIES = [
  { key: 'enrolled', label: 'Enrolled', color: 'var(--color-chart-1)' },
  { key: 'goal_converted', label: 'Goal Converted', color: 'var(--color-chart-2)' },
  { key: 'exited_early', label: 'Exited Early', color: 'var(--color-chart-3)' },
] as const

export function EnrollmentTrendChart({ weeks, loading, error, onRetry }: { weeks: JourneyTrendWeek[] | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const points = weeks ?? []
  const axis = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  const series: ChartSeries[] = SERIES.map((item) => ({ ...item, values: points.map((point) => point[item.key as keyof JourneyTrendWeek] as number) }))
  return (
    <Chart
      title="Enrolled, goal converted and exited early per week"
      categoryHeader="Week of"
      categories={points.map((point) => ({ key: point.week_start, label: axis.format(new Date(point.week_start)) }))}
      series={series}
      type="bar"
      loading={loading && !weeks}
      error={error}
      onRetry={onRetry}
      emptyText="Nothing enrolled yet. The chart fills in once contacts start entering this journey."
    />
  )
}
