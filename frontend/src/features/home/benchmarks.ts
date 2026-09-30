/** Rates at or above `fair` are Fair, at or above `good` Good, anything lower Poor. These move to Settings later. */
export const BENCHMARKS = {
  open: { fair: 20, good: 30 },
  click: { fair: 2, good: 4.5 },
} as const

export type BenchmarkMetric = keyof typeof BENCHMARKS
export type Benchmark = 'Poor' | 'Fair' | 'Good'

export function benchmarkFor(metric: BenchmarkMetric, percent: number): Benchmark {
  const { fair, good } = BENCHMARKS[metric]
  if (percent >= good) return 'Good'
  if (percent >= fair) return 'Fair'
  return 'Poor'
}
