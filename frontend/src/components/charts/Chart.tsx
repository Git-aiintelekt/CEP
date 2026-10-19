/**
 * Every chart in CEP is drawn by this frame, so they all look and behave alike (the Charts rules in the cep-design
 * README): the legend that shows and hides series, horizontal gridlines over a darker baseline, 13px axis labels, a guide line and tooltip
 * on hover, arrow keys and touch, the numbers as a table, and the same loading, empty and error states.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'

import { SkeletonLine } from '@/components/States'
import { formatNumber } from '@/lib/format'

import { useChartLegend } from './legend'
import { barCentre, colorSeries, labelEvery, niceTicks, REFERENCE_COLOR } from './scale'
import { BarSeries, LineSeries, ReferenceLine, StackedBarSeries, type Plot } from './series'

export interface ChartSeries {
  key: string
  label: string
  values: number[]
  /** a chart palette token; by default the series takes the next one in order */
  color?: string
  /** draw this series as bars or a line whatever the chart's type: bars go under, lines over */
  mark?: 'bar' | 'line'
  /** bars only, Home only (approved exception): filled top to bottom from the first colour into the second */
  gradient?: [string, string]
  /** a line with its 12% area under it, whatever the chart's type */
  area?: boolean
  /** a line read on the right-hand scale: a combo's line whose size or format differs from the bars */
  axis?: 'right'
  /** this series' numbers, when they read differently from the chart's (a percent line over count bars) */
  format?: (value: number) => string
}

/** a dashed Gray 400 line to read the series against (target pace): not a series, so it takes no colour, and it can't be hidden */
export interface ChartReference {
  key: string
  label: string
  values: number[]
}

/** a point of the first series marked as unusual: a red ring on it, and why in the tooltip */
export interface ChartFlag {
  index: number
  label: string
}

export interface ChartCategory {
  key: string
  /** on the x axis: "18 Sept, 10:00" */
  label: string
  /** in the tooltip and the table, when it says more than the axis */
  detail?: string
}

interface ChartProps {
  /** what the chart shows, for screen readers: "Messages sent, delivered, opened and clicked per hour" */
  title: string
  /** the table's first column: "Hour", "Domain" */
  categoryHeader: string
  categories: ChartCategory[]
  series: ChartSeries[]
  type?: 'line' | 'area' | 'bar'
  formatValue?: (value: number) => string
  /** the y axis labels, when they read better shorter than formatValue ("$80K" beside a tooltip's "$64.0K") */
  formatTick?: (value: number) => string
  /** the whole chart's height, axis labels included */
  height?: number
  loading?: boolean
  /** a failed request: said inline, with Retry */
  error?: unknown
  onRetry?: () => void
  /** said in place of the chart when there are no categories */
  emptyText?: string
  reference?: ChartReference
  /** 'none': the legend is drawn elsewhere with ChartLegend, and the chart follows its `hidden` */
  legend?: 'top' | 'none'
  /** label every nth category on the x axis (7 for a week of days) instead of as many as fit */
  labelStep?: number
  /** the series keys hidden from outside (useChartLegend); the chart's own legend manages this itself */
  hidden?: ReadonlySet<string>
  /** a category was picked, by a click or Enter on the active one (cross-filtering on a dashboard) */
  onSelect?: (index: number) => void
  /** the bars stacked in each category, bottom to top, instead of side by side */
  stacked?: boolean
  /** a right-click on a category, where it was (drill-through on a report) */
  onContext?: (index: number, at: { x: number; y: number }) => void
  /** points of the first series to mark as unusual */
  flags?: ChartFlag[]
  /** the top of the scale at least this high: small multiples read on one scale */
  yMax?: number
  /** comments pinned to categories: a marker above each, the comment in the tooltip */
  notes?: ChartFlag[]
  /** the category the pointer or the arrow keys are on, and its centre along the x axis (a tooltip report follows it) */
  onActive?: (index: number | null, x: number) => void
}

const PAD = { right: 8, top: 8, bottom: 28 }
const FALLBACK_WIDTH = 720
const TOOLTIP_GAP = 12

function useWidth() {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [box, width || FALLBACK_WIDTH] as const
}

export type SwatchShape = 'square' | 'line' | 'dashed'

/** square for bars and plain series, a short line for a line among bars, dashed for a reference */
export function Swatch({ color, hollow = false, shape = 'square' }: { color: string; hollow?: boolean; shape?: SwatchShape }) {
  if (shape !== 'square') {
    return <span aria-hidden data-swatch={shape} className={`w-3.5 shrink-0 border-t-2 ${shape === 'dashed' ? 'border-dashed' : ''} ${hollow ? 'opacity-40' : ''}`} style={{ borderColor: color }} />
  }
  return <span aria-hidden data-swatch="square" className="h-3 w-3 shrink-0 rounded-[3px] border-2" style={{ borderColor: color, backgroundColor: hollow ? 'transparent' : color }} />
}

const shapeOf = (item: { mark?: 'bar' | 'line' }): SwatchShape => (item.mark === 'line' ? 'line' : 'square')

interface ChartLegendProps {
  series: ChartSeries[]
  reference?: ChartReference
  hidden: ReadonlySet<string>
  onToggle: (key: string) => void
  /** the chart marks unusual points: the ring is explained */
  flagged?: boolean
  /** the chart carries comments: the marker is explained */
  noted?: boolean
}

/** The legend: a toggle per series (pressed = shown) and the reference as a plain label. Drawn above the chart, or anywhere with legend="none". */
export function ChartLegend({ series, reference, hidden, onToggle, flagged = false, noted = false }: ChartLegendProps) {
  return (
    <div role="group" aria-label="Series" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {colorSeries(series).map((item) => {
        const on = !hidden.has(item.key)
        return (
          <button key={item.key} type="button" aria-pressed={on} onClick={() => onToggle(item.key)}
            className="inline-flex h-7 items-center gap-2 rounded-control-sm px-1.5 text-sm text-ink-800 transition-colors duration-fast ease-standard hover:bg-surface-hover">
            <Swatch color={item.color} hollow={!on} shape={shapeOf(item)} />
            <span className={on ? '' : 'line-through'}>{item.label}</span>
          </button>
        )
      })}
      {reference && (
        <span data-legend-reference className="inline-flex h-7 items-center gap-2 px-1.5 text-sm text-ink-800">
          <Swatch color={REFERENCE_COLOR} shape="dashed" />
          {reference.label}
        </span>
      )}
      {flagged && (
        <span data-legend-flag className="inline-flex h-7 items-center gap-2 px-1.5 text-sm text-ink-800">
          <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border-2 border-danger" />
          Unusual Point
        </span>
      )}
      {noted && (
        <span data-legend-note className="inline-flex h-7 items-center gap-2 px-1.5 text-sm text-ink-800">
          <span aria-hidden className="h-3 w-3 shrink-0 rounded-full bg-ink-700" />
          Comment
        </span>
      )}
    </div>
  )
}

function ChartMessage({ height, children }: { height: number; children: ReactNode }) {
  return <div className="flex items-center justify-center px-4 text-center text-sm text-ink-800" style={{ minHeight: height }}>{children}</div>
}

export function Chart(props: ChartProps) {
  const { height = 280, loading, error, onRetry, categories, emptyText = 'Nothing to show yet.' } = props
  if (loading) {
    return (
      <div aria-busy data-chart-state="loading">
        <span className="sr-only">Loading the chart</span>
        <SkeletonLine width="100%" height={height} />
      </div>
    )
  }
  if (error) {
    const message = error instanceof Error && error.message ? ` ${error.message}` : ''
    return (
      <ChartMessage height={height}>
        <span role="alert" data-chart-state="error" className="flex flex-wrap items-center justify-center gap-2">
          The chart could not be loaded.{message}
          {onRetry && <button type="button" onClick={onRetry} className="font-semibold text-link hover:underline">Retry</button>}
        </span>
      </ChartMessage>
    )
  }
  if (categories.length === 0) return <ChartMessage height={height}><span data-chart-state="empty">{emptyText}</span></ChartMessage>
  return <DrawnChart {...props} height={height} />
}

function DrawnChart({ title, categoryHeader, categories, series, type = 'line', formatValue = formatNumber, formatTick = formatValue, height, reference, legend = 'top', labelStep, hidden: hiddenOutside, onSelect, stacked = false, onContext, flags = [], yMax, notes = [], onActive }: ChartProps & { height: number }) {
  const [box, width] = useWidth()
  const own = useChartLegend()
  const hidden = hiddenOutside ?? own.hidden
  const [active, setActive] = useState<number | null>(null)
  const [showNumbers, setShowNumbers] = useState(false)
  const [tipWidth, setTipWidth] = useState(180)
  const tip = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const hintId = useId()

  const markOf = (item: ChartSeries) => item.mark ?? (type === 'bar' || stacked ? 'bar' : 'line')
  const colored = colorSeries(series)
  const shown = colored.filter((item) => !hidden.has(item.key))
  const leftShown = shown.filter((item) => item.axis !== 'right')
  const rightShown = shown.filter((item) => item.axis === 'right')
  const count = categories.length
  const stackedBars = stacked ? leftShown.filter((item) => markOf(item) === 'bar') : []
  const stackTotals = categories.map((_, index) => stackedBars.reduce((sum, item) => sum + Math.max(0, item.values[index] || 0), 0))
  const plotted = [...(stacked ? [...stackTotals, ...leftShown.filter((item) => markOf(item) !== 'bar').flatMap((item) => item.values)] : leftShown.flatMap((item) => item.values)), ...(reference?.values ?? [])].filter(Number.isFinite)
  const whole = plotted.every(Number.isInteger)
  const ticks = niceTicks(Math.max(0, yMax ?? 0, ...plotted), 4, whole && Number.isInteger(yMax ?? 0))
  const top = ticks.at(-1)!
  const left = Math.max(36, Math.max(...ticks.map((tick) => formatTick(tick).length)) * 7.5 + 14)
  // a combo's other scale, read on the right
  const rightValues = rightShown.flatMap((item) => item.values).filter(Number.isFinite)
  const rightFormat = rightShown[0]?.format ?? formatTick
  const rightTicks = rightShown.length ? niceTicks(Math.max(0, ...rightValues), 4, rightValues.every(Number.isInteger)) : []
  const rightTop = rightTicks.at(-1) ?? 1
  const rightPad = rightShown.length ? Math.max(36, Math.max(...rightTicks.map((tick) => rightFormat(tick).length)) * 7.5 + 14) : 0
  // any bars put every category in a band, so a line among bars runs through the bars' centres
  const bars = colored.some((item) => markOf(item) === 'bar')
  const plotWidth = Math.max(1, width - left - PAD.right - rightPad)
  const plotHeight = Math.max(1, height - PAD.top - PAD.bottom)
  const band = bars ? plotWidth / count : count > 1 ? plotWidth / (count - 1) : plotWidth
  const plot: Plot = {
    left, top: PAD.top, width: plotWidth, height: plotHeight, band,
    x: (index) => (bars ? left + band * (index + 0.5) : count === 1 ? left + plotWidth / 2 : left + band * index),
    y: (value) => PAD.top + plotHeight * (1 - value / top),
  }
  const rightPlot: Plot = { ...plot, y: (value) => PAD.top + plotHeight * (1 - value / rightTop) }
  const labelWidth = Math.max(...categories.map((category) => category.label.length)) * 7 + 24
  const every = Math.max(labelStep ?? 1, labelEvery(count, plotWidth - labelWidth, labelWidth))

  useLayoutEffect(() => {
    if (tip.current) setTipWidth(tip.current.offsetWidth || 180)
  }, [active])
  useEffect(() => {
    onActive?.(active, active === null ? 0 : plot.x(active))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // a tap outside the chart puts the tooltip away
  useEffect(() => {
    if (active === null) return
    const away = (event: globalThis.PointerEvent) => {
      if (!frame.current?.contains(event.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [active])

  const nearest = (clientX: number, element: Element) => {
    const offset = clientX - element.getBoundingClientRect().left - left
    const index = bars ? Math.floor(offset / band) : Math.round(offset / band)
    return Math.min(count - 1, Math.max(0, count === 1 ? 0 : index))
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') setActive(nearest(event.clientX, event.currentTarget))
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') setActive(nearest(event.clientX, event.currentTarget))
  }
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') setActive(null)
  }
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (onSelect) onSelect(nearest(event.clientX, event.currentTarget))
  }
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!onContext) return
    event.preventDefault()
    onContext(nearest(event.clientX, event.currentTarget), { x: event.clientX, y: event.clientY })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => number> = {
      ArrowRight: () => (active === null ? 0 : Math.min(count - 1, active + 1)),
      ArrowLeft: () => (active === null ? count - 1 : Math.max(0, active - 1)),
      Home: () => 0,
      End: () => count - 1,
    }
    if (moves[event.key]) {
      event.preventDefault()
      setActive(moves[event.key]())
    } else if (event.key === 'Escape' && active !== null) {
      event.preventDefault()
      setActive(null)
    } else if ((event.key === 'Enter' || event.key === ' ') && active !== null && onSelect) {
      event.preventDefault()
      onSelect(active)
    }
  }

  const guideX = active === null ? 0 : plot.x(active)
  const flip = guideX + TOOLTIP_GAP + tipWidth > width
  const point = active === null ? null : categories[active]
  const readings = (index: number) => [...shown.map((item) => ({ key: item.key, label: item.label, value: item.values[index], color: item.color, shape: shapeOf(item), format: item.format ?? formatValue })),
    ...(reference ? [{ key: reference.key, label: reference.label, value: reference.values[index], color: REFERENCE_COLOR, shape: 'dashed' as const, format: formatValue }] : [])].filter((item) => Number.isFinite(item.value))
  // the unusual points sit on the first series shown on the left
  const flagged = flags.length && !stacked ? leftShown[0] : undefined
  const flagX = (index: number) => {
    if (!flagged || markOf(flagged) !== 'bar') return plot.x(index)
    const barred = leftShown.filter((item) => markOf(item) === 'bar')
    return barCentre(plot, barred.length, barred.indexOf(flagged), index)
  }
  const flagAt = (index: number | null) => (flagged && index !== null ? flags.find((flag) => flag.index === index) : undefined)
  const notesAt = (index: number | null) => (index === null ? [] : notes.filter((note) => note.index === index))
  const said = point ? `${point.detail ?? point.label}: ${readings(active!).map((item) => `${item.label} ${item.format(item.value)}`).join(', ')}${flagAt(active) ? `. Unusual: ${flagAt(active)!.label}` : ''}${notesAt(active).map((note) => `. Comment: ${note.label}`).join('')}` : ''
  const columns = [...colored.map((item) => ({ key: item.key, label: item.label, values: item.values, format: item.format ?? formatValue })), ...(reference ? [{ ...reference, format: formatValue }] : [])]

  return (
    <figure ref={frame} className="flex flex-col gap-4">
      {legend === 'top' && <ChartLegend series={series} reference={reference} hidden={hidden} onToggle={own.toggle} flagged={Boolean(flagged)} noted={notes.length > 0} />}

      <div ref={box} className="relative">
        <div tabIndex={0} role="group" aria-label={title} aria-describedby={hintId} data-chart-plot
          onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerLeave={onPointerLeave} onClick={onClick} onContextMenu={onContextMenu} onKeyDown={onKeyDown} onBlur={() => setActive(null)}
          className={`touch-pan-y rounded-sm outline-none focus-visible:shadow-focus ${onSelect ? 'cursor-pointer' : ''}`}>
          <svg width={width} height={height} aria-hidden className="block overflow-visible" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={left} x2={left + plotWidth} y1={plot.y(tick)} y2={plot.y(tick)} stroke={tick === 0 ? 'var(--color-line)' : 'var(--color-line-subtle)'} strokeWidth={tick === 0 ? 1.5 : 1} shapeRendering="crispEdges" />
                <text x={left - 10} y={plot.y(tick) + 4} textAnchor="end" fontSize={13} fill="var(--color-ink-800)">{formatTick(tick)}</text>
              </g>
            ))}
            {categories.map((category, index) => index % every === 0 && (
              <text key={category.key} x={plot.x(index)} y={height - 7} fontSize={13} fill="var(--color-ink-800)"
                textAnchor={bars || count === 1 ? 'middle' : index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}>{category.label}</text>
            ))}
            {active !== null && (
              <line data-guide x1={guideX} x2={guideX} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--color-ink-300)" strokeWidth={1} shapeRendering="crispEdges" />
            )}
            {rightTicks.map((tick) => <text key={`right-${tick}`} data-axis="right" x={left + plotWidth + 10} y={rightPlot.y(tick) + 4} textAnchor="start" fontSize={13} fill="var(--color-ink-800)">{rightFormat(tick)}</text>)}
            {stacked ? <StackedBarSeries plot={plot} series={stackedBars} active={active} /> : <BarSeries plot={plot} series={leftShown.filter((item) => markOf(item) === 'bar')} active={active} />}
            {shown.filter((item) => markOf(item) === 'line').map((item) => <LineSeries key={item.key} plot={item.axis === 'right' ? rightPlot : plot} series={item} area={item.area ?? (type === 'area' && !item.mark)} active={active} />)}
            {reference && <ReferenceLine plot={plot} keyName={reference.key} values={reference.values} color={REFERENCE_COLOR} />}
            {[...new Set(notes.map((note) => note.index))].filter((index) => index < count).map((index) => (
              <g key={`note-${index}`} data-note={index}>
                <line x1={plot.x(index)} x2={plot.x(index)} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--color-ink-300)" strokeDasharray="3 3" />
                <circle cx={plot.x(index)} cy={PAD.top} r={5} fill="var(--color-ink-700)" stroke="var(--color-surface)" strokeWidth={1.5} />
              </g>
            ))}
            {flagged && flags.map((flag) => Number.isFinite(flagged.values[flag.index]) && (
              <circle key={`flag-${flag.index}`} data-flag={flag.index} cx={flagX(flag.index)} cy={plot.y(flagged.values[flag.index])} r={6} fill="none" stroke="var(--color-danger)" strokeWidth={2} />
            ))}
          </svg>
        </div>
        <p id={hintId} className="sr-only">Use the left and right arrow keys to read each point{onSelect ? ', Enter to pick it' : ''}; Escape hides it.</p>
        <p className="sr-only" aria-live="polite">{said}</p>

        {point && (
          <div ref={tip} role="presentation" data-chart-tooltip
            className="pointer-events-none absolute z-10 flex min-w-40 flex-col gap-1.5 rounded-lg border border-line bg-surface-overlay px-3 py-2.5 shadow-toast"
            style={{ top: PAD.top, left: flip ? guideX - TOOLTIP_GAP : guideX + TOOLTIP_GAP, transform: flip ? 'translateX(-100%)' : undefined }}>
            <span className="cep-num text-xs whitespace-nowrap text-ink-800">{point.detail ?? point.label}</span>
            {readings(active!).map((item) => (
              <span key={item.key} className="flex items-center gap-2 text-helper whitespace-nowrap">
                <Swatch color={item.color} shape={item.shape} />
                <span className="text-ink-800">{item.label}</span>
                <span className="cep-num ml-auto pl-3 font-semibold text-ink-900">{item.format(item.value)}</span>
              </span>
            ))}
            {flagAt(active) && <span data-tooltip-flag className="max-w-60 text-helper text-danger-text">Unusual: {flagAt(active)!.label}</span>}
            {notesAt(active).map((note, i) => <span key={i} data-tooltip-note className="max-w-60 text-helper text-ink-800">Comment: {note.label}</span>)}
          </div>
        )}
      </div>

      <div>
        <button type="button" aria-expanded={showNumbers} onClick={() => setShowNumbers((open) => !open)} className="text-helper font-semibold text-brand-800 hover:underline">
          {showNumbers ? 'Hide the Numbers' : 'Show the Numbers'}
        </button>
        <div className={showNumbers ? 'mt-3 max-h-64 overflow-auto rounded-lg border border-line' : 'sr-only'} data-chart-table>
          <table className="min-w-full divide-y divide-line text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-subtle"><tr>
              <th scope="col" className="h-10 px-4 text-left text-xs font-semibold text-ink-900">{categoryHeader}</th>
              {columns.map((item) => <th key={item.key} scope="col" className="h-10 px-4 text-right text-xs font-semibold text-ink-900">{item.label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {categories.map((category, index) => (
                <tr key={category.key} className="h-10">
                  <th scope="row" className="px-4 text-left font-normal text-ink-800">{category.detail ?? category.label}</th>
                  {columns.map((item) => <td key={item.key} className="cep-num px-4 text-right text-ink-900">{Number.isFinite(item.values[index]) ? item.format(item.values[index]) : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </figure>
  )
}
