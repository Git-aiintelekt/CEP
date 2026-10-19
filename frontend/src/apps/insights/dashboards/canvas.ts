/**
 * A free canvas, pure: tiles placed on a 12-column grid by column, row, width and height (rows of 72px). Tiles may overlap; the
 * later one sits on top. Converting rows to a canvas keeps their order and widths; a canvas back to rows reads it top to bottom,
 * up to four tiles a row. On a phone the canvas stacks top to bottom, without the tiles marked Hide on Phone.
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

const WIDTH_OF: Record<number, RowWidth> = { 1: '1', 2: '2', 3: '3', 4: '4' }

export function cellsToRows(cells: DashboardCell[]): DashboardRow[] {
  const ordered = [...cells].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: DashboardRow[] = []
  for (let i = 0; i < ordered.length; i += 4) {
    const tiles = ordered.slice(i, i + 4).map(({ x: _x, y: _y, w: _w, h: _h, ...tile }) => tile)
    rows.push({ width: WIDTH_OF[tiles.length], tiles })
  }
  return rows
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
