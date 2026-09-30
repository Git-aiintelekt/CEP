/**
 * Horizontal bars with no axes, for a ranking or a funnel: a label and its value on one line, a 6px bar under them
 * measured against `max`. Part of the chart kit, so its loading, empty and error states match Chart's.
 */
import type { ReactNode } from 'react'

import { SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { formatNumber } from '@/lib/format'

export interface BarListRow {
  key: string
  label: string
  /** null: no bar and no number (the row says `valueText` instead, for example "Not Tracked") */
  value: number | null
  /** the value as shown; formatValue(value) by default */
  valueText?: string
  /** after the value in 13px ink-800: the share, "22.4%" */
  secondary?: string
  /** a chart palette token; chart-1 by default */
  color?: string
  /** under the row, inside the same list item: a funnel's drop-off */
  after?: ReactNode
}

interface BarListProps {
  /** the list's accessible name */
  title: string
  rows: BarListRow[]
  /** the value a full bar stands for; the largest value by default */
  max?: number
  formatValue?: (value: number) => string
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  emptyText?: string
}

export function BarList({ title, rows, max, formatValue = formatNumber, loading, error, onRetry, emptyText = 'Nothing to show yet.' }: BarListProps) {
  if (loading) {
    return (
      <div aria-busy data-chart-state="loading" className="flex flex-col gap-4">
        <span className="sr-only">Loading the chart</span>
        {[70, 55, 40].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}
      </div>
    )
  }
  if (error) {
    const message = error instanceof Error && error.message ? ` ${error.message}` : ''
    return (
      <p role="alert" data-chart-state="error" className="flex flex-wrap items-center gap-2 text-sm text-ink-800">
        The chart could not be loaded.{message}
        {onRetry && <button type="button" onClick={onRetry} className="font-semibold text-brand-600 hover:underline">Retry</button>}
      </p>
    )
  }
  if (rows.length === 0) return <p data-chart-state="empty" className="text-sm text-ink-800">{emptyText}</p>

  const full = max ?? Math.max(0, ...rows.map((row) => row.value ?? 0))
  return (
    <ul aria-label={title} className="flex flex-col gap-4">
      {rows.map((row) => {
        const share = row.value === null || full <= 0 ? 0 : Math.min(100, (row.value / full) * 100)
        return (
          <li key={row.key} data-bar-row={row.key} className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-baseline gap-3">
              <TruncatedText text={row.label} className="min-w-0 flex-1 text-sm text-ink-800" />
              {/* a space between them, so the row reads "Delivered 1,142,300" */}
              <span className="sr-only"> </span>
              <span className={`shrink-0 text-sm cep-num ${row.value === null ? 'text-ink-800' : 'font-semibold text-ink-900'}`}>
                {row.valueText ?? (row.value === null ? '—' : formatValue(row.value))}
              </span>
              {row.secondary && <span className="w-14 shrink-0 text-right text-helper text-ink-800 cep-num">{row.secondary}</span>}
            </div>
            {row.value !== null && (
              <span aria-hidden data-bar className="block h-1.5 overflow-hidden rounded-pill bg-fill-subtle">
                <span className="block h-full rounded-pill" style={{ width: `${share}%`, backgroundColor: row.color ?? 'var(--color-chart-1)' }} />
              </span>
            )}
            {row.after}
          </li>
        )
      })}
    </ul>
  )
}
