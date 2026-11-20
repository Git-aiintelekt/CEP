/**
 * A dashboard page, viewing or editing. Viewing: rows of tiles (a dashboard saved before tile sizes), or tiles placed on a canvas
 * (CanvasBody), which is how a grid is saved too. Editing: a grid of sized tiles (GridBody; rows open as one), or a free canvas
 * with each tile's grip and handle. A tile is a report's (TileCard), words (a text tile) or a button.
 */
import { MessageSquare, Pencil, Smartphone, X } from 'lucide-react'
import type { ReactNode } from 'react'

import type { DashboardCell, DashboardLayout, DashboardTile, DrillStep, Period, ResultColumn, SlicerSelection } from '../types'
import { CanvasBody } from './CanvasBody'
import { GridBody } from './GridBody'
import { pack, readingOrder, rowsToCells } from './canvas'
import { filled, rowGridClass } from './layout'
import { TileCard, type TileLoader } from './TileCard'
import { ButtonTile, TextTile } from './WordTiles'

interface Editing {
  onChange: (layout: DashboardLayout) => void
  /** the page as a grid of sized tiles; else the free canvas it is (a page of rows always opens as a grid) */
  grid?: boolean
  /** an id no tile on the dashboard has, for a duplicate */
  newId?: () => string
  /** the tile just added: its toolbar shows */
  chosen?: string | null
  /** a tile's report name, naming its controls when it has no title */
  nameOf?: (tile: DashboardTile) => string | undefined
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
    const reportTile = tile.show !== 'text' && tile.show !== 'button'
    // a report tile's ⋯ holds Comment; its count shows once there is a comment
    const talk = !editing && comments && (!reportTile || comments.count(tile.id) > 0) ? (
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
        onTitle={onTitle} controls={all} fill={fill} onComment={!editing && comments ? () => comments.open(tile) : undefined} />
    )
  }
  const editWords = (tile: DashboardTile) => (editing?.onEditTile && (tile.show === 'text' || tile.show === 'button')
    ? <button type="button" aria-label={`Edit ${tile.title || tile.label || 'the text'}`} className={icon} onClick={() => editing.onEditTile?.(tile)}><Pencil size={13} strokeWidth={1.5} aria-hidden /></button>
    : null)

  if (editing && (editing.grid || !layout.canvas)) {
    const cells = layout.canvas ? readingOrder(layout.cells ?? []) : pack(rowsToCells(filled(layout).rows))
    return (
      <GridBody cells={cells} renderTile={(cell) => tileFor(cell, undefined, cell.show !== 'text' && cell.show !== 'button' ? (title) => editing.onChange({ ...layout, rows: [], canvas: true, cells: cells.map((c) => (c.id === cell.id ? { ...c, title: title || undefined } : c)) }) : undefined, true)}
        onChange={(next) => editing.onChange({ ...layout, rows: [], canvas: true, cells: next })} onAdd={editing.onAddTile}
        onEdit={(cell) => editing.onEditTile?.(cell)} newId={editing.newId ?? (() => `t${Date.now()}`)} nameOf={editing.nameOf} chosen={editing.chosen} />
    )
  }
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

  return (
    <div className="flex flex-col gap-3">
      {filled(layout).rows.map((row, index) => (
        <div key={index} className={`grid gap-3 ${rowGridClass(row.width)}`}>
          {row.tiles.map((tile) => <div key={tile.id} className="min-w-0">{tileFor(tile)}</div>)}
        </div>
      ))}
    </div>
  )
}
