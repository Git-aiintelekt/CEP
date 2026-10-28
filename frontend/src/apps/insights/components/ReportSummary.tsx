/**
 * A report's figures above its result (docs/mockups/report-page.html): up to four, one per measure in the report's order,
 * each the whole result's value: the engine's grand total when it sent one, else the rows added up (a sum or a count,
 * when every row is here), else What This Means's figure. Under them, What This Means in one line when the workspace
 * has a benchmark on the report's data and the rules judged it: the tone, the verdict, and a link to Explain's reasons.
 */
import { useQuery } from '@tanstack/react-query'

import { benchmarksApi, insightsApi, keys } from '../api'
import type { Meaning, MeaningBand, MeaningFigure, ParameterValues, ResultColumn, RunResult } from '../types'
import { formatCell } from './resultWords'

const TONE: Record<MeaningBand, string> = {
  good: 'bg-success-bg text-success-text',
  watch: 'bg-warning-bg text-warning-text',
  act: 'bg-danger-bg text-danger-text',
}
const MAX = 4
/** the cards share the row evenly, however many there are */
const COLUMNS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-2 lg:grid-cols-3', 'grid-cols-2 lg:grid-cols-4']

function Tag({ tone, children }: { tone: MeaningBand; children: string }) {
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs font-semibold whitespace-nowrap ${TONE[tone]}`}>{children}</span>
}

const matches = (figure: MeaningFigure, column: ResultColumn) => figure.key === column.key || figure.label === column.label

/** a measure's value over the whole result, or undefined when it cannot be known from what is here */
function wholeValue(result: RunResult, column: ResultColumn): number | null | undefined {
  const grand = result.totals?.find((entry) => Object.keys(entry.keys).length === 0)
  if (grand) {
    const value = grand.values[result.columns.filter((c) => c.aggregate).indexOf(column)]
    return typeof value === 'number' ? value : value === null ? null : undefined
  }
  const whole = !result.truncated && result.offset === 0 && result.rows.length === result.row_count
  if (!whole || (column.aggregate !== 'sum' && column.aggregate !== 'count')) return undefined
  const at = result.columns.indexOf(column)
  return result.rows.reduce<number>((sum, row) => sum + (typeof row[at] === 'number' ? (row[at] as number) : 0), 0)
}

export function ReportSummary({ reportId, dataset, result, params, period, onWhy }: { reportId: string; dataset: string; result: RunResult; params?: ParameterValues
  /** the dates the report covers, under each figure */
  period?: string | null
  /** opens Explain, where the verdict's reasons are */
  onWhy: () => void }) {
  const benchmarks = useQuery({ queryKey: keys.benchmarks, queryFn: ({ signal }) => benchmarksApi.list(signal), staleTime: 300_000, retry: false })
  const judged = Boolean(benchmarks.data?.benchmarks.some((b) => b.dataset === dataset))
  const meaning = useQuery<Meaning>({ queryKey: keys.meaning(reportId, params), queryFn: () => insightsApi.meaning(reportId, params), enabled: judged, retry: false, staleTime: 60_000 })
  const measures = result.columns.filter((column) => column.aggregate && !column.compare)
  const figures = measures.flatMap((column) => {
    const own = meaning.data?.figures.find((figure) => matches(figure, column))
    const value = wholeValue(result, column) ?? (own?.value === undefined ? undefined : own.value)
    return value === undefined ? [] : [{ column, value, judged: own?.state === 'judged' && own.band ? own : null }]
  }).slice(0, MAX)
  const verdict = meaning.data?.ready && meaning.data.verdict.tone !== 'none' ? meaning.data.verdict : null
  if (figures.length === 0 && !verdict) return null
  return (
    <section aria-label="Summary" className="overflow-hidden rounded-lg border border-line bg-surface">
      {figures.length > 0 && (
        <ul className={`grid ${COLUMNS[figures.length]}`}>
          {figures.map(({ column, value, judged: figure }) => (
            <li key={column.key} className="flex min-w-0 flex-col gap-0.5 border-line-subtle px-5 py-4 not-last:border-r">
              <span className="truncate text-sm text-ink-800">{column.label}</span>
              <span className="cep-num text-kpi font-semibold text-ink-900">{value === null ? '—' : formatCell(column, value)}</span>
              <span className="flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-ink-800">
                {figure ? <><Tag tone={figure.band as MeaningBand}>{figure.words}</Tag>{figure.target}</> : period}
              </span>
            </li>
          ))}
        </ul>
      )}
      {verdict && (
        <div className={`flex items-start gap-2.5 bg-surface-subtle px-5 py-3 text-sm ${figures.length ? 'border-t border-line-subtle' : ''}`}>
          <Tag tone={verdict.tone as MeaningBand}>{verdict.chip}</Tag>
          <p className="text-ink-800">
            <span className="font-semibold text-ink-900">{verdict.title}</span>{verdict.summary ? ` ${verdict.summary}` : ''}{' '}
            <button type="button" className="font-semibold text-link hover:underline" onClick={onWhy}>Why It’s Judged This Way</button>
          </p>
        </div>
      )}
    </section>
  )
}
