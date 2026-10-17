/**
 * A funnel: the stages in the order given (the report's), each a bar centred in its lane and as wide as its share of the
 * widest stage, with its value, its share of the first stage and the drop from the stage before. The numbers are on the
 * chart itself, so it needs no table. A stage can be picked (cross-filtering on a dashboard).
 */
import { formatNumber } from '@/lib/format'

export interface FunnelStage {
  key: string
  label: string
  value: number
}

interface FunnelChartProps {
  /** what the chart shows, for screen readers: "Enrollments by Status" */
  title: string
  /** the measure's name, read with each value */
  valueLabel: string
  stages: FunnelStage[]
  formatValue?: (value: number) => string
  emptyText?: string
  /** a stage was picked: its index among the stages given */
  onSelect?: (index: number) => void
}

const MAX_STAGES = 12
const BAR = 'var(--color-chart-1)'

export function FunnelChart({ title, valueLabel, stages, formatValue = formatNumber, emptyText = 'Nothing to show yet.', onSelect }: FunnelChartProps) {
  const shown = stages.slice(0, MAX_STAGES).map((stage) => ({ ...stage, value: Math.max(0, Number(stage.value) || 0) }))
  const widest = Math.max(...shown.map((stage) => stage.value), 0)
  if (shown.length === 0 || widest <= 0) {
    return <div className="flex min-h-40 items-center justify-center px-4 text-center text-sm text-ink-800"><span data-chart-state="empty">{emptyText}</span></div>
  }
  const first = shown[0].value
  return (
    <figure className="flex flex-col gap-2">
      <ol aria-label={title} data-chart-plot className="flex flex-col gap-1">
        {shown.map((stage, index) => {
          const previous = index > 0 ? shown[index - 1].value : null
          const drop = previous ? (stage.value - previous) / previous : null
          const share = first > 0 ? stage.value / first : 0
          const words = `${stage.label}: ${valueLabel} ${formatValue(stage.value)}, ${(share * 100).toFixed(0)}% of ${shown[0].label}${drop !== null ? `, ${(drop * 100).toFixed(0)}% from ${shown[index - 1].label}` : ''}`
          const row = (
            <>
              <span className="w-32 shrink-0 truncate text-right text-sm text-ink-800 sm:w-40" title={stage.label}>{stage.label}</span>
              <span className="relative h-7 min-w-0 flex-1" aria-hidden>
                <span className="absolute top-0 bottom-0 rounded-[3px]" data-stage={stage.key} style={{ left: `${((1 - stage.value / widest) / 2) * 100}%`, width: `${(stage.value / widest) * 100}%`, minWidth: 2, backgroundColor: BAR }} />
              </span>
              <span className="cep-num w-24 shrink-0 text-right text-sm font-semibold text-ink-900 sm:w-28">{formatValue(stage.value)}</span>
              <span className="cep-num w-12 shrink-0 text-right text-xs text-ink-700">{(share * 100).toFixed(0)}%</span>
              <span className="cep-num hidden w-16 shrink-0 text-right text-xs text-ink-700 sm:inline">{drop === null ? '' : `${drop > 0 ? '+' : '−'}${Math.abs(drop * 100).toFixed(0)}%`}</span>
            </>
          )
          return (
            <li key={stage.key} data-funnel-stage={stage.key}>
              {onSelect ? (
                <button type="button" aria-label={words} onClick={() => onSelect(index)} className="flex w-full items-center gap-3 rounded-control-sm px-1.5 py-0.5 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:shadow-focus focus-visible:outline-none">{row}</button>
              ) : (
                <span className="flex w-full items-center gap-3 px-1.5 py-0.5" aria-label={words} role="img">{row}</span>
              )}
            </li>
          )
        })}
      </ol>
      <figcaption className="flex justify-end gap-3 px-1.5 text-xs text-ink-700">
        <span>{valueLabel}</span><span className="w-12 text-right">Of first</span><span className="hidden w-16 text-right sm:inline">Change</span>
      </figcaption>
    </figure>
  )
}
