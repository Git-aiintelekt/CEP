/** The pie's slices, pure: what a PieChart draws from what it is given. */
export interface PieSlice {
  key: string
  label: string
  value: number
}

export const MAX_SLICES = 8
export const OTHER = '__other__'

/** the slices drawn: the given ones, or the eight largest and the rest folded into Other, in the order given */
export function foldSlices(slices: PieSlice[]): PieSlice[] {
  const positive = slices.map((slice) => ({ ...slice, value: Math.max(0, Number(slice.value) || 0) }))
  if (positive.length <= MAX_SLICES + 1) return positive
  const sorted = [...positive].sort((a, b) => b.value - a.value)
  const kept = new Set(sorted.slice(0, MAX_SLICES).map((slice) => slice.key))
  const rest = positive.filter((slice) => !kept.has(slice.key))
  return [...positive.filter((slice) => kept.has(slice.key)), { key: OTHER, label: `Other (${rest.length})`, value: rest.reduce((sum, slice) => sum + slice.value, 0) }]
}
