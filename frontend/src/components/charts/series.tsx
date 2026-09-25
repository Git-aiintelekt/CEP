/** What the chart frame draws its series with: lines (optionally with an area under them) and grouped bars. */

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
const RADIUS = 2

/** a bar with its top corners rounded 2px, standing on the axis */
function barPath(x: number, y: number, width: number, bottom: number): string {
  const r = Math.min(RADIUS, width / 2, bottom - y)
  if (r <= 0) return `M${x} ${bottom}H${x + width}V${y}H${x}Z`
  return `M${x} ${bottom}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${bottom}Z`
}

/** each category's bars side by side, 4px apart, the group taking about 70% of its band */
export function BarSeries({ plot, series }: { plot: Plot; series: DrawnSeries[] }) {
  if (series.length === 0) return null
  const group = Math.max(series.length * 2, plot.band * 0.7)
  const width = Math.max(2, (group - BAR_GAP * (series.length - 1)) / series.length)
  const bottom = plot.top + plot.height
  return (
    <g>
      {series.map((item, place) => (
        <g key={item.key} data-series={item.key}>
          {item.values.map((value, index) => {
            const x = plot.x(index) - group / 2 + place * (width + BAR_GAP)
            return <path key={index} d={barPath(x, plot.y(value), width, bottom)} fill={item.color} />
          })}
        </g>
      ))}
    </g>
  )
}
