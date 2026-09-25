import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogOptions {
  /** where focus goes on close; default: whatever had it when the dialog opened */
  returnFocus?: () => HTMLElement | null
  /** Escape closes an open menu or list inside the dialog (it handles the key itself) before it closes the dialog; an open disclosure doesn't count */
  escapeClosesMenusFirst?: boolean
}

/**
 * What makes a panel a modal dialog: focus moves in on open, Tab stays inside, Escape closes, and focus goes back on
 * close. A dialog opened on top of this one (a confirmation) owns the keyboard until it closes. Runs once per opening.
 */
export function useDialogBehaviour(panel: RefObject<HTMLElement | null>, onClose: () => void, { returnFocus, escapeClosesMenusFirst = false }: DialogOptions = {}) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? panel.current?.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      const open = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (open.length > 0 && open[open.length - 1] !== panel.current) return
      if (event.key === 'Escape') {
        if (escapeClosesMenusFirst && panel.current?.querySelector('[aria-expanded="true"][aria-haspopup], [role="combobox"][aria-expanded="true"]')) return
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
      ;(returnFocus?.() ?? opener)?.focus?.()
    }
    // onClose identity changes every render of the parent; the dialog is mounted once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
