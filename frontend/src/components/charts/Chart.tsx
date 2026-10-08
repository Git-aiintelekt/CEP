/**
 * Every chart in CEP is drawn by this frame, so they all look and behave alike (the Charts rules in the cep-design
 * README): the legend that shows and hides series, horizontal gridlines, 12px axis labels, a guide line and tooltip
 * on hover, arrow keys and touch, the numbers as a table, and the same loading, empty and error states.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { SkeletonLine } from '@/components/States'
import { formatNumber } from '@/lib/format'

import { useChartLegend } from './legend'
import { colorSeries, labelEvery, niceTicks, REFERENCE_COLOR } from './scale'
import { BarSeries, LineSeries, ReferenceLine, type Plot } from './series'

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
}

/** a dashed Gray 400 line to read the series against (target pace): not a series, so it takes no colour, and it can't be hidden */
export interface ChartReference {
  key: string
  label: string
  values: number[]
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
  /** the series keys hidden from outside (useChartLegend); the chart's own legend manages this itself */
  hidden?: ReadonlySet<string>
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
  return <span aria-hidden data-swatch="square" className="h-2.5 w-2.5 shrink-0 rounded-xs border-2" style={{ borderColor: color, backgroundColor: hollow ? 'transparent' : color }} />
}

const shapeOf = (item: { mark?: 'bar' | 'line' }): SwatchShape => (item.mark === 'line' ? 'line' : 'square')

interface ChartLegendProps {
  series: ChartSeries[]
  reference?: ChartReference
  hidden: ReadonlySet<string>
  onToggle: (key: string) => void
}

/** The legend: a toggle per series (pressed = shown) and the reference as a plain label. Drawn above the chart, or anywhere with legend="none". */
export function ChartLegend({ series, reference, hidden, onToggle }: ChartLegendProps) {
  return (
    <div role="group" aria-label="Series" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {colorSeries(series).map((item) => {
        const on = !hidden.has(item.key)
        return (
          <button key={item.key} type="button" aria-pressed={on} onClick={() => onToggle(item.key)}
            className={`inline-flex h-6 items-center gap-2 rounded-control-sm px-1 text-helper transition-colors duration-fast ease-standard hover:bg-surface-hover ${on ? 'text-ink-800' : 'text-ink-800'}`}>
            <Swatch color={item.color} hollow={!on} shape={shapeOf(item)} />
            <span className={on ? '' : 'line-through'}>{item.label}</span>
          </button>
        )
      })}
      {reference && (
        <span data-legend-reference className="inline-flex h-6 items-center gap-2 px-1 text-helper text-ink-800">
          <Swatch color={REFERENCE_COLOR} shape="dashed" />
          {reference.label}
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

function DrawnChart({ title, categoryHeader, categories, series, type = 'line', formatValue = formatNumber, formatTick = formatValue, height, reference, legend = 'top', hidden: hiddenOutside }: ChartProps & { height: number }) {
  const [box, width] = useWidth()
  const own = useChartLegend()
  const hidden = hiddenOutside ?? own.hidden
  const [active, setActive] = useState<number | null>(null)
  const [showNumbers, setShowNumbers] = useState(false)
  const [tipWidth, setTipWidth] = useState(180)
  const tip = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const hintId = useId()

  const markOf = (item: ChartSeries) => item.mark ?? (type === 'bar' ? 'bar' : 'line')
  const colored = colorSeries(series)
  const shown = colored.filter((item) => !hidden.has(item.key))
  const count = categories.length
  const plotted = [...shown.flatMap((item) => item.values), ...(reference?.values ?? [])]
  const whole = plotted.every(Number.isInteger)
  const ticks = niceTicks(Math.max(0, ...plotted), 4, whole)
  const top = ticks.at(-1)!
  const left = Math.max(32, Math.max(...ticks.map((tick) => formatTick(tick).length)) * 7 + 12)
  // any bars put every category in a band, so a line among bars runs through the bars' centres
  const bars = colored.some((item) => markOf(item) === 'bar')
  const plotWidth = Math.max(1, width - left - PAD.right)
  const plotHeight = Math.max(1, height - PAD.top - PAD.bottom)
  const band = bars ? plotWidth / count : count > 1 ? plotWidth / (count - 1) : plotWidth
  const plot: Plot = {
    left, top: PAD.top, width: plotWidth, height: plotHeight, band,
    x: (index) => (bars ? left + band * (index + 0.5) : count === 1 ? left + plotWidth / 2 : left + band * index),
    y: (value) => PAD.top + plotHeight * (1 - value / top),
  }
  const labelWidth = Math.max(...categories.map((category) => category.label.length)) * 7 + 24
  const every = labelEvery(count, plotWidth - labelWidth, labelWidth)

  useLayoutEffect(() => {
    if (tip.current) setTipWidth(tip.current.offsetWidth || 180)
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
    }
  }

  const guideX = active === null ? 0 : plot.x(active)
  const flip = guideX + TOOLTIP_GAP + tipWidth > width
  const point = active === null ? null : categories[active]
  const readings = (index: number) => [...shown.map((item) => ({ key: item.key, label: item.label, value: item.values[index], color: item.color, shape: shapeOf(item) })),
    ...(reference ? [{ key: reference.key, label: reference.label, value: reference.values[index], color: REFERENCE_COLOR, shape: 'dashed' as const }] : [])]
  const said = point ? `${point.detail ?? point.label}: ${readings(active!).map((item) => `${item.label} ${formatValue(item.value)}`).join(', ')}` : ''
  const columns = [...colored.map((item) => ({ key: item.key, label: item.label, values: item.values })), ...(reference ? [reference] : [])]

  return (
    <figure ref={frame} className="flex flex-col gap-4">
      {legend === 'top' && <ChartLegend series={series} reference={reference} hidden={hidden} onToggle={own.toggle} />}

      <div ref={box} className="relative">
        <div tabIndex={0} role="group" aria-label={title} aria-describedby={hintId} data-chart-plot
          onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerLeave={onPointerLeave} onKeyDown={onKeyDown} onBlur={() => setActive(null)}
          className="touch-pan-y rounded-sm outline-none focus-visible:shadow-focus">
          <svg width={width} height={height} aria-hidden className="block overflow-visible" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={left} x2={width - PAD.right} y1={plot.y(tick)} y2={plot.y(tick)} stroke="var(--color-line-subtle)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={left - 8} y={plot.y(tick) + 4} textAnchor="end" fontSize={12} fill="var(--color-ink-800)">{formatTick(tick)}</text>
              </g>
            ))}
            {categories.map((category, index) => index % every === 0 && (
              <text key={category.key} x={plot.x(index)} y={height - 8} fontSize={12} fill="var(--color-ink-800)"
                textAnchor={bars || count === 1 ? 'middle' : index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}>{category.label}</text>
            ))}
            {active !== null && (
              <line data-guide x1={guideX} x2={guideX} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--color-ink-300)" strokeWidth={1} shapeRendering="crispEdges" />
            )}
            <BarSeries plot={plot} series={shown.filter((item) => markOf(item) === 'bar')} active={active} />
            {shown.filter((item) => markOf(item) === 'line').map((item) => <LineSeries key={item.key} plot={plot} series={item} area={item.area ?? (type === 'area' && !item.mark)} active={active} />)}
            {reference && <ReferenceLine plot={plot} keyName={reference.key} values={reference.values} color={REFERENCE_COLOR} />}
          </svg>
        </div>
        <p id={hintId} className="sr-only">Use the left and right arrow keys to read each point; Escape hides it.</p>
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
                <span className="cep-num ml-auto pl-3 font-semibold text-ink-900">{formatValue(item.value)}</span>
              </span>
            ))}
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
                  {columns.map((item) => <td key={item.key} className="cep-num px-4 text-right text-ink-900">{formatValue(item.values[index])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </figure>
  )
}
