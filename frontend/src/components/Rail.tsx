/**
 * The navigation rail's parts, shared by the app shell and the template editors' bar so the two look and behave
 * the same: the brand mark, a link (with its tooltip while the rail is collapsed) and the divider between groups.
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink } from 'react-router-dom'

import type { NavItem } from './navItems'

type OnNavigate = (to: string, event: MouseEvent) => void

const FOCUS = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent'

/** "CEP" on a 32px brand-blue square, and the product name beside it when there is room */
export function RailMark({ expanded, onNavigate, end }: { expanded: boolean; onNavigate?: OnNavigate; end?: ReactNode }) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => onNavigate?.('/', event)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Link to="/" aria-label="CEP home" onClick={go} className={`flex w-fit items-center rounded-sm ${FOCUS}`}>
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-brand-600 font-display text-helper font-semibold tracking-[-0.02em] text-on-brand">CEP</span>
        </Link>
        {end}
      </div>
      {expanded && (
        <Link to="/" aria-hidden tabIndex={-1} onClick={go} className="w-fit font-display text-card-title font-semibold tracking-[-0.02em] whitespace-nowrap text-on-brand">Customer Engagement</Link>
      )}
    </div>
  )
}

const TOOLTIP_DELAY = 300

/**
 * The label beside a collapsed item: after a short hover, or at once on keyboard focus. Portalled, so the rail's scroll
 * box can't clip it. It never outlives what it labels: a press, a scroll, a resize or the rail opening or closing puts
 * it away, and a hover that ended before the delay shows nothing.
 */
function useTooltip(enabled: boolean) {
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

export function RailLink({ item, expanded, onNavigate }: { item: NavItem; expanded: boolean; onNavigate?: OnNavigate }) {
  const Icon = item.icon
  const tooltip = useTooltip(!expanded)
  return (
    <>
      <NavLink
        to={item.to}
        end={item.end}
        aria-label={item.label}
        onClick={(event) => onNavigate?.(item.to, event)}
        {...tooltip.props}
        className={({ isActive }) =>
          `group relative flex h-10 shrink-0 items-center gap-3 overflow-hidden rounded-sm px-2.5 text-sm whitespace-nowrap transition-colors duration-fast ease-standard ${FOCUS} ${expanded ? 'w-full' : 'w-10'} ${
            isActive ? 'bg-sidebar-selected font-semibold text-on-brand hover:bg-sidebar-selected-hover' : 'font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-on-brand active:bg-sidebar-pressed'
          }`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span aria-hidden data-current-bar className="absolute inset-y-0 left-0 w-[3px] bg-sidebar-accent" />}
            <Icon size={20} strokeWidth={1.5} aria-hidden className={`shrink-0 ${isActive ? 'text-on-brand' : 'text-sidebar-icon group-hover:text-on-brand'}`} />
            {expanded && <span>{item.label}</span>}
          </>
        )}
      </NavLink>
      {tooltip.shown && createPortal(
        <span aria-hidden data-rail-tooltip className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-sm bg-toast px-2 py-1 text-xs font-medium whitespace-nowrap text-on-brand"
          style={{ left: tooltip.shown.left, top: tooltip.shown.top }}>
          {item.label}
        </span>,
        document.body,
      )}
    </>
  )
}

/** a group of links: a plain list, the divider above it when it isn't the first */
export function RailGroup({ label, items, expanded, divided = false, onNavigate }: { label: string; items: NavItem[]; expanded: boolean; divided?: boolean; onNavigate?: OnNavigate }) {
  if (items.length === 0) return null
  return (
    <>
      {divided && <div aria-hidden className="mx-2 my-4 h-px shrink-0 bg-sidebar-divider" />}
      <ul aria-label={label} className="flex flex-col gap-0.5">
        {items.map((item) => <li key={item.to}><RailLink item={item} expanded={expanded} onNavigate={onNavigate} /></li>)}
      </ul>
    </>
  )
}
