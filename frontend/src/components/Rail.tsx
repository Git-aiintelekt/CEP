/**
 * The parts of the template editors' slim navy rail: the brand mark (the top bar's "C") and icon-only links with
 * their tooltips. The tooltip is shared with the shell's collapsed component menu.
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink } from 'react-router-dom'

import type { NavItem } from './navItems'

type OnNavigate = (to: string, event: MouseEvent) => void

const FOCUS = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent'

/** the suite's "C" on a 32px brand-blue square, as in the top bar */
export function RailMark({ onNavigate }: { onNavigate?: OnNavigate }) {
  return (
    <Link to="/" aria-label="C360 home" onClick={(event) => onNavigate?.('/', event)} className={`flex w-fit items-center rounded-md ${FOCUS}`}>
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 font-display text-base font-bold text-on-brand">C</span>
    </Link>
  )
}

const TOOLTIP_DELAY = 300

/**
 * The label beside a collapsed item: after a short hover, or at once on keyboard focus. Portalled, so the rail's scroll
 * box can't clip it. It never outlives what it labels: a press, a scroll, a resize or the rail opening or closing puts
 * it away, and a hover that ended before the delay shows nothing.
 */
export function useTooltip(enabled: boolean) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // a focus that follows a press is a click, not the keyboard: those get the hover delay instead
  const pressed = useRef(false)
  // the rail opened or closed (or the item went away): drop any label shown or waiting
  useEffect(() => () => {
    window.clearTimeout(timer.current)
    setAt(null)
  }, [enabled])

  const shown = enabled ? at : null
  useEffect(() => {
    if (!shown) return
    const away = () => {
      window.clearTimeout(timer.current)
      setAt(null)
    }
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    document.addEventListener('pointerdown', away, true)
    return () => {
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
      document.removeEventListener('pointerdown', away, true)
    }
  }, [shown])

  const place = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    setAt({ left: rect.right + 8, top: rect.top + rect.height / 2 })
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setAt(null)
  }
  if (!enabled) return { props: {}, shown: null }
  return {
    props: {
      onMouseEnter: (event: MouseEvent<HTMLElement>) => {
        const target = event.currentTarget
        window.clearTimeout(timer.current)
        // only if the pointer is still on the item when the delay ends
        timer.current = window.setTimeout(() => { if (target.isConnected && target.matches(':hover')) place(target) }, TOOLTIP_DELAY)
      },
      onMouseLeave: hide,
      onPointerDown: () => {
        pressed.current = true
        hide()
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (!pressed.current) place(event.currentTarget)
        pressed.current = false
      },
      onBlur: hide,
      onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Escape') hide() },
    },
    shown,
  }
}

/** the dark label beside an icon-only item, outside any scroll box */
export function RailTooltip({ at, label }: { at: { left: number; top: number }; label: string }) {
  return createPortal(
    <span aria-hidden data-rail-tooltip className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-sm bg-toast px-2 py-1 text-xs font-medium whitespace-nowrap text-on-brand"
      style={{ left: at.left, top: at.top }}>
      {label}
    </span>,
    document.body,
  )
}

/** an icon-only link; its label shows as a tooltip */
export function RailLink({ item, onNavigate }: { item: NavItem; onNavigate?: OnNavigate }) {
  const Icon = item.icon
  const tooltip = useTooltip(true)
  return (
    <>
      <NavLink
        to={item.to}
        end={item.end}
        aria-label={item.label}
        onClick={(event) => onNavigate?.(item.to, event)}
        {...tooltip.props}
        className={({ isActive }) =>
          `group relative flex h-10 shrink-0 items-center gap-3 overflow-hidden rounded-sm px-2.5 text-sm whitespace-nowrap transition-colors duration-fast ease-standard ${FOCUS} w-10 ${
            isActive ? 'bg-sidebar-selected font-semibold text-on-brand hover:bg-sidebar-selected-hover' : 'font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-on-brand active:bg-sidebar-pressed'
          }`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span aria-hidden data-current-bar className="absolute inset-y-0 left-0 w-[3px] bg-sidebar-accent" />}
            <Icon size={20} strokeWidth={1.5} aria-hidden className={`shrink-0 ${isActive ? 'text-on-brand' : 'text-sidebar-icon group-hover:text-on-brand'}`} />
          </>
        )}
      </NavLink>
      {tooltip.shown && <RailTooltip at={tooltip.shown} label={item.label} />}
    </>
  )
}

/** a group of links, as a plain list */
export function RailGroup({ label, items, onNavigate }: { label: string; items: NavItem[]; onNavigate?: OnNavigate }) {
  if (items.length === 0) return null
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {items.map((item) => <li key={item.to}><RailLink item={item} onNavigate={onNavigate} /></li>)}
    </ul>
  )
}
