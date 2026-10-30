/**
 * The parts of the builder (docs/mockups/report-editor-workspace.html): a field's card, and the small popover its
 * menus open. A card shows its grip and its ⋯ (Move Up, Move Down) only in a section of two or more; the grip only
 * on hover. A card can be dragged onto another card of its section to take its place.
 */
import { GripVertical, MoreHorizontal, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'

import { MenuRow } from '@/components/MenuRow'

export const CARD_DRAG = 'text/x-card'

/** a button and the panel it opens under it; a click outside or Escape closes it */
export function Popover({ label, button, className, align = 'end', width = 'w-64', children }: {
  label: string
  button: ReactNode
  className: string
  align?: 'start' | 'end'
  width?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-label={label} aria-haspopup="true" aria-expanded={open} className={className} onClick={() => setOpen((now) => !now)}>{button}</button>
      {open && (
        <div role="region" aria-label={label} className={`absolute z-30 mt-1 max-h-[min(420px,calc(100dvh-12rem))] overflow-y-auto rounded-md border border-line bg-surface-overlay py-1 shadow-menu ${width} ${align === 'end' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

const iconButton = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-700 hover:bg-surface-hover hover:text-ink-900'

export function BuilderCard({ cardKey, label, icon: Icon, control, under, multi, first, last, onMove, onMoveTo, onRemove }: {
  cardKey: string
  label: string
  icon: LucideIcon
  /** the field's chip: its calculation or its date grouping */
  control?: ReactNode
  /** a line under the card's row: its comparisons, its place in a pivot */
  under?: ReactNode
  /** the section has two or more cards */
  multi: boolean
  first: boolean
  last: boolean
  onMove: (by: -1 | 1) => void
  /** another card of the section was dropped here */
  onMoveTo: (dragged: string) => void
  onRemove: () => void
}) {
  const [over, setOver] = useState(false)
  const takes = (event: DragEvent) => multi && event.dataTransfer.types.includes(CARD_DRAG)
  return (
    <li draggable={multi} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(CARD_DRAG, cardKey) }}
      onDragOver={(event) => { if (takes(event)) { event.preventDefault(); event.stopPropagation(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { setOver(false); const dragged = event.dataTransfer.getData(CARD_DRAG); if (multi && dragged) { event.preventDefault(); event.stopPropagation(); if (dragged !== cardKey) onMoveTo(dragged) } }}
      aria-label={label}
      className={`group flex flex-col gap-1.5 rounded-md border px-1.5 py-1.5 transition-colors ${over ? 'border-brand-600 bg-brand-100/40' : 'border-line-subtle bg-surface-subtle'}`}>
      <div className="flex min-h-7 items-center gap-1.5">
        {multi && <GripVertical size={14} strokeWidth={1.5} aria-hidden className="shrink-0 cursor-grab text-ink-300 opacity-0 transition-opacity group-hover:opacity-100" />}
        <Icon size={14} strokeWidth={1.5} aria-hidden className={`shrink-0 text-ink-800 ${multi ? '' : 'ml-1'}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{label}</span>
        {control}
        {multi && (
          <Popover label={`More for ${label}`} button={<MoreHorizontal size={14} strokeWidth={1.5} aria-hidden />} className={iconButton} width="w-44">
            {(close) => (
              <>
                <MenuRow role="menuitem" divider={false} title="Move Up" disabled={first} onClick={() => { if (!first) { onMove(-1); close() } }} />
                <MenuRow role="menuitem" divider={false} title="Move Down" disabled={last} onClick={() => { if (!last) { onMove(1); close() } }} />
              </>
            )}
          </Popover>
        )}
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className={iconButton}><X size={14} strokeWidth={1.5} aria-hidden /></button>
      </div>
      {under}
    </li>
  )
}
