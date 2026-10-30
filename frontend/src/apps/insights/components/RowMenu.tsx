/**
 * The ⋯ on a row of an Insights list (Reports, Dashboards): groups of actions split by hairlines. The menu is fixed to the
 * screen under its button (flipped above when there is no room), so the table's scrolling card never clips it; scrolling or
 * resizing closes it.
 */
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { iconButtonClass } from '@/components/buttonStyles'
import { MenuRow } from '@/components/MenuRow'

export interface RowMenuItem { title: string; icon: ReactNode; tone?: 'default' | 'error'; onSelect: () => void }

const WIDTH = 224
const GAP = 4

/** label names the menu and its button, e.g. “Actions for Marketing Weekly”; a false item is left out, an empty group too */
export function RowMenu({ label, groups }: { label: string; groups: (RowMenuItem | false | null | undefined)[][] }) {
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

  const shown = groups.map((group) => group.filter((item): item is RowMenuItem => Boolean(item))).filter((group) => group.length > 0)

  return (
    <>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => (open ? close(false) : setOpen(true))} className={iconButtonClass({ pressed: open })}>
        <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} onKeyDown={onKeyDown} style={{ width: WIDTH, top: spot?.top ?? 0, left: spot?.left ?? 0, visibility: spot ? 'visible' : 'hidden' }}
          className="fixed z-50 overflow-hidden rounded-md border border-line bg-surface-overlay py-1 text-left shadow-menu animate-popover-in motion-reduce:animate-none">
          {shown.map((group, index) => (
            <div key={index} role="group" className={index > 0 ? 'mt-1 border-t border-line-subtle pt-1' : ''}>
              {group.map((item) => (
                <MenuRow key={item.title} role="menuitem" divider={false} tone={item.tone ?? 'default'} leading={item.icon} title={item.title}
                  onClick={() => { close(false); item.onSelect() }} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
