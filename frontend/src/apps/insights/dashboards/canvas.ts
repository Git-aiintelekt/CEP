/**
 * A free canvas, pure: tiles placed on a 12-column grid by column, row, width and height (rows of 72px). Tiles may overlap; the
 * later one sits on top. Converting rows to a canvas keeps their order and widths. On a phone the canvas stacks top to bottom,
 * without the tiles marked Hide on Phone.
 */
import type { DashboardCell, DashboardRow, DashboardTile, RowWidth } from '../types'

export const COLUMNS = 12
export const ROW_PX = 72
export const MAX_ROW = 200
export const MAX_HEIGHT = 12

const SPANS: Record<RowWidth, number[]> = { '1': [12], '2': [6, 6], '3': [4, 4, 4], '4': [3, 3, 3, 3], '2-1': [8, 4] }

/** the size a new tile starts at, by what it shows */
export function startSize(show: DashboardTile['show']): { w: number; h: number } {
  if (show === 'figure') return { w: 3, h: 2 }
  if (show === 'button') return { w: 3, h: 1 }
  if (show === 'text') return { w: 4, h: 2 }
  return { w: 6, h: 5 }
}

export function rowsToCells(rows: DashboardRow[]): DashboardCell[] {
  const cells: DashboardCell[] = []
  let y = 0
  for (const row of rows) {
    const spans = SPANS[row.width] ?? SPANS['2']
    let x = 0
    let tallest = 0
    row.tiles.forEach((tile, i) => {
      const w = spans[i] ?? spans[spans.length - 1]
      const { h } = startSize(tile.show)
      cells.push({ ...tile, x, y, w, h })
      x += w
      tallest = Math.max(tallest, h)
    })
    y += tallest
  }
  return cells
}

/** the first row below every tile */
export function bottom(cells: DashboardCell[]): number {
  return cells.reduce((low, cell) => Math.max(low, cell.y + cell.h), 0)
}

export function place(cells: DashboardCell[], tile: DashboardTile): DashboardCell[] {
  const { w, h } = startSize(tile.show)
  return [...cells, { ...tile, x: 0, y: bottom(cells), w, h }]
}

/** a tile moved or resized, kept inside the twelve columns and the rows allowed */
export function setBox(cells: DashboardCell[], id: string, box: Partial<Pick<DashboardCell, 'x' | 'y' | 'w' | 'h'>>): DashboardCell[] {
  return cells.map((cell) => {
    if (cell.id !== id) return cell
    const w = Math.min(COLUMNS, Math.max(1, box.w ?? cell.w))
    const h = Math.min(MAX_HEIGHT, Math.max(1, box.h ?? cell.h))
    const x = Math.min(COLUMNS - w, Math.max(0, box.x ?? cell.x))
    const y = Math.min(MAX_ROW, Math.max(0, box.y ?? cell.y))
    return { ...cell, x, y, w, h }
  })
}

export function phoneOrder(cells: DashboardCell[]): DashboardCell[] {
  return [...cells].filter((cell) => !cell.hide_on_phone).sort((a, b) => a.y - b.y || a.x - b.x)
}

// ---------------------------------------------------------------------------------------------------- grid
// Grid is a canvas whose tiles flow: in order, left to right, a line as tall as its tallest tile, the next line below it. It is
// saved as cells like any canvas; a page whose cells sit where flowing puts them is a grid.

export const SIZES: { w: number; label: string; part: string }[] = [
  { w: 3, label: 'Small', part: '¼' }, { w: 4, label: 'One Third', part: '⅓' }, { w: 6, label: 'Medium', part: '½' },
  { w: 8, label: 'Two Thirds', part: '⅔' }, { w: 9, label: 'Wide', part: '¾' }, { w: 12, label: 'Full Width', part: '' },
]

/** the size nearest a tile's width */
export function sizeOf(cell: Pick<DashboardCell, 'w'>): (typeof SIZES)[number] {
  return SIZES.reduce((best, size) => (Math.abs(size.w - cell.w) < Math.abs(best.w - cell.w) ? size : best), SIZES[0])
}

export function isTall(cell: DashboardCell): boolean {
  return cell.h >= startSize(cell.show).h * 2
}

/** top to bottom, left to right */
export function readingOrder(cells: DashboardCell[]): DashboardCell[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** the cells in the order given, flowed into lines */
export function pack(cells: DashboardCell[]): DashboardCell[] {
  let x = 0
  let y = 0
  let line = 0
  return cells.map((cell) => {
    const w = Math.min(COLUMNS, Math.max(1, cell.w))
    if (x > 0 && x + w > COLUMNS) { y += line; x = 0; line = 0 }
    const placed = { ...cell, x, y, w }
    x += w
    line = Math.max(line, cell.h)
    return placed
  })
}

export function isPacked(cells: DashboardCell[]): boolean {
  const ordered = readingOrder(cells)
  return pack(ordered).every((cell, i) => cell.x === ordered[i].x && cell.y === ordered[i].y && cell.w === ordered[i].w)
}

/** where the next tile of this width goes */
export function nextPlace(cells: DashboardCell[], w: number): { x: number; y: number } {
  const probe = pack([...cells, { id: '_next', report_id: '', show: 'text', x: 0, y: 0, w, h: 2 }])
  const last = probe[probe.length - 1]
  return { x: last.x, y: last.y }
}

export function moveTo(cells: DashboardCell[], id: string, to: number): DashboardCell[] {
  const from = cells.findIndex((cell) => cell.id === id)
  if (from < 0) return cells
  const next = [...cells]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return pack(next)
}

export function setSize(cells: DashboardCell[], id: string, w: number): DashboardCell[] {
  return pack(cells.map((cell) => (cell.id === id ? { ...cell, w } : cell)))
}

export function setTall(cells: DashboardCell[], id: string, tall: boolean): DashboardCell[] {
  return pack(cells.map((cell) => (cell.id === id ? { ...cell, h: Math.min(MAX_HEIGHT, startSize(cell.show).h * (tall ? 2 : 1)) } : cell)))
}

/** a copy of the tile right after it */
export function duplicateCell(cells: DashboardCell[], id: string, newId: string): DashboardCell[] {
  const at = cells.findIndex((cell) => cell.id === id)
  if (at < 0) return cells
  const next = [...cells]
  next.splice(at + 1, 0, { ...cells[at], id: newId })
  return pack(next)
}
