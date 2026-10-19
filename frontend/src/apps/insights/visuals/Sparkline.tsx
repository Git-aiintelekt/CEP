/** A small line of a row's values, no axes: the trend in a pivot's row or under a KPI card. The last point is marked. */
export function Sparkline({ values, width = 80, height = 22, label }: { values: (number | null)[]; width?: number; height?: number; label: string }) {
  const known = values.map((value, index) => ({ value, index })).filter((p): p is { value: number; index: number } => typeof p.value === 'number' && Number.isFinite(p.value))
  if (known.length < 2) return <span className="text-xs text-ink-700" aria-label={label}>—</span>
  const low = Math.min(...known.map((p) => p.value))
  const high = Math.max(...known.map((p) => p.value))
  const x = (index: number) => 2 + ((width - 4) * index) / Math.max(1, values.length - 1)
  const y = (value: number) => 2 + (height - 4) * (1 - (value - low) / (high - low || 1))
  const line = known.map((p, i) => `${i ? 'L' : 'M'}${x(p.index).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  const last = known.at(-1)!
  return (
    <svg data-sparkline width={width} height={height} role="img" aria-label={label} className="inline-block align-middle">
      <path d={line} fill="none" stroke="var(--color-chart-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.index)} cy={y(last.value)} r={2} fill="var(--color-chart-1)" />
    </svg>
  )
}
