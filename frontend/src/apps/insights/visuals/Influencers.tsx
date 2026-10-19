/**
 * Key Influencers: what goes with a higher or a lower value of a rate or an average. The server runs the report grouped by
 * each candidate dimension and keeps the segments furthest from the whole, weighted by their share of the rows.
 */
import { useQuery } from '@tanstack/react-query'
import { ErrorState, Spinner } from '@/components/States'
import { ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { insightsApi } from '../api'
import { formatCell } from '../components/resultWords'
import type { AnalysisSource, Influence, InfluencersResult, ResultColumn, ReportView, RunResult } from '../types'
import { VisualReason } from './common'

function difference(result: InfluencersResult, item: Influence): string {
  if (result.points) return `${Math.abs(item.effect).toFixed(1)} points ${item.effect > 0 ? 'above' : 'below'}`
  const relative = result.overall ? Math.abs(item.effect / result.overall) * 100 : null
  return relative === null ? (item.effect > 0 ? 'above' : 'below') : `${relative.toFixed(relative < 10 ? 1 : 0)}% ${item.effect > 0 ? 'higher' : 'lower'}`
}

function Segments({ title, result, items, widest }: { title: string; result: InfluencersResult; items: Influence[]; widest: number }) {
  const column: ResultColumn = result.measure.column
  return (
    <section aria-label={title} className="flex min-w-0 flex-1 flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-ink-800">Nothing stands out.</p> : (
        <ol className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={`${item.field}:${String(item.value)}`} className="flex flex-col gap-1">
              <span className="text-sm text-ink-900">When <strong className="font-semibold">{item.field_label}</strong> is <strong className="font-semibold">{item.value_label}</strong></span>
              <span className="flex items-center gap-2">
                <span className="h-2 rounded-full" style={{ width: `${Math.max(4, (Math.abs(item.effect) / (widest || 1)) * 100)}%`, maxWidth: '70%', backgroundColor: item.effect > 0 ? 'var(--color-chart-1)' : 'var(--color-chart-2)' }} aria-hidden />
                <span className="cep-num shrink-0 text-xs text-ink-800">{formatCell(column, item.measure)}, {difference(result, item)}{item.rows !== null ? ` · ${formatNumber(item.rows)} rows` : ''}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function Influencers({ source, view, result, minHeight }: { source?: AnalysisSource; view: ReportView; result: RunResult; minHeight: number }) {
  const measures = result.columns.filter((column) => column.aggregate && !column.compare)
  const chosen = measures.some((m) => m.key === view.measure) ? view.measure : measures[0]?.key
  const query = useQuery({ queryKey: ['insights', 'influencers', source, chosen], queryFn: () => insightsApi.influencers(source as AnalysisSource, chosen), enabled: Boolean(source && chosen), retry: false })
  if (!source) return <VisualReason minHeight={minHeight}>Key Influencers runs in the report itself. Open the report to see it.</VisualReason>
  if (!measures.length) return <VisualReason minHeight={minHeight}>Key Influencers explains a value: add a rate or an average, such as Delivered Rate.</VisualReason>
  const refused = query.error instanceof ApiError && query.error.status === 422 ? query.error : null
  const data = query.data
  const widest = data ? Math.max(...[...data.higher, ...data.lower].map((item) => Math.abs(item.effect)), 0) : 0
  return (
    <div className="flex flex-col gap-4 rounded-md border border-line p-4" style={{ minHeight }}>
      <h2 className="text-sm font-semibold text-ink-900">What Influences {data?.measure.label ?? measures.find((m) => m.key === chosen)?.label}</h2>
      {query.isPending ? <Spinner label="Looking for what stands out" /> : refused ? <p className="text-sm text-ink-800">{refused.problem?.detail ?? refused.message}</p>
        : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : data && (
          <>
            <p className="cep-num text-sm text-ink-800">Overall {formatCell(data.measure.column, data.overall)}{data.rows !== null ? ` across ${formatNumber(data.rows)} rows` : ''}. Explained by {data.explained_by.join(', ') || 'no field'}.</p>
            <div className="flex flex-col gap-6 md:flex-row">
              <Segments title="Raises It" result={data} items={data.higher} widest={widest} />
              <Segments title="Lowers It" result={data} items={data.lower} widest={widest} />
            </div>
            <p className="text-xs text-ink-700">Each line compares one group with the whole report, weighted by how many rows it has. Groups that go together are not separated, so read them as leads, not causes.</p>
          </>
        )}
    </div>
  )
}
