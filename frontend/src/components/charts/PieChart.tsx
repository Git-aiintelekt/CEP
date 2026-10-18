/**
 * A pie (drawn as a ring, so the total can sit in the middle) of one measure by one dimension: the slices take the chart
 * palette in order, hairline gaps between them, the legend beside the ring with each slice's value and share, a hover or
 * the arrow keys read one slice in the middle, and the numbers as a table, like every chart in the kit. More than eight
 * slices fold into Other. A slice can be picked (cross-filtering on a dashboard).
 */
import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'

import { formatNumber } from '@/lib/format'

import { Swatch } from './Chart'
import { foldSlices, OTHER, type PieSlice } from './pie'
import { seriesColor } from './scale'

interface PieChartProps {
  /** what the chart shows, for screen readers: "Sent Count by Channel" */
  title: string
  /** the table's first column: "Channel" */
  categoryHeader: string
  /** the measure's name, for the table and the middle of the ring */
  valueLabel: string
  slices: PieSlice[]
  formatValue?: (value: number) => string
  /** the ring's diameter and the chart's height */
  height?: number
  emptyText?: string
  /** a slice was picked: its index among the slices given (Other, when folded, is never picked) */
  onSelect?: (index: number) => void
  /** a right-click on a slice, where it was */
  onContext?: (index: number, at: { x: number; y: number }) => void
}

function arc(cx: number, cy: number, outer: number, inner: number, from: number, to: number): string {
  const point = (radius: number, angle: number) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const
  if (to - from >= Math.PI * 2 - 1e-6) {                                 // one slice is the whole ring: two half arcs, as one arc cannot close on itself
    const [ox, oy] = point(outer, from), [mx, my] = point(outer, from + Math.PI)
    const [ix, iy] = point(inner, from), [nx, ny] = point(inner, from + Math.PI)
    return `M${ox} ${oy} A${outer} ${outer} 0 1 1 ${mx} ${my} A${outer} ${outer} 0 1 1 ${ox} ${oy} M${ix} ${iy} A${inner} ${inner} 0 1 0 ${nx} ${ny} A${inner} ${inner} 0 1 0 ${ix} ${iy} Z`
  }
  const large = to - from > Math.PI ? 1 : 0
  const [ax, ay] = point(outer, from), [bx, by] = point(outer, to)
  const [cxi, cyi] = point(inner, to), [dx, dy] = point(inner, from)
  return `M${ax} ${ay} A${outer} ${outer} 0 ${large} 1 ${bx} ${by} L${cxi} ${cyi} A${inner} ${inner} 0 ${large} 0 ${dx} ${dy} Z`
}

export function PieChart({ title, categoryHeader, valueLabel, slices, formatValue = formatNumber, height = 240, emptyText = 'Nothing to show yet.', onSelect, onContext }: PieChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const [showNumbers, setShowNumbers] = useState(false)
  const hintId = useId()
  const drawn = foldSlices(slices)
  const total = drawn.reduce((sum, slice) => sum + slice.value, 0)
  if (drawn.length === 0 || total <= 0) {
    return <div className="flex items-center justify-center px-4 text-center text-sm text-ink-800" style={{ minHeight: height }}><span data-chart-state="empty">{emptyText}</span></div>
  }
  const size = height
  const outer = size / 2 - 2
  const inner = outer * 0.62
  const pieces = drawn.reduce<{ slice: PieSlice; index: number; from: number; to: number; color: string; share: number }[]>((out, slice, index) => {
    const from = out.length ? out[out.length - 1].to : -Math.PI / 2
    return [...out, { slice, index, from, to: from + (slice.value / total) * Math.PI * 2, color: seriesColor(index, drawn.length), share: slice.value / total }]
  }, [])
  const pick = (index: number) => {
    if (onSelect && drawn[index]?.key !== OTHER) onSelect(index)
  }
  const context = (index: number) => (event: MouseEvent) => {
    if (!onContext || drawn[index]?.key === OTHER) return
    event.preventDefault()
    onContext(index, { x: event.clientX, y: event.clientY })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => number> = {
      ArrowRight: () => (active === null ? 0 : (active + 1) % drawn.length), ArrowDown: () => (active === null ? 0 : (active + 1) % drawn.length),
      ArrowLeft: () => (active === null ? drawn.length - 1 : (active - 1 + drawn.length) % drawn.length), ArrowUp: () => (active === null ? drawn.length - 1 : (active - 1 + drawn.length) % drawn.length),
      Home: () => 0, End: () => drawn.length - 1,
    }
    if (moves[event.key]) {
      event.preventDefault()
      setActive(moves[event.key]())
    } else if (event.key === 'Escape' && active !== null) {
      event.preventDefault()
      setActive(null)
    } else if ((event.key === 'Enter' || event.key === ' ') && active !== null && onSelect) {
      event.preventDefault()
      pick(active)
    }
  }
  const shown = active === null ? null : pieces[active]
  const said = shown ? `${shown.slice.label}: ${formatValue(shown.slice.value)}, ${(shown.share * 100).toFixed(1)}%` : `${valueLabel} ${formatValue(total)} in all`
  return (
    <figure className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-6">
        <div tabIndex={0} role="group" aria-label={title} aria-describedby={hintId} data-chart-plot onKeyDown={onKeyDown} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}
          className={`relative shrink-0 rounded-sm outline-none focus-visible:shadow-focus ${onSelect ? 'cursor-pointer' : ''}`} style={{ width: size, height: size }}>
          <svg width={size} height={size} aria-hidden className="block">
            {pieces.map((piece) => (
              <path key={piece.slice.key} d={arc(size / 2, size / 2, outer, inner, piece.from, piece.to)} fill={piece.color} data-slice={piece.slice.key}
                fillOpacity={active === null || active === piece.index ? 1 : 0.4} stroke="var(--color-surface)" strokeWidth={1.5}
                onPointerEnter={() => setActive(piece.index)} onClick={() => pick(piece.index)} onContextMenu={context(piece.index)} style={{ transition: 'fill-opacity 110ms' }} />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <span className="cep-num font-display text-[22px] leading-tight font-semibold text-ink-900">{shown ? `${(shown.share * 100).toFixed(1)}%` : formatValue(total)}</span>
            <span className="max-w-full truncate text-xs text-ink-800">{shown ? shown.slice.label : valueLabel}</span>
            {shown && <span className="cep-num text-xs text-ink-800">{formatValue(shown.slice.value)}</span>}
          </div>
        </div>
        <ul aria-label="Slices" className="flex min-w-0 flex-1 flex-col gap-1">
          {pieces.map((piece) => (
            <li key={piece.slice.key}>
              <button type="button" onClick={() => pick(piece.index)} onContextMenu={context(piece.index)} onPointerEnter={() => setActive(piece.index)} onPointerLeave={() => setActive(null)} aria-pressed={active === piece.index}
                className={`flex h-7 w-full items-center gap-2 rounded-control-sm px-1.5 text-left text-sm text-ink-800 transition-colors duration-fast ease-standard hover:bg-surface-hover ${onSelect && piece.slice.key !== OTHER ? '' : 'cursor-default'}`}>
                <Swatch color={piece.color} />
                <span className="min-w-0 flex-1 truncate">{piece.slice.label}</span>
                <span className="cep-num text-ink-900">{formatValue(piece.slice.value)}</span>
                <span className="cep-num w-14 text-right text-xs text-ink-700">{(piece.share * 100).toFixed(1)}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p id={hintId} className="sr-only">Use the arrow keys to read each slice{onSelect ? ', Enter to pick it' : ''}; Escape hides it.</p>
      <p className="sr-only" aria-live="polite">{said}</p>
      <div>
        <button type="button" aria-expanded={showNumbers} onClick={() => setShowNumbers((open) => !open)} className="text-helper font-semibold text-brand-800 hover:underline">
          {showNumbers ? 'Hide the Numbers' : 'Show the Numbers'}
        </button>
        <div className={showNumbers ? 'mt-3 max-h-64 overflow-auto rounded-lg border border-line' : 'sr-only'} data-chart-table>
          <table className="min-w-full divide-y divide-line text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-subtle"><tr>
              <th scope="col" className="h-10 px-4 text-left text-xs font-semibold text-ink-900">{categoryHeader}</th>
              <th scope="col" className="h-10 px-4 text-right text-xs font-semibold text-ink-900">{valueLabel}</th>
              <th scope="col" className="h-10 px-4 text-right text-xs font-semibold text-ink-900">Share</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {pieces.map((piece) => (
                <tr key={piece.slice.key} className="h-10">
                  <th scope="row" className="px-4 text-left font-normal text-ink-800">{piece.slice.label}</th>
                  <td className="cep-num px-4 text-right text-ink-900">{formatValue(piece.slice.value)}</td>
                  <td className="cep-num px-4 text-right text-ink-900">{(piece.share * 100).toFixed(1)}%</td>
                </tr>
              ))}
              <tr className="h-10 font-semibold">
                <th scope="row" className="px-4 text-left text-ink-900">Total</th>
                <td className="cep-num px-4 text-right text-ink-900">{formatValue(total)}</td>
                <td className="cep-num px-4 text-right text-ink-900">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </figure>
  )
}
