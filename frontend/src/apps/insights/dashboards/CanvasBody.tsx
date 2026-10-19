/**
 * A dashboard page laid out as a free canvas: each tile at its column, row, width and height on a 12-column grid (rows of 72px),
 * overlapping where they are placed so. Editing gives each tile a grip to move it and a handle to resize it, by dragging or with
 * the arrow keys (Shift with the arrows on the grip resizes too). Narrower than 720px, or in the phone preview, the tiles stack
 * top to bottom and the ones marked Hide on Phone are left out.
 */
import { GripVertical, MoveDiagonal2 } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import type { DashboardCell } from '../types'
import { useBoxWidth } from '../visuals/useBoxWidth'
import { COLUMNS, phoneOrder, ROW_PX, setBox } from './canvas'

const GAP = 12
const PHONE_WIDTH = 720

type Box = Pick<DashboardCell, 'x' | 'y' | 'w' | 'h'>

export function CanvasBody({ cells, renderTile, editing, phone = false }: {
  cells: DashboardCell[]
  /** the tile's own card, given its editing controls (when editing) */
  renderTile: (cell: DashboardCell, controls?: ReactNode) => ReactNode
  editing?: { onChange: (cells: DashboardCell[]) => void; controlsFor: (cell: DashboardCell) => ReactNode }
  /** the phone preview */
  phone?: boolean
}) {
  const [box, width] = useBoxWidth(1200)                // not measured yet: laid out as on a wide screen
  const [moving, setMoving] = useState<{ id: string; box: Box } | null>(null)
  const start = useRef<{ id: string; x: number; y: number; box: Box; mode: 'move' | 'size'; now: Box } | null>(null)
  const column = (width - GAP * (COLUMNS - 1)) / COLUMNS
  if (phone || width < PHONE_WIDTH) {
    return (
      <div ref={box} data-canvas="phone" className={`flex flex-col gap-3 ${phone ? 'mx-auto w-[390px] max-w-full rounded-lg border border-line p-3' : ''}`}>
        {phoneOrder(cells).map((cell) => (
          <div key={cell.id} style={{ minHeight: cell.show === 'button' ? undefined : Math.max(cell.h * ROW_PX, 160) }} className="flex min-w-0 flex-col">
            {renderTile(cell, editing?.controlsFor(cell))}
          </div>
        ))}
        {phone && cells.some((cell) => cell.hide_on_phone) && <p className="text-xs text-ink-700">{cells.filter((cell) => cell.hide_on_phone).length} hidden on a phone.</p>}
      </div>
    )
  }
  const shown = (cell: DashboardCell): Box => (moving?.id === cell.id ? moving.box : cell)
  const rows = Math.max(1, ...cells.map((cell) => { const b = shown(cell); return b.y + b.h })) + (editing ? 2 : 0)

  const begin = (cell: DashboardCell, mode: 'move' | 'size') => (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    const box0 = { x: cell.x, y: cell.y, w: cell.w, h: cell.h }
    start.current = { id: cell.id, x: event.clientX, y: event.clientY, box: box0, mode, now: box0 }
    setMoving({ id: cell.id, box: box0 })
  }
  const drag = (cell: DashboardCell) => (event: PointerEvent<HTMLButtonElement>) => {
    const from = start.current
    if (!from || from.id !== cell.id) return
    const dx = Math.round((event.clientX - from.x) / (column + GAP))
    const dy = Math.round((event.clientY - from.y) / (ROW_PX + GAP))
    const next = from.mode === 'move' ? { ...from.box, x: from.box.x + dx, y: from.box.y + dy } : { ...from.box, w: from.box.w + dx, h: from.box.h + dy }
    const fitted = setBox([{ ...cell, ...next }], cell.id, next)[0]
    from.now = { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }
    setMoving({ id: cell.id, box: from.now })
  }
  const end = (cell: DashboardCell) => () => {
    const from = start.current
    if (from?.id === cell.id && editing && (from.now.x !== from.box.x || from.now.y !== from.box.y || from.now.w !== from.box.w || from.now.h !== from.box.h)) editing.onChange(setBox(cells, cell.id, from.now))
    start.current = null
    setMoving(null)
  }
  const keys = (cell: DashboardCell, mode: 'move' | 'size') => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!step || !editing) return
    event.preventDefault()
    const sizing = mode === 'size' || event.shiftKey
    editing.onChange(setBox(cells, cell.id, sizing ? { w: cell.w + step[0], h: cell.h + step[1] } : { x: cell.x + step[0], y: cell.y + step[1] }))
  }
  const name = (cell: DashboardCell) => cell.title || cell.label || (cell.show === 'text' ? 'text tile' : cell.id)
  const handle = 'inline-flex h-7 w-7 touch-none select-none items-center justify-center rounded-control-sm border border-line bg-surface text-ink-800 shadow-menu hover:bg-surface-hover focus-visible:shadow-focus focus-visible:outline-none'

  return (
    <div ref={box} data-canvas="grid" className="relative grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gridAutoRows: `${ROW_PX}px`, gap: GAP, minHeight: rows * (ROW_PX + GAP) }}>
      {editing && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gap: GAP }}>
          {Array.from({ length: COLUMNS }, (_, i) => <div key={i} className="rounded-sm bg-fill-subtle/50" />)}
        </div>
      )}
      {cells.map((cell, index) => {
        const b = shown(cell)
        return (
          <div key={cell.id} data-cell={cell.id} className={`relative min-w-0 ${moving?.id === cell.id ? 'z-20 opacity-90' : ''}`}
            style={{ gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / span ${b.h}`, zIndex: moving?.id === cell.id ? 20 : index + 1 }}>
            <div className="h-full overflow-hidden">{renderTile(cell, editing?.controlsFor(cell))}</div>
            {editing && (
              <>
                <button type="button" aria-label={`Move ${name(cell)}, column ${cell.x + 1}, row ${cell.y + 1}`} className={`${handle} absolute -top-2 -left-2 cursor-move`}
                  onPointerDown={begin(cell, 'move')} onPointerMove={drag(cell)} onPointerUp={end(cell)} onPointerCancel={end(cell)} onKeyDown={keys(cell, 'move')}>
                  <GripVertical size={14} strokeWidth={1.5} aria-hidden />
                </button>
                <button type="button" aria-label={`Resize ${name(cell)}, ${cell.w} columns by ${cell.h} rows`} className={`${handle} absolute -right-2 -bottom-2 cursor-nwse-resize`}
                  onPointerDown={begin(cell, 'size')} onPointerMove={drag(cell)} onPointerUp={end(cell)} onPointerCancel={end(cell)} onKeyDown={keys(cell, 'size')}>
                  <MoveDiagonal2 size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
