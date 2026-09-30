/** The chart palette, in order: a chart's nth series takes the nth colour unless it names one. */
export const CHART_COLORS = [1, 2, 3, 4, 5, 6].map((index) => `var(--color-chart-${index})`)

/** A series' colour by its place among all the chart's series (hidden ones included): with exactly two, the second is Plum. */
export function seriesColor(index: number, count: number): string {
  if (count === 2 && index === 1) return 'var(--color-chart-pair)'
  return CHART_COLORS[index % CHART_COLORS.length]
}

/** every series with its colour: the one it names, or its place among all the chart's series (a reference line is not one) */
export function colorSeries<T extends { color?: string }>(series: T[]): (T & { color: string })[] {
  return series.map((item, index) => ({ ...item, color: item.color ?? seriesColor(index, series.length) }))
}

/** the reference line's look: dashed Gray 400, never a colour slot */
export const REFERENCE_COLOR = 'var(--color-chart-4)'

/** Round steps (1, 2, 2.5, 5 × 10ⁿ) from 0 up past `max`, about `count` of them; whole steps for whole numbers. */
export function niceTicks(max: number, count = 4, whole = true): number[] {
  if (!(max > 0)) return [0, 1]
  const rough = max / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const scaled = rough / magnitude
  let step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * magnitude
  if (whole) step = Math.max(1, Math.round(step))
  const top = step * Math.ceil(max / step)
  const ticks: number[] = []
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value)
  return ticks
}

/** Which category labels fit along the x axis: every nth, so none overlap. */
export function labelEvery(count: number, room: number, labelWidth = 88): number {
  const fits = Math.max(1, Math.floor(room / labelWidth))
  return Math.max(1, Math.ceil(count / fits))
}
