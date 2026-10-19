/**
 * The rows of tiles, viewing or editing. Editing adds the row bar (its width, Up, Down, Remove), the tile controls (Left,
 * Right, Remove, the title as an input) and Add Row; the viewer skips empty rows.
 */
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, X } from 'lucide-react'

import { Select } from '@/components/Form'
import type { DashboardLayout, DrillStep, Period, ResultColumn, RowWidth, SlicerSelection } from '../types'
import { addRow, capacity, filled, moveRow, moveTile, removeRow, removeTile, rowGridClass, setRowWidth, updateTile, WIDTHS } from './layout'
import { TileCard, type TileLoader } from './TileCard'

interface Editing {
  onChange: (layout: DashboardLayout) => void
  onAddTile: () => void
}

const icon = 'inline-flex h-6 w-6 items-center justify-center rounded-control-sm text-ink-700 hover:bg-surface-hover hover:text-ink-900 disabled:opacity-40 disabled:hover:bg-transparent'

export function DashboardBody({ layout, period, compare, load, keyPrefix, editing, selection, onPick, drills, onDrill }: {
  layout: DashboardLayout; period: Period; compare: boolean; load: TileLoader; keyPrefix: readonly unknown[]; editing?: Editing
  /** the slicers' picked values (viewing) */
  selection?: SlicerSelection
  /** a dimension value clicked on a tile (viewing): the cross-filter */
  onPick?: (column: ResultColumn, value: unknown) => void
  /** the tiles' drills, held by the page (viewing): a tile in Drill Down has an entry, its path */
  drills?: Record<string, DrillStep[]>
  onDrill?: (tileId: string, path: DrillStep[] | null) => void
}) {
  const rows = editing ? layout.rows : filled(layout).rows
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          {editing && (
            <div className="flex items-center gap-2 text-xs text-ink-700">
              <span>Row {index + 1}</span>
              <span className="w-40"><Select aria-label={`Row ${index + 1} width`} controlSize="sm" value={row.width} onChange={(event) => editing.onChange(setRowWidth(layout, index, event.target.value as RowWidth))}>
                {WIDTHS.map((width) => <option key={width.value} value={width.value}>{width.label}</option>)}
              </Select></span>
              <span className="ml-auto flex items-center gap-0.5">
                <button type="button" aria-label={`Move row ${index + 1} up`} className={icon} disabled={index === 0} onClick={() => editing.onChange(moveRow(layout, index, -1))}><ArrowUp size={14} strokeWidth={1.5} aria-hidden /></button>
                <button type="button" aria-label={`Move row ${index + 1} down`} className={icon} disabled={index === rows.length - 1} onClick={() => editing.onChange(moveRow(layout, index, 1))}><ArrowDown size={14} strokeWidth={1.5} aria-hidden /></button>
                <button type="button" aria-label={`Remove row ${index + 1}`} className={icon} onClick={() => editing.onChange(removeRow(layout, index))}><X size={14} strokeWidth={1.5} aria-hidden /></button>
              </span>
            </div>
          )}
          <div className={`grid gap-3 ${rowGridClass(row.width)}`}>
            {row.tiles.map((tile, at) => (
              <TileCard key={tile.id} tile={tile} period={period} compare={compare} load={load} keyPrefix={keyPrefix} selection={selection} slicers={layout.slicers} onPick={editing ? undefined : onPick}
                drillState={!editing && drills && onDrill ? { on: tile.id in drills, path: drills[tile.id] ?? [], set: (next) => onDrill(tile.id, next.on ? next.path : null) } : undefined}
                onTitle={editing ? (title) => editing.onChange(updateTile(layout, tile.id, { title: title || undefined })) : undefined}
                controls={editing ? (
                  <span className="flex items-center gap-0.5">
                    <button type="button" aria-label={`Move ${tile.title || tile.id} left`} className={icon} disabled={at === 0} onClick={() => editing.onChange(moveTile(layout, tile.id, -1))}><ArrowLeft size={14} strokeWidth={1.5} aria-hidden /></button>
                    <button type="button" aria-label={`Move ${tile.title || tile.id} right`} className={icon} disabled={at === row.tiles.length - 1} onClick={() => editing.onChange(moveTile(layout, tile.id, 1))}><ArrowRight size={14} strokeWidth={1.5} aria-hidden /></button>
                    <button type="button" aria-label={`Remove ${tile.title || tile.id}`} className={icon} onClick={() => editing.onChange(removeTile(layout, tile.id))}><X size={14} strokeWidth={1.5} aria-hidden /></button>
                  </span>
                ) : undefined} />
            ))}
            {editing && row.tiles.length < capacity(row.width) && (
              <button type="button" onClick={editing.onAddTile} className="flex min-h-28 items-center justify-center gap-1.5 rounded-md border border-dashed border-line-control text-sm font-semibold text-ink-800 hover:bg-surface-hover">
                <Plus size={16} strokeWidth={1.5} aria-hidden />Add Tile
              </button>
            )}
          </div>
        </div>
      ))}
      {editing && (
        <button type="button" onClick={() => editing.onChange(addRow(layout))} className="flex h-10 items-center justify-center gap-1.5 rounded-md border border-dashed border-line-control text-sm font-semibold text-ink-800 hover:bg-surface-hover">
          <Plus size={16} strokeWidth={1.5} aria-hidden />Add Row
        </button>
      )}
    </div>
  )
}
