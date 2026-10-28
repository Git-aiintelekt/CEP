import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { iconButtonClass } from '@/components/buttonStyles'

/**
 * A report's or a dashboard's ⋯ More actions button and its menu of MenuRows, so the header never runs off the screen.
 * A click outside or Escape closes it, and it scrolls on a short screen. A row calls `act(then)`: the menu closes, then it acts.
 */
export function ActionsMenu({ children }: { children: (act: (then: () => void) => void) => ReactNode }) {
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
  const act = (then: () => void) => { setOpen(false); then() }
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="More actions" onClick={() => setOpen((now) => !now)} className={iconButtonClass({ pressed: open })}>
        <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="More actions" className="absolute right-0 z-20 mt-1 max-h-[calc(100dvh-10rem)] w-64 overflow-y-auto rounded-md border border-line bg-surface-overlay shadow-menu">
          {children(act)}
        </div>
      )}
    </div>
  )
}

/** a hairline between groups of menu rows */
export function MenuGap() {
  return <div role="separator" className="my-1 border-t border-line-subtle" />
}
