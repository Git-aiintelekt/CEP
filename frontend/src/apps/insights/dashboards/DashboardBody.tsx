/**
 * A dashboard page, viewing or editing: rows of tiles, or a free canvas (CanvasBody). Editing rows adds the row bar (its width,
 * Up, Down, Remove), the tile controls (Left, Right, Remove, the title as an input) and Add Row; the viewer skips empty rows.
 * A tile is a report's (TileCard), words (a text tile) or a button.
 */
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, MessageSquare, Pencil, Plus, Smartphone, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Select } from '@/components/Form'
import type { DashboardCell, DashboardLayout, DashboardTile, DrillStep, Period, ResultColumn, RowWidth, SlicerSelection } from '../types'
import { CanvasBody } from './CanvasBody'
import { addRow, capacity, filled, moveRow, moveTile, removeRow, removeTile, rowGridClass, setRowWidth, updateTile, WIDTHS } from './layout'
import { TileCard, type TileLoader } from './TileCard'
import { ButtonTile, TextTile } from './WordTiles'

interface Editing {
  onChange: (layout: DashboardLayout) => void
  onAddTile: () => void
  /** a text tile's words or a button's label and target */
  onEditTile?: (tile: DashboardTile) => void
}

const icon = 'inline-flex h-6 w-6 items-center justify-center rounded-control-sm text-ink-700 hover:bg-surface-hover hover:text-ink-900 disabled:opacity-40 disabled:hover:bg-transparent'

export function DashboardBody({ layout, period, compare, load, keyPrefix, editing, selection, onPick, drills, onDrill, onAction, phone = false, comments }: {
  layout: DashboardLayout; period: Period; compare: boolean; load: TileLoader; keyPrefix: readonly unknown[]; editing?: Editing
  /** the slicers' picked values (viewing) */
  selection?: SlicerSelection
  /** a dimension value clicked on a tile (viewing): the cross-filter */
  onPick?: (column: ResultColumn, value: unknown) => void
  /** the tiles' drills, held by the page (viewing): a tile in Drill Down has an entry, its path */
  drills?: Record<string, DrillStep[]>
  onDrill?: (tileId: string, path: DrillStep[] | null) => void
  /** a button tile pressed (viewing) */
  onAction?: (action: NonNullable<DashboardTile['action']>) => void
  /** the canvas as a phone shows it */
  phone?: boolean
  /** the comments on each tile, and opening them (viewing) */
  comments?: { count: (tileId: string) => number; open: (tile: DashboardTile) => void }
}) {
  const tileFor = (tile: DashboardTile, controls?: ReactNode, onTitle?: (title: string) => void, fill = false) => {
    const talk = !editing && comments ? (
      <button type="button" aria-label={`Comments on ${tile.title || tile.label || 'this tile'}${comments.count(tile.id) ? `, ${comments.count(tile.id)}` : ''}`} onClick={() => comments.open(tile)}
        className="inline-flex h-6 items-center gap-1 rounded-control-sm px-1.5 text-xs font-semibold text-ink-800 hover:bg-surface-hover">
        <MessageSquare size={13} strokeWidth={1.5} aria-hidden />{comments.count(tile.id) || ''}
      </button>
    ) : null
    const all = controls || talk ? <span className="flex items-center gap-0.5">{talk}{controls}</span> : undefined
    if (tile.show === 'text') return <TextTile tile={tile} controls={all} />
    if (tile.show === 'button') return <ButtonTile tile={tile} onAction={editing ? undefined : onAction} controls={all} />
    return (
      <TileCard tile={tile} period={period} compare={compare} load={load} keyPrefix={keyPrefix} selection={selection} slicers={layout.slicers} onPick={editing ? undefined : onPick}
        drillState={!editing && drills && onDrill ? { on: tile.id in drills, path: drills[tile.id] ?? [], set: (next) => onDrill(tile.id, next.on ? next.path : null) } : undefined}
        onTitle={onTitle} controls={all} fill={fill} />
    )
  }
  const editWords = (tile: DashboardTile) => (editing?.onEditTile && (tile.show === 'text' || tile.show === 'button')
    ? <button type="button" aria-label={`Edit ${tile.title || tile.label || 'the text'}`} className={icon} onClick={() => editing.onEditTile?.(tile)}><Pencil size={13} strokeWidth={1.5} aria-hidden /></button>
    : null)

  if (layout.canvas) {
    const cells = layout.cells ?? []
    const setCells = (next: DashboardCell[]) => editing?.onChange({ ...layout, cells: next })
    return (
      <CanvasBody cells={cells} phone={phone}
        renderTile={(cell, controls) => tileFor(cell, controls, editing && cell.show !== 'text' && cell.show !== 'button' ? (title) => setCells(cells.map((c) => (c.id === cell.id ? { ...c, title: title || undefined } : c))) : undefined, true)}
        editing={editing ? {
          onChange: setCells,
          controlsFor: (cell) => (
            <>
              {editWords(cell)}
              <button type="button" aria-pressed={Boolean(cell.hide_on_phone)} aria-label={`Hide ${cell.title || cell.label || cell.id} on a phone`} title="Hide on Phone"
                className={`${icon} ${cell.hide_on_phone ? 'bg-brand-100 text-brand-800' : ''}`} onClick={() => setCells(cells.map((c) => (c.id === cell.id ? { ...c, hide_on_phone: !c.hide_on_phone || undefined } : c)))}>
                <Smartphone size={13} strokeWidth={1.5} aria-hidden />
              </button>
              <button type="button" aria-label={`Remove ${cell.title || cell.label || cell.id}`} className={icon} onClick={() => setCells(cells.filter((c) => c.id !== cell.id))}><X size={14} strokeWidth={1.5} aria-hidden /></button>
            </>
          ),
        } : undefined} />
    )
  }

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
              <div key={tile.id} className="min-w-0">
                {tileFor(tile, editing ? (
                  <>
                    {editWords(tile)}
                    <button type="button" aria-label={`Move ${tile.title || tile.id} left`} className={icon} disabled={at === 0} onClick={() => editing.onChange(moveTile(layout, tile.id, -1))}><ArrowLeft size={14} strokeWidth={1.5} aria-hidden /></button>
                    <button type="button" aria-label={`Move ${tile.title || tile.id} right`} className={icon} disabled={at === row.tiles.length - 1} onClick={() => editing.onChange(moveTile(layout, tile.id, 1))}><ArrowRight size={14} strokeWidth={1.5} aria-hidden /></button>
                    <button type="button" aria-label={`Remove ${tile.title || tile.id}`} className={icon} onClick={() => editing.onChange(removeTile(layout, tile.id))}><X size={14} strokeWidth={1.5} aria-hidden /></button>
                  </>
                ) : undefined, editing && tile.show !== 'text' && tile.show !== 'button' ? (title) => editing.onChange(updateTile(layout, tile.id, { title: title || undefined })) : undefined)}
              </div>
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
