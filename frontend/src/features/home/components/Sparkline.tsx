import { useId } from 'react'

const WIDTH = 300
const HEIGHT = 76
const TOP = 8
const BOTTOM = 68

interface SparklineProps {
  values: number[]
  /** the point ringed with a dot: the peak, or the latest */
  mark: 'peak' | 'last'
  /** a dashed level to read the line against, in the values' units */
  level?: number | null
}

/**
 * A hero card's trend, in the card's text colour (currentColor): a 2px line over a fading area. Decoration only: the
 * hero states its figures in words and Marketing Performance has the full chart with its numbers.
 */
export function Sparkline({ values, mark, level = null }: SparklineProps) {
  const id = `spark${useId().replace(/[^\w-]/g, '')}`
  if (values.length === 0) return <div aria-hidden className="h-full" />
  const top = Math.max(...values, level ?? 0) || 1
  const x = (index: number) => (values.length === 1 ? WIDTH / 2 : (index / (values.length - 1)) * WIDTH)
  const y = (value: number) => BOTTOM - (value / top) * (BOTTOM - TOP)
  const line = values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const at = mark === 'last' ? values.length - 1 : values.indexOf(Math.max(...values))
  return (
    <div aria-hidden data-sparkline className="relative h-full w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block h-full w-full overflow-visible">
        <defs>
          <linearGradient id={id} x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} stopColor="currentColor" stopOpacity={0.4} />
            <stop offset={1} stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        {level !== null && level > 0 && <line x1={0} x2={WIDTH} y1={y(level)} y2={y(level)} stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        <path d={`${line} L${x(values.length - 1).toFixed(1)},${HEIGHT} L${x(0).toFixed(1)},${HEIGHT} Z`} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* in HTML so the stretched viewBox can't squash it into an oval */}
      <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current bg-surface"
        style={{ left: `${(x(at) / WIDTH) * 100}%`, top: `${(y(values[at]) / HEIGHT) * 100}%` }} />
    </div>
  )
}
