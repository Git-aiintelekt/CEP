import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** sticky footer, usually the action buttons */
  footer?: ReactNode
  /** md is the 480px dialog; lg is the wider variant for forms with long option lists */
  size?: 'md' | 'lg'
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Accessible dialog: labelled, Escape closes, Tab stays inside, focus moves in on open and returns to the opener on close. */
export function Modal({ title, onClose, children, footer, size = 'md' }: ModalProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const stops = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (stops.length === 0) return
      const firstStop = stops[0]
      const lastStop = stops[stops.length - 1]
      if (event.shiftKey && document.activeElement === firstStop) {
        event.preventDefault()
        lastStop.focus()
      } else if (!event.shiftKey && document.activeElement === lastStop) {
        event.preventDefault()
        firstStop.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
    // onClose identity changes every render of the parent; the dialog is mounted once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-scrim p-4 md:p-10" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`w-full rounded-lg bg-surface ${size === 'lg' ? 'md:max-w-3xl' : 'md:max-w-[480px]'}`}>
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 id={titleId} className="font-display text-base font-semibold text-ink-900">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-700 transition-colors hover:bg-line-subtle">
            <X size={20} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}
