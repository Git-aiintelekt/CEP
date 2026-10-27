/**
 * The ⋯ on a row of Insights → Reports: Open, Edit, Duplicate, Move to Folder, Share, Schedule and Delete, each only for
 * whoever may. The menu is fixed to the screen under its button (flipped above when there is no room), so the table's
 * scrolling card never clips it; scrolling or resizing closes it.
 */
import { CalendarClock, Copy, ExternalLink, FolderInput, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { iconButtonClass } from '@/components/buttonStyles'
import { MenuRow } from '@/components/MenuRow'
import type { ReportSummary } from '../types'

export type RowAction = 'open' | 'edit' | 'duplicate' | 'folder' | 'share' | 'schedule' | 'delete'

const WIDTH = 224
const GAP = 4

/** canShare: the owner or a report administrator (the list does not send can_share; the API checks it again) */
export function ReportRowMenu({ report, canCreate, canShare, scheduled, onAction }: { report: ReportSummary; canCreate: boolean; canShare: boolean; scheduled: boolean; onAction: (action: RowAction) => void }) {
  const [open, setOpen] = useState(false)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const close = (refocus: boolean) => {
    setOpen(false)
    setSpot(null)
    if (refocus) button.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return
    const trigger = button.current.getBoundingClientRect()
    const height = menu.current.offsetHeight
    const below = trigger.bottom + GAP + height <= window.innerHeight
    setSpot({ top: below ? trigger.bottom + GAP : Math.max(GAP, trigger.top - GAP - height), left: Math.max(GAP, trigger.right - WIDTH) })
  }, [open])

  useEffect(() => {
    if (spot) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [spot])

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(false)
    }
    const shut = () => close(false)
    document.addEventListener('pointerdown', away)
    window.addEventListener('scroll', shut, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('scroll', shut, true)
      window.removeEventListener('resize', shut)
    }
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') { event.preventDefault(); close(true) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus() }
    else if (event.key === 'Tab') close(false)
  }

  const pick = (action: RowAction) => {
    close(false)
    onAction(action)
  }
  const item = (action: RowAction, title: string, icon: ReactNode, tone: 'default' | 'error' = 'default') => (
    <MenuRow role="menuitem" divider={false} tone={tone} leading={icon} title={title} onClick={() => pick(action)} />
  )
  const icon = (Icon: typeof Pencil) => <Icon size={16} strokeWidth={1.5} aria-hidden />
  const groups = [
    [item('open', 'Open', icon(ExternalLink)), report.can_edit && item('edit', 'Edit', icon(Pencil)), canCreate && item('duplicate', 'Duplicate', icon(Copy)), report.can_edit && item('folder', 'Move to Folder…', icon(FolderInput))],
    [canShare && item('share', 'Share…', icon(Share2)), canCreate && item('schedule', scheduled ? 'Change Schedule…' : 'Schedule…', icon(CalendarClock))],
    [report.can_edit && item('delete', 'Delete…', <Trash2 size={16} strokeWidth={1.5} aria-hidden className="text-danger-text" />, 'error')],
  ].map((group) => group.filter(Boolean)).filter((group) => group.length > 0)

  return (
    <>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${report.name}`}
        onClick={() => (open ? close(false) : setOpen(true))} className={iconButtonClass({ pressed: open })}>
        <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={`Actions for ${report.name}`} onKeyDown={onKeyDown} style={{ width: WIDTH, top: spot?.top ?? 0, left: spot?.left ?? 0, visibility: spot ? 'visible' : 'hidden' }}
          className="fixed z-50 overflow-hidden rounded-md border border-line bg-surface-overlay py-1 text-left shadow-menu animate-popover-in motion-reduce:animate-none">
          {groups.map((group, index) => (
            <div key={index} role="group" className={index > 0 ? 'mt-1 border-t border-line-subtle pt-1' : ''}>
              {group.map((row, at) => <span key={at} className="contents">{row}</span>)}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
