/**
 * A dashboard page edited as a grid (docs/mockups/dashboards.html, phase D5): the page as it will look, a faint four-column
 * guide behind it, the tiles flowing left to right in their order. Hovering or focusing a tile shows its toolbar: the grip to
 * drag it to another place in the order, its size (Small to Full Width, Tall, Move Earlier / Later, Hide on a Phone), edit for
 * words and buttons, duplicate and remove. A dashed box where the next tile goes opens Add. Narrower than 720px the tiles stack.
 */
import { Check, ChevronDown, Copy, GripVertical, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useState, type DragEvent, type ReactNode } from 'react'

import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import type { DashboardCell } from '../types'
import { useBoxWidth } from '../visuals/useBoxWidth'
import { COLUMNS, duplicateCell, isTall, moveTo, nextPlace, pack, ROW_PX, setSize, setTall, SIZES, sizeOf } from './canvas'

const GAP = 12
const STACK_BELOW = 720
const NEXT_W = 6
const tool = 'inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-800 hover:bg-surface-hover focus-visible:shadow-focus focus-visible:outline-none'
const ICON = { size: 14, strokeWidth: 1.5, 'aria-hidden': true } as const

function SizeMenu({ cell, name, index, count, onSize, onTall, onMove, onPhone }: {
  cell: DashboardCell; name: string; index: number; count: number
  onSize: (w: number) => void; onTall: (tall: boolean) => void; onMove: (to: number) => void; onPhone: () => void
}) {
  const menus = useSingleDropdown<'size'>()
  const size = sizeOf(cell)
  const pick = (go: () => void) => { menus.close(); go() }
  const tick = (on: boolean) => <span className="inline-flex w-4 justify-center">{on && <Check {...ICON} className="text-brand-600" />}</span>
  return (
    <span className="relative inline-flex">
      <button type="button" {...menus.triggerProps('size')} aria-haspopup="menu" aria-label={`Size of ${name}: ${size.label}${isTall(cell) ? ', Tall' : ''}`}
        className="inline-flex h-7 items-center gap-1 rounded-full pr-1.5 pl-2.5 text-xs font-semibold text-ink-900 hover:bg-surface-hover focus-visible:shadow-focus focus-visible:outline-none">
        {size.label}{isTall(cell) ? ' · Tall' : ''}<ChevronDown {...ICON} />
      </button>
      {menus.isOpen('size') && (
        <Popover {...menus.panelProps('size')} label={`Size of ${name}`} placement="bottom-end" width={232}>
          <div role="menu" aria-label={`Size of ${name}`} className="py-1">
            {SIZES.map((option) => (
              <MenuRow key={option.w} role="menuitemradio" aria-checked={option.w === size.w} divider={false} leading={tick(option.w === size.w)}
                title={option.label} trailing={option.part ? <span className="text-xs text-ink-800">{option.part}</span> : undefined} onClick={() => pick(() => onSize(option.w))} />
            ))}
            <div className="my-1 border-t border-line-subtle" />
            <MenuRow role="menuitemcheckbox" aria-checked={isTall(cell)} divider={false} leading={tick(isTall(cell))} title="Tall" trailing={<span className="text-xs text-ink-800">Two rows high</span>} onClick={() => pick(() => onTall(!isTall(cell)))} />
            <MenuRow role="menuitemcheckbox" aria-checked={Boolean(cell.hide_on_phone)} divider={false} leading={tick(Boolean(cell.hide_on_phone))} title="Hide on a Phone" onClick={() => pick(onPhone)} />
            <div className="my-1 border-t border-line-subtle" />
            <MenuRow role="menuitem" divider={false} leading={<span className="w-4" />} title="Move Earlier" disabled={index === 0} onClick={() => pick(() => onMove(index - 1))} />
            <MenuRow role="menuitem" divider={false} leading={<span className="w-4" />} title="Move Later" disabled={index === count - 1} onClick={() => pick(() => onMove(index + 1))} />
          </div>
        </Popover>
      )}
    </span>
  )
}

export function GridBody({ cells, renderTile, onChange, onAdd, onEdit, newId, nameOf, chosen }: {
  /** in their order: flowing them gives their places */
  cells: DashboardCell[]
  renderTile: (cell: DashboardCell) => ReactNode
  onChange: (cells: DashboardCell[]) => void
  onAdd: () => void
  /** a text tile's words or a button's label and target */
  onEdit: (cell: DashboardCell) => void
  /** an id no tile on the dashboard has */
  newId: () => string
  /** a tile's report name, for a tile with no title of its own */
  nameOf?: (cell: DashboardCell) => string | undefined
  /** the tile just added: its toolbar shows and it is scrolled into view */
  chosen?: string | null
}) {
  const [box, width] = useBoxWidth(1200)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const name = (cell: DashboardCell) => cell.title || cell.label || nameOf?.(cell) || `Tile ${cells.indexOf(cell) + 1}`
  const stacked = width < STACK_BELOW
  useEffect(() => {
    if (chosen) document.querySelector(`[data-cell="${chosen}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [chosen])
  const next = nextPlace(cells, NEXT_W)
  const rows = Math.max(...cells.map((cell) => cell.y + cell.h), next.y + 2)

  const drop = (target: DashboardCell) => (event: DragEvent) => {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/x-tile') || dragging
    setDragging(null); setOver(null)
    if (!id || id === target.id) return
    onChange(moveTo(cells, id, cells.findIndex((cell) => cell.id === target.id)))
  }

  return (
    <div ref={box} data-canvas="grid-flow" className={stacked ? 'flex flex-col gap-3' : 'relative grid'}
      style={stacked ? undefined : { gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gridAutoRows: `${ROW_PX}px`, gap: GAP, minHeight: rows * (ROW_PX + GAP) }}>
      {!stacked && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-4" style={{ gap: GAP }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="rounded-sm border-x border-dashed border-line-subtle" />)}
        </div>
      )}
      {cells.map((cell, index) => {
        const words = cell.show === 'text' || cell.show === 'button'
        return (
          <div key={cell.id} data-cell={cell.id}
            onDragOver={(event) => { if (dragging) { event.preventDefault(); setOver(cell.id) } }} onDragLeave={() => setOver((now) => (now === cell.id ? null : now))} onDrop={drop(cell)}
            className={`group relative flex min-w-0 flex-col rounded-md ${over === cell.id && dragging !== cell.id ? 'outline-2 outline-offset-2 outline-brand-600 outline-dashed' : ''} ${dragging === cell.id ? 'opacity-60' : ''}`}
            style={stacked ? { minHeight: cell.show === 'button' ? undefined : Math.max(cell.h * ROW_PX, 160) } : { gridColumn: `${cell.x + 1} / span ${cell.w}`, gridRow: `${cell.y + 1} / span ${cell.h}` }}>
            <div className={`min-h-0 flex-1 overflow-hidden rounded-md ring-brand-600 group-focus-within:ring-2 group-hover:ring-1 ${chosen === cell.id ? 'ring-2' : ''}`}>{renderTile(cell)}</div>
            <div role="toolbar" aria-label={`Arrange ${name(cell)}`}
              className={`absolute -top-3.5 right-3 z-10 flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 shadow-menu ${chosen === cell.id ? '' : 'pointer-events-none opacity-0'} transition-opacity duration-fast group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100`}>
              <button type="button" draggable aria-label={`Drag ${name(cell)} to another place`} title="Drag to Move" className={`${tool} cursor-grab`}
                onDragStart={(event) => { event.dataTransfer.setData('text/x-tile', cell.id); event.dataTransfer.effectAllowed = 'move'; setDragging(cell.id) }}
                onDragEnd={() => { setDragging(null); setOver(null) }}>
                <GripVertical {...ICON} />
              </button>
              <SizeMenu cell={cell} name={name(cell)} index={index} count={cells.length}
                onSize={(w) => onChange(setSize(cells, cell.id, w))} onTall={(tall) => onChange(setTall(cells, cell.id, tall))} onMove={(to) => onChange(moveTo(cells, cell.id, to))}
                onPhone={() => onChange(cells.map((c) => (c.id === cell.id ? { ...c, hide_on_phone: !c.hide_on_phone || undefined } : c)))} />
              {words && <button type="button" aria-label={`Edit ${name(cell)}`} title="Edit" className={tool} onClick={() => onEdit(cell)}><Pencil {...ICON} /></button>}
              <button type="button" aria-label={`Duplicate ${name(cell)}`} title="Duplicate" className={tool} onClick={() => onChange(duplicateCell(cells, cell.id, newId()))}><Copy {...ICON} /></button>
              <button type="button" aria-label={`Remove ${name(cell)}`} title="Remove" className={`${tool} hover:text-danger-text`} onClick={() => onChange(pack(cells.filter((c) => c.id !== cell.id)))}><Trash2 {...ICON} /></button>
            </div>
            {cell.hide_on_phone && <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-sm bg-surface-subtle px-1.5 text-xs text-ink-800"><Smartphone size={12} strokeWidth={1.5} aria-hidden />Hidden on a phone</span>}
          </div>
        )
      })}
      <button type="button" onClick={onAdd}
        className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-line-control bg-surface/60 text-sm font-semibold text-brand-600 hover:bg-surface"
        style={stacked ? undefined : { gridColumn: `${next.x + 1} / span ${NEXT_W}`, gridRow: `${next.y + 1} / span 2` }}>
        <Plus size={18} strokeWidth={1.5} aria-hidden />Add a Tile
      </button>
    </div>
  )
}
