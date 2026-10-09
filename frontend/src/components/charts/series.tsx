/** What the chart frame draws its series with: lines (optionally with an area under them) and grouped bars. */
import { useId } from 'react'

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

export function LineSeries({ plot, series, area = false, active }: { plot: Plot; series: DrawnSeries; area?: boolean; active: number | null }) {
  const points = series.values.map((value, index) => [plot.x(index), plot.y(value)] as const)
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const floor = plot.top + plot.height
  return (
    <g data-series={series.key}>
      {area && points.length > 1 && (
        <path d={`${line} L${points.at(-1)![0].toFixed(1)} ${floor} L${points[0][0].toFixed(1)} ${floor} Z`} fill={series.color} fillOpacity={0.12} stroke="none" />
      )}
      {points.length > 1 && <path d={line} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {points.length === 1 && active === null && <circle cx={points[0][0]} cy={points[0][1]} r={3} fill={series.color} />}
      {active !== null && points[active] && <ActiveDot cx={points[active][0]} cy={points[active][1]} color={series.color} />}
    </g>
  )
}

const BAR_GAP = 4

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
  const group = Math.max(series.length * 2, plot.band * 0.78)
  const width = Math.max(2, (group - BAR_GAP * (series.length - 1)) / series.length)
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
            const x = plot.x(index) - group / 2 + place * (width + BAR_GAP)
            return <path key={index} data-bar-mark d={barPath(x, plot.y(value), width, bottom)} fill={item.gradient ? `url(#${gradientId}-${place})` : item.color} fillOpacity={active === null || active === index ? 1 : 0.4}
              className="transition-[fill-opacity] duration-fast ease-standard motion-reduce:transition-none" />
          })}
        </g>
      ))}
    </g>
  )
}

/** a dashed grey line through a reference such as target pace: drawn over the series, never faded */
export function ReferenceLine({ plot, keyName, values, color }: { plot: Plot; keyName: string; values: number[]; color: string }) {
  if (values.length === 0) return null
  const points = values.map((value, index) => `${index ? 'L' : 'M'}${plot.x(index).toFixed(1)} ${plot.y(value).toFixed(1)}`)
  const line = values.length === 1 ? `M${plot.left} ${plot.y(values[0])} H${plot.left + plot.width}` : points.join(' ')
  return <g data-reference={keyName}><path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" /></g>
}
