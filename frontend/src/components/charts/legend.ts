import { useCallback, useState } from 'react'

/** The legend's show / hide state, for a chart whose legend is drawn elsewhere (a card header): pass `hidden` to the Chart and both to ChartLegend. */
export function useChartLegend() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback((key: string) => setHidden((now) => {
    const next = new Set(now)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])
  return { hidden, toggle }
}
