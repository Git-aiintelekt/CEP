/** What the chart frame draws its series with: lines (optionally with an area under them) and grouped bars. */
import { useId } from 'react'

import { BAR_GAP, barGeometry } from './scale'

export interface Plot {
  left: number
  top: number
  width: number
  height: number
  /** the centre of category `index` */
  x: (index: number) => number
  y: (value: number) => number
  /** the room one category has along the x axis */
  band: number
}

export interface DrawnSeries {
  key: string
  color: string
  values: number[]
  gradient?: [string, string]
}

/** a 6px dot with a 2px white ring: the only point a line ever shows */
function ActiveDot({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="var(--color-surface)" strokeWidth={2} paintOrder="stroke" data-active-dot />
}

/** a path through the values, lifting the pen over a value that is not a number (a period with nothing yet, such as a forecast's) */
function tracePath(plot: Plot, values: number[]): string {
  let pen = false
  return values.map((value, index) => {
    if (!Number.isFinite(value)) { pen = false; return '' }
    const step = `${pen ? 'L' : 'M'}${plot.x(index).toFixed(1)} ${plot.y(value).toFixed(1)}`
    pen = true
    return step
  }).filter(Boolean).join(' ')
}

export function LineSeries({ plot, series, area = false, active }: { plot: Plot; series: DrawnSeries; area?: boolean; active: number | null }) {
  const points = series.values.map((value, index) => [plot.x(index), plot.y(value)] as const)
  const drawn = series.values.filter(Number.isFinite).length
  const whole = drawn === series.values.length
  const line = tracePath(plot, series.values)
  const floor = plot.top + plot.height
  const only = series.values.findIndex(Number.isFinite)
  return (
    <g data-series={series.key}>
      {area && whole && points.length > 1 && (
        <path d={`${line} L${points.at(-1)![0].toFixed(1)} ${floor} L${points[0][0].toFixed(1)} ${floor} Z`} fill={series.color} fillOpacity={0.12} stroke="none" />
      )}
      {drawn > 1 && <path d={line} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {drawn === 1 && active === null && <circle cx={points[only][0]} cy={points[only][1]} r={3} fill={series.color} />}
      {active !== null && points[active] && Number.isFinite(series.values[active]) && <ActiveDot cx={points[active][0]} cy={points[active][1]} color={series.color} />}
    </g>
  )
}


/** a bar standing on the axis with both ends fully rounded: a pill as wide as the bar */
function barPath(x: number, y: number, width: number, bottom: number): string {
  const height = bottom - y
  if (height <= 0) return ''
  const r = Math.min(width / 2, height / 2)
  return `M${x} ${bottom - r}V${y + r}A${r} ${r} 0 0 1 ${x + width} ${y + r}V${bottom - r}A${r} ${r} 0 0 1 ${x} ${bottom - r}Z`
}

/** each category's bars side by side, 4px apart, the group taking about 78% of its band; while a category is active the others fade to 40% */
export function BarSeries({ plot, series, active = null }: { plot: Plot; series: DrawnSeries[]; active?: number | null }) {
  // useId's colons don't survive inside url(#…)
  const gradientId = `bar${useId().replace(/[^\w-]/g, '')}`
  if (series.length === 0) return null
  const { group, width } = barGeometry(plot, series.length)
  const bottom = plot.top + plot.height
  return (
    <g>
      {series.map((item, place) => item.gradient && (
        <defs key={item.key}>
          <linearGradient id={`${gradientId}-${place}`} x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} stopColor={item.gradient[0]} />
            <stop offset={1} stopColor={item.gradient[1]} />
          </linearGradient>
        </defs>
      ))}
      {series.map((item, place) => (
        <g key={item.key} data-series={item.key}>
          {item.values.map((value, index) => {
            if (!Number.isFinite(value)) return null
            const x = plot.x(index) - group / 2 + place * (width + BAR_GAP)
            return <path key={index} data-bar-mark d={barPath(x, plot.y(value), width, bottom)} fill={item.gradient ? `url(#${gradientId}-${place})` : item.color} fillOpacity={active === null || active === index ? 1 : 0.4}
              className="transition-[fill-opacity] duration-fast ease-standard motion-reduce:transition-none" />
          })}
        </g>
      ))}
    </g>
  )
}

/** each category's bars stacked bottom to top in the series' order, parted by a hairline; while a category is active the others fade to 40% */
export function StackedBarSeries({ plot, series, active = null }: { plot: Plot; series: DrawnSeries[]; active?: number | null }) {
  if (series.length === 0) return null
  const width = Math.max(4, plot.band * 0.56)
  const starts = series.map((_, place) => series[0].values.map((__, index) => series.slice(0, place).reduce((sum, item) => sum + Math.max(0, item.values[index] || 0), 0)))
  return (
    <g>
      {series.map((item, place) => (
        <g key={item.key} data-series={item.key}>
          {item.values.map((raw, index) => {
            const value = Math.max(0, raw || 0)
            if (value === 0) return null
            const from = starts[place][index]
            const top = plot.y(from + value)
            return <rect key={index} data-bar-mark data-stacked x={plot.x(index) - width / 2} y={top} width={width} height={Math.max(0, plot.y(from) - top)} fill={item.color}
              stroke="var(--color-surface)" strokeWidth={1} fillOpacity={active === null || active === index ? 1 : 0.4} className="transition-[fill-opacity] duration-fast ease-standard motion-reduce:transition-none" />
          })}
        </g>
      ))}
    </g>
  )
}

/** a dashed grey line through a reference such as target pace: drawn over the series, never faded */
export function ReferenceLine({ plot, keyName, values, color }: { plot: Plot; keyName: string; values: number[]; color: string }) {
  if (values.length === 0) return null
  const line = values.length === 1 ? `M${plot.left} ${plot.y(values[0])} H${plot.left + plot.width}` : tracePath(plot, values)
  return <g data-reference={keyName}><path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" /></g>
}
