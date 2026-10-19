/**
 * A chart's signals, worked out in the browser from the rows it shows (view.signals): a forecast line that carries the
 * first series' straight-line trend a few periods ahead, and flags on the points that sit far off that trend. Both need a
 * date along the bottom with a bucket (Sent by Month); a forecast needs four points, the flags six.
 */
import type { Bucket, ChartKind, ReportView } from '../types'

export const HORIZON = 3
export const WINDOW = 24
/** how many typical swings from the trend make a point unusual */
export const THRESHOLD = 2.5
export const MIN_FORECAST = 4
export const MIN_FLAGS = 6

/** a forecast and anomaly flags read a trend: bars, lines or an area */
const SIGNAL_KINDS: ChartKind[] = ['bar', 'line', 'area']
export const signalsApply = (view: ReportView) => view.type === 'chart' && SIGNAL_KINDS.includes(view.chart ?? 'bar')

export function linearFit(values: number[]): { slope: number; intercept: number } {
  const n = values.length
  const meanX = (n - 1) / 2
  const meanY = values.reduce((sum, value) => sum + value, 0) / (n || 1)
  let top = 0
  let bottom = 0
  values.forEach((value, x) => { top += (x - meanX) * (value - meanY); bottom += (x - meanX) ** 2 })
  const slope = bottom ? top / bottom : 0
  return { slope, intercept: meanY - slope * meanX }
}

/** the values with the trend carried `horizon` steps on: NaN under the past, the last real value where the line starts, then the trend */
export function forecast(values: number[], horizon = HORIZON, window = WINDOW): number[] {
  const recent = values.slice(-window)
  const { slope, intercept } = linearFit(recent)
  const floor = values.every((value) => value >= 0) ? 0 : -Infinity
  const out = values.map((_, index) => (index === values.length - 1 ? values[index] : NaN))
  for (let step = 1; step <= horizon; step += 1) out.push(Math.max(floor, intercept + slope * (recent.length - 1 + step)))
  return out
}

/** the points further from the trend than THRESHOLD times the typical swing (the median distance, scaled to a standard deviation) */
export function anomalies(values: number[], threshold = THRESHOLD): { index: number; ratio: number; above: boolean }[] {
  if (values.length < MIN_FLAGS) return []
  const { slope, intercept } = linearFit(values)
  const residuals = values.map((value, x) => value - (intercept + slope * x))
  const sorted = residuals.map(Math.abs).sort((a, b) => a - b)
  const middle = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const swing = middle * 1.4826
  if (!swing) return []
  return residuals.flatMap((residual, index) => (Math.abs(residual) / swing > threshold ? [{ index, ratio: Math.abs(residual) / swing, above: residual > 0 }] : []))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** the next `n` buckets after an ISO date: 2026-09-01 by month gives 2026-10-01, 2026-11-01, ... */
export function nextDates(last: string, bucket: Bucket, n = HORIZON): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(last)
  if (!match) return []
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const out: string[] = []
  for (let step = 1; step <= n; step += 1) {
    if (bucket === 'day' || bucket === 'week') {
      const date = new Date(Date.UTC(year, month - 1, day + step * (bucket === 'week' ? 7 : 1)))
      out.push(`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`)
    } else {
      const months = (bucket === 'month' ? 1 : bucket === 'quarter' || bucket === 'fiscal_quarter' ? 3 : 12) * step
      const index = year * 12 + month - 1 + months
      out.push(`${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`)
    }
  }
  return out
}

/** "3.1 times the usual swing above the trend" */
export function flagWords(flag: { ratio: number; above: boolean }): string {
  return `${flag.ratio.toFixed(1)} times the usual swing ${flag.above ? 'above' : 'below'} the trend`
}
