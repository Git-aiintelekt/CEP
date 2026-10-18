/**
 * A dashboard's layout, pure: rows of tiles with set widths (docs/mockups/insights-dashboards.html, option 2). Every
 * change returns a new layout; nothing overlaps or leaves a gap because a row never holds more tiles than its width.
 * Also the period's bounds for display; the server computes the real ones in the workspace's zone.
 */
import type { CatalogDataset, Dashboard, DashboardLayout, DashboardRow, DashboardSlicer, DashboardTile, Period, PeriodBounds, PeriodPreset, RowWidth, SlicerCandidate, SlicerSelection, TileShow } from '../types'

export const WIDTHS: { value: RowWidth; label: string; capacity: number }[] = [
  { value: '1', label: 'One across', capacity: 1 }, { value: '2', label: 'Two across', capacity: 2 }, { value: '3', label: 'Three across', capacity: 3 },
  { value: '4', label: 'Four across', capacity: 4 }, { value: '2-1', label: 'Wide and narrow', capacity: 2 },
]
export const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: '7d', label: '7 Days' }, { value: '30d', label: '30 Days' }, { value: 'month', label: 'This Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'custom', label: 'Custom' },
]
export const SHOW_LABEL: Record<TileShow, string> = { grid: 'Grid', chart: 'Chart', hierarchy: 'Hierarchy', pivot: 'Pivot', figure: 'Figure' }
export const EMPTY_LAYOUT: DashboardLayout = { rows: [] }

export function capacity(width: RowWidth): number {
  return WIDTHS.find((w) => w.value === width)?.capacity ?? 2
}

/** the row's columns: one to four equal, or two thirds and a third */
export function rowGridClass(width: RowWidth): string {
  switch (width) {
    case '1': return 'grid-cols-1'
    case '2': return 'grid-cols-1 md:grid-cols-2'
    case '3': return 'grid-cols-1 md:grid-cols-3'
    case '4': return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
    default: return 'grid-cols-1 md:grid-cols-[2fr_1fr]'
  }
}

export function tiles(layout: DashboardLayout): DashboardTile[] {
  return layout.rows.flatMap((row) => row.tiles)
}

export function newTileId(layout: DashboardLayout): string {
  const taken = new Set(tiles(layout).map((tile) => tile.id))
  let n = taken.size + 1
  while (taken.has(`t${n}`)) n += 1
  return `t${n}`
}

/** into the last row with room; else a new row: four across for a figure, two across for anything else */
export function addTile(layout: DashboardLayout, tile: Omit<DashboardTile, 'id'>): DashboardLayout {
  const placed: DashboardTile = { ...tile, id: newTileId(layout) }
  const last = layout.rows[layout.rows.length - 1]
  if (last && last.tiles.length < capacity(last.width)) {
    return { rows: [...layout.rows.slice(0, -1), { ...last, tiles: [...last.tiles, placed] }] }
  }
  return { rows: [...layout.rows, { width: tile.show === 'figure' ? '4' : '2', tiles: [placed] }] }
}

export function updateTile(layout: DashboardLayout, id: string, patch: Partial<DashboardTile>): DashboardLayout {
  return { rows: layout.rows.map((row) => ({ ...row, tiles: row.tiles.map((tile) => (tile.id === id ? { ...tile, ...patch } : tile)) })) }
}

/** the tile goes; a row left empty goes with it */
export function removeTile(layout: DashboardLayout, id: string): DashboardLayout {
  return { rows: layout.rows.map((row) => ({ ...row, tiles: row.tiles.filter((tile) => tile.id !== id) })).filter((row) => row.tiles.length > 0) }
}

export function moveTile(layout: DashboardLayout, id: string, by: -1 | 1): DashboardLayout {
  return {
    rows: layout.rows.map((row) => {
      const at = row.tiles.findIndex((tile) => tile.id === id)
      const to = at + by
      if (at < 0 || to < 0 || to >= row.tiles.length) return row
      const next = [...row.tiles]
      ;[next[at], next[to]] = [next[to], next[at]]
      return { ...row, tiles: next }
    }),
  }
}

export function addRow(layout: DashboardLayout, width: RowWidth = '2'): DashboardLayout {
  return { rows: [...layout.rows, { width, tiles: [] }] }
}

export function removeRow(layout: DashboardLayout, index: number): DashboardLayout {
  return { rows: layout.rows.filter((_, i) => i !== index) }
}

export function moveRow(layout: DashboardLayout, index: number, by: -1 | 1): DashboardLayout {
  const to = index + by
  if (to < 0 || to >= layout.rows.length) return layout
  const rows = [...layout.rows]
  ;[rows[index], rows[to]] = [rows[to], rows[index]]
  return { rows }
}

/** a narrower row keeps what fits; the tiles beyond its width move to a new row after it */
export function setRowWidth(layout: DashboardLayout, index: number, width: RowWidth): DashboardLayout {
  const row = layout.rows[index]
  if (!row) return layout
  const keep = row.tiles.slice(0, capacity(width))
  const overflow = row.tiles.slice(capacity(width))
  const rows: DashboardRow[] = [...layout.rows.slice(0, index), { width, tiles: keep }, ...(overflow.length ? [{ width: row.width, tiles: overflow }] : []), ...layout.rows.slice(index + 1)]
  return { rows }
}

/** rows without a tile, which the server keeps but a viewer need not see */
export function filled(layout: DashboardLayout): DashboardLayout {
  return { ...layout, rows: layout.rows.filter((row) => row.tiles.length > 0) }
}

// ---------------------------------------------------------------------------------------------------- slicers

export const MAX_SLICERS = 6
const SLICER_TYPES = ['string', 'boolean', 'number']

export function setSlicers(layout: DashboardLayout, slicers: DashboardSlicer[]): DashboardLayout {
  return slicers.length ? { ...layout, slicers } : (({ slicers: _gone, ...rest }) => rest)(layout)
}

/** the dimensions the tiles' reports' datasets offer as slicers: text, yes/no or number, with the datasets each is in */
export function slicerCandidates(layout: DashboardLayout, datasetOf: (reportId: string) => string | undefined, datasets: CatalogDataset[]): SlicerCandidate[] {
  const keys = new Set(tiles(layout).map((tile) => datasetOf(tile.report_id)).filter((key): key is string => Boolean(key)))
  const out = new Map<string, SlicerCandidate>()
  for (const dataset of datasets.filter((item) => keys.has(item.key))) {
    for (const field of dataset.fields) {
      if (field.role !== 'dimension' || !SLICER_TYPES.includes(field.type)) continue
      const found = out.get(field.key)
      if (found) found.datasets.push(dataset.label)
      else out.set(field.key, { field: field.key, label: field.label, datasets: [dataset.label] })
    }
  }
  return [...out.values()].sort((a, b) => b.datasets.length - a.datasets.length || a.label.localeCompare(b.label))
}

/** the chip's words: the field, then what is picked */
export function slicerWords(slicer: DashboardSlicer, values: unknown[] | undefined): string {
  if (!values || values.length === 0) return slicer.label
  if (values.length === 1) return `${slicer.label}: ${valueWords(values[0])}`
  return `${slicer.label}: ${values.length} values`
}

export function valueWords(value: unknown): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return String(value)
}

/** a click on a value: that value alone, or nothing when it was already the only one picked */
export function toggleValue(selection: SlicerSelection, field: string, value: unknown): SlicerSelection {
  const now = selection[field] ?? []
  const only = now.length === 1 && String(now[0]) === String(value)
  return { ...selection, [field]: only ? [] : [value] }
}

/** a value a click can cross-filter by: a text, yes/no or number dimension; a date is the period's business */
export function crossFilterable(column: { bucket?: string; type: string; aggregate?: string }, value: unknown): boolean {
  return !column.aggregate && !column.bucket && column.type !== 'date' && column.type !== 'datetime' && value !== null && value !== undefined
}

/** the slicers with a value picked, as the tile run sends them */
export function activeSlicers(selection: SlicerSelection): SlicerSelection {
  return Object.fromEntries(Object.entries(selection).filter(([, values]) => values.length > 0))
}

// ---------------------------------------------------------------------------------------------------- the period

const day = (date: Date) => date.toISOString().slice(0, 10)
const shift = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000)

/** for display while the period is unsaved; the server's bounds (in the workspace's zone) win once a tile has run */
export function periodBounds(period: Period, today = new Date()): PeriodBounds {
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  let start = end
  switch (period.preset) {
    case '7d': start = shift(end, -6); break
    case '30d': start = shift(end, -29); break
    case 'month': start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)); break
    case 'quarter': start = new Date(Date.UTC(end.getUTCFullYear(), Math.floor(end.getUTCMonth() / 3) * 3, 1)); break
    default: {
      const from = period.from ? new Date(`${period.from}T00:00:00Z`) : end
      const to = period.to ? new Date(`${period.to}T00:00:00Z`) : end
      const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
      return { from: day(from), to: day(to), previous_from: day(shift(from, -days)), previous_to: day(shift(from, -1)) }
    }
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return { from: day(start), to: day(end), previous_from: day(shift(start, -days)), previous_to: day(shift(start, -1)) }
}

const short = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const long = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "16 Sep – 15 Oct 2026" */
export function periodWords(bounds: PeriodBounds): string {
  const from = new Date(`${bounds.from}T00:00:00Z`)
  const to = new Date(`${bounds.to}T00:00:00Z`)
  return `${from.getUTCFullYear() === to.getUTCFullYear() ? short.format(from) : long.format(from)} – ${long.format(to)}`
}

export function dashboardPeriod(dashboard: Pick<Dashboard, 'period' | 'compare'>): { period: Period; compare: boolean } {
  return { period: dashboard.period, compare: dashboard.compare }
}
