/** The Build page's right-hand column, docked beside the canvas (no scrim: the canvas stays visible and usable),
 * used for both the Add-a-step picker and a step's panel. A non-modal dialog: focus moves in on open, Escape and ×
 * close it, and focus goes back to whatever opened it. */
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

import { IconButton } from '@/components/Button'

export function SidePanel({ title, subtitle, onClose, children, footer, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea') ?? panel.current?.querySelector<HTMLElement>('button')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // a modal on top, or an open menu, takes Escape first
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (document.querySelector('[aria-haspopup][aria-expanded="true"]')) return
      close.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <section ref={panel} role="dialog" aria-label={title} className={`flex h-full shrink-0 flex-col border-l border-line bg-surface ${wide ? 'w-[520px]' : 'w-[360px]'}`}>
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-semibold text-ink-900" title={title}>{title}</h2>
          {subtitle && <p className="mt-0.5 text-helper text-ink-800">{subtitle}</p>}
        </div>
        <IconButton label="Close" icon={X} onClick={onClose} className="-mt-1 -mr-2" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex shrink-0 gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </section>
  )
}
