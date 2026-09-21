import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Behaviour for a set of named dropdown panels of which at most one is open.
 * Purely behavioural: no styling, positioning or portalling — the caller renders whatever it likes.
 *
 * The panel element itself should carry role="region" and an aria-label. A non-modal panel is not a
 * menu, so the trigger advertises aria-haspopup="dialog"; "true" would promise a menu that never arrives.
 */

// Same shape as Modal's FOCUSABLE: disabled rows are excluded by the selector, not by a second filter pass.
const ITEM = '[data-dropdown-item]:not([disabled]):not([aria-disabled="true"])'

export interface TriggerProps {
  ref: (node: HTMLElement | null) => void
  onClick: () => void
  'aria-expanded': boolean
  'aria-controls': string
  'aria-haspopup': 'dialog'
}

export interface PanelProps {
  ref: (node: HTMLElement | null) => void
  id: string
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

export interface SingleDropdown<K extends string> {
  open: K | null
  isOpen: (key: K) => boolean
  toggle: (key: K) => void
  close: (options?: { restoreFocus?: boolean }) => void
  triggerProps: (key: K) => TriggerProps
  panelProps: (key: K) => PanelProps
}

export function useSingleDropdown<K extends string>(): SingleDropdown<K> {
  const baseId = useId()
  const [open, setOpen] = useState<K | null>(null)
  const triggers = useRef(new Map<K, HTMLElement | null>())
  const panels = useRef(new Map<K, HTMLElement | null>())
  // close() is called from event handlers long after commit, so it reads the open key from here
  // rather than from a dependency, which keeps its identity stable across renders
  const openRef = useRef<K | null>(null)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    const key = openRef.current
    if (key === null) return
    openRef.current = null
    setOpen(null)
    if (options?.restoreFocus === false) return
    triggers.current.get(key)?.focus()
  }, [])

  // switching panels is not a dismissal: focus belongs to whatever the user just pressed
  const toggle = useCallback((key: K) => {
    setOpen((current) => (current === key ? null : key))
  }, [])

  const rows = useCallback((key: K) => {
    const panel = panels.current.get(key)
    return panel ? Array.from(panel.querySelectorAll<HTMLElement>(ITEM)) : []
  }, [])

  const focusRow = useCallback(
    (key: K, index: number) => {
      const items = rows(key)
      if (items.length === 0) return false
      const wrapped = ((index % items.length) + items.length) % items.length
      items[wrapped].focus()
      return true
    },
    [rows],
  )

  const moveFocus = useCallback(
    (key: K, delta: number) => {
      const items = rows(key)
      if (items.length === 0) return false
      const from = items.indexOf(document.activeElement as HTMLElement)
      return focusRow(key, from === -1 ? (delta > 0 ? 0 : -1) : from + delta)
    },
    [rows, focusRow],
  )

  const within = useCallback((key: K, node: Node | null) => {
    if (node === null) return false
    return Boolean(triggers.current.get(key)?.contains(node)) || Boolean(panels.current.get(key)?.contains(node))
  }, [])

  useEffect(() => {
    if (open === null) return

    const onPointerDown = (event: PointerEvent) => {
      // the user aimed at something else on the page; stealing focus back to the trigger would fight that
      if (!within(open, event.target as Node | null)) close({ restoreFocus: false })
    }

    const onFocusIn = (event: FocusEvent) => {
      if (!within(open, event.target as Node | null)) close({ restoreFocus: false })
    }

    // Escape and the trigger's own arrow keys live here rather than on triggerProps, which has no onKeyDown slot.
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Node | null
      if (!within(open, target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      const onTrigger = Boolean(triggers.current.get(open)?.contains(target))
      if (!onTrigger) return
      if (event.key === 'ArrowDown' && focusRow(open, 0)) event.preventDefault()
      if (event.key === 'ArrowUp' && focusRow(open, -1)) event.preventDefault()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, within, close, focusRow])

  const triggerProps = useCallback(
    (key: K): TriggerProps => ({
      ref: (node) => {
        triggers.current.set(key, node)
      },
      onClick: () => toggle(key),
      'aria-expanded': open === key,
      'aria-controls': `${baseId}-${key}`,
      'aria-haspopup': 'dialog',
    }),
    [open, baseId, toggle],
  )

  const panelProps = useCallback(
    (key: K): PanelProps => ({
      ref: (node) => {
        panels.current.set(key, node)
      },
      id: `${baseId}-${key}`,
      onKeyDown: (event) => {
        const handled =
          event.key === 'ArrowDown' ? moveFocus(key, 1)
          : event.key === 'ArrowUp' ? moveFocus(key, -1)
          : event.key === 'Home' ? focusRow(key, 0)
          : event.key === 'End' ? focusRow(key, -1)
          : false
        if (handled) event.preventDefault()
      },
    }),
    [baseId, moveFocus, focusRow],
  )

  return {
    open,
    isOpen: (key: K) => open === key,
    toggle,
    close,
    triggerProps,
    panelProps,
  }
}
