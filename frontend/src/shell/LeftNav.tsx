/**
 * The suite's left navigation, Salesforce style: level 1 lists the workspace's components, choosing one drills down
 * to level 2, that component's menu, and a section opens in place (level 3). With one component there is nothing to
 * choose, so the menu shows straight away. Collapsed, it is a 64px rail of component tiles: pointing at one shows its
 * menu as a flyout. Everything is built from the manifests and GET /me/, with no request per click.
 */
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import type { NavItem } from '@/components/navItems'
import { RailLink } from '@/components/Rail'
import type { Me } from '@/lib/types'
import type { EntitledComponent } from './manifests'

const FOCUS = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent'
const ROW = `flex h-10 w-full shrink-0 items-center gap-2.5 rounded-sm px-2 text-left text-sm whitespace-nowrap transition-colors duration-fast ease-standard ${FOCUS}`
const QUIET = 'font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-on-brand active:bg-sidebar-pressed'

export type Toggle = { kind: 'collapse' | 'expand' | 'close'; onClick: () => void }

/** a component's identity tile: its icon on a soft square; identity only, never an action colour */
function Tile({ component, size = 'sm' }: { component: EntitledComponent; size?: 'sm' | 'md' }) {
  const Icon = component.icon
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center bg-sidebar-hover text-on-brand ${size === 'md' ? 'h-10 w-10 rounded-md' : 'h-[26px] w-[26px] rounded-sm'}`}>
      <Icon size={size === 'md' ? 20 : 14} strokeWidth={1.5} />
    </span>
  )
}

function ToggleRow({ toggle, expanded }: { toggle: Toggle; expanded: boolean }) {
  const label = toggle.kind === 'close' ? 'Close navigation' : toggle.kind === 'collapse' ? 'Collapse navigation' : 'Expand navigation'
  const Icon: LucideIcon = toggle.kind === 'close' ? X : toggle.kind === 'collapse' ? PanelLeftClose : PanelLeftOpen
  return (
    <button type="button" onClick={toggle.onClick} aria-label={label} aria-expanded={toggle.kind === 'close' ? undefined : toggle.kind === 'collapse'} className={`${ROW} ${QUIET} ${expanded ? '' : 'w-10 justify-center px-0'}`}>
      <Icon size={20} strokeWidth={1.5} aria-hidden className="shrink-0 text-sidebar-icon" />
      {expanded && <span>{toggle.kind === 'close' ? 'Close' : toggle.kind === 'collapse' ? 'Collapse' : 'Expand'}</span>}
    </button>
  )
}

/** the menu of one component, as a flyout beside its collapsed tile: hover or focus opens it, leaving or Escape closes it */
function Flyout({ component, at, onClose, onLeave, onEnter }: { component: EntitledComponent; at: { left: number; top: number }; onClose: () => void; onLeave: () => void; onEnter: () => void }) {
  const Icon = component.icon
  return createPortal(
    <div
      role="region"
      aria-label={`${component.name} menu`}
      data-rail-flyout
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }}
      className="fixed z-50 w-[230px] animate-fade-in rounded-md border border-line bg-surface-overlay p-1.5 text-sm shadow-menu"
      style={{ left: at.left, top: at.top }}
    >
      <div className="mb-1 flex items-center gap-2 border-b border-line-subtle px-2 py-1.5 font-semibold text-ink-900">
        <span aria-hidden className={`flex h-[26px] w-[26px] items-center justify-center rounded-sm ${component.tile}`}><Icon size={14} strokeWidth={1.5} /></span>
        {component.name}
      </div>
      <ul aria-label={component.name}>
        {component.menu.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} onClick={onClose} className={({ isActive }) => `flex h-8 items-center rounded-sm px-2 transition-colors ${isActive ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  )
}

const FLYOUT_DELAY = 150

/** the 64px rail: one tile per component, the current one marked; the flyout follows the pointer or the keyboard */
function MiniRail({ components, current, settings, toggle }: { components: EntitledComponent[]; current: EntitledComponent | null; settings: NavItem | null; toggle: Toggle }) {
  const navigate = useNavigate()
  const [flyout, setFlyout] = useState<{ key: string; left: number; top: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const cancel = () => window.clearTimeout(timer.current)
  const leave = () => { cancel(); timer.current = window.setTimeout(() => setFlyout(null), FLYOUT_DELAY) }
  const show = (key: string, target: HTMLElement) => {
    cancel()
    const rect = target.getBoundingClientRect()
    setFlyout({ key, left: rect.right + 8, top: rect.top })
  }
  useEffect(() => () => cancel(), [])
  // Escape puts the flyout away wherever the focus is; a press anywhere else does too
  useEffect(() => {
    if (!flyout) return
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setFlyout(null) }
    const onPress = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('[data-rail-flyout]')) setFlyout(null) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress, true)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPress, true) }
  }, [flyout])
  const shown = flyout ? components.find((item) => item.key === flyout.key) ?? null : null
  return (
    <>
      <ul aria-label="Components" className="flex flex-col items-center gap-0.5">
        {components.map((component) => {
          const Icon = component.icon
          const isCurrent = component.key === current?.key
          return (
            <li key={component.key}>
              <button
                type="button"
                aria-label={component.name}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => { setFlyout(null); navigate(component.home) }}
                onMouseEnter={(event: MouseEvent<HTMLButtonElement>) => show(component.key, event.currentTarget)}
                onMouseLeave={leave}
                onFocus={(event: FocusEvent<HTMLButtonElement>) => show(component.key, event.currentTarget)}
                onBlur={leave}
                onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') setFlyout(null) }}
                className={`relative flex h-10 w-11 items-center justify-center rounded-md transition-colors duration-fast ease-standard ${FOCUS} ${isCurrent ? 'bg-sidebar-selected text-on-brand' : 'text-sidebar-text hover:bg-sidebar-hover hover:text-on-brand'}`}
              >
                {isCurrent && <span aria-hidden data-current-bar className="absolute inset-y-0 left-0 w-[3px] rounded-l-md bg-sidebar-accent" />}
                <Icon size={20} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      {shown && flyout && <Flyout component={shown} at={flyout} onClose={() => setFlyout(null)} onEnter={cancel} onLeave={leave} />}
      <div className="mt-auto flex flex-col items-center gap-0.5 border-t border-sidebar-divider pt-1.5">
        {settings && <ul aria-label="Workspace"><li><RailLink item={settings} expanded={false} /></li></ul>}
        <ToggleRow toggle={toggle} expanded={false} />
      </div>
    </>
  )
}

export interface LeftNavProps {
  components: EntitledComponent[]
  current: EntitledComponent | null
  /** labels are shown (240px, after the width has settled) */
  expanded: boolean
  workspace: Me['workspace'] | undefined
  /** Workspace Settings, when the person may open it */
  settings: NavItem | null
  toggle: Toggle
  /** the phone overlay closes after a choice */
  onNavigate?: () => void
}

export function LeftNav({ components, current, expanded, workspace, settings, toggle, onNavigate }: LeftNavProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const several = components.length > 1
  // the list of components is for choosing, not for staying on: it is open only for the page it was opened on
  const [listingOn, setListingOn] = useState<string | null>(null)
  const listing = listingOn === location.pathname
  const setListing = (value: boolean) => setListingOn(value ? location.pathname : null)

  if (!expanded) return <MiniRail components={components} current={current} settings={settings} toggle={toggle} />

  const foot = (
    <div className="mt-auto flex flex-col gap-0.5 border-t border-sidebar-divider pt-1.5">
      {settings && <ul aria-label="Workspace"><li><RailLink item={settings} expanded onNavigate={onNavigate ? () => onNavigate() : undefined} /></li></ul>}
      <ToggleRow toggle={toggle} expanded />
    </div>
  )

  if (several && (listing || !current)) {
    return (
      <>
        <div className="mb-1.5 border-b border-sidebar-divider px-2 pb-2.5 leading-tight">
          <p className="truncate text-sm font-semibold text-on-brand">{workspace?.name ?? 'Workspace'}</p>
          {workspace?.plan && <p className="truncate text-xs text-sidebar-text">{workspace.plan.name} plan</p>}
        </div>
        <p className="px-2 pt-1 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-sidebar-text uppercase">Components</p>
        <ul aria-label="Components" className="flex flex-col gap-0.5">
          {components.map((component) => (
            <li key={component.key}>
              <button
                type="button"
                aria-current={component.key === current?.key ? 'true' : undefined}
                onClick={() => { setListing(false); if (component.key !== current?.key) { navigate(component.home); onNavigate?.() } }}
                className={`${ROW} ${component.key === current?.key ? 'bg-sidebar-selected font-semibold text-on-brand' : QUIET}`}
              >
                <Tile component={component} />
                <span className="min-w-0 flex-1 truncate">{component.name}</span>
                {component.access === 'TRIAL' && <span className="rounded-sm bg-warning px-1.5 text-[10px] font-semibold text-on-warning">Trial</span>}
                <ChevronRight size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-sidebar-icon" />
              </button>
            </li>
          ))}
        </ul>
        {foot}
      </>
    )
  }

  return (
    <>
      {several && (
        <button type="button" onClick={() => setListing(true)} className={`${ROW} h-8 text-xs font-semibold text-sidebar-text hover:text-on-brand`}>
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden />
          All Components
        </button>
      )}
      {current && (
        <Link to={current.home} onClick={onNavigate} className={`mb-1.5 flex items-center gap-2.5 rounded-sm border-b border-sidebar-divider px-2 pt-1 pb-2.5 leading-tight ${FOCUS}`}>
          <Tile component={current} />
          <span className="min-w-0">
            <span className="block truncate font-display text-sm font-semibold text-on-brand">{current.name}</span>
            <span className="block truncate text-[11px] text-sidebar-text">{current.tagline}</span>
          </span>
        </Link>
      )}
      <ul aria-label={current?.name ?? 'Pages'} className="flex flex-col gap-0.5">
        {(current?.menu ?? []).map((item) => <li key={item.to}><RailLink item={item} expanded onNavigate={onNavigate ? () => onNavigate() : undefined} /></li>)}
      </ul>
      {foot}
    </>
  )
}
