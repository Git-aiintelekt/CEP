/**
 * The suite's left navigation, in two columns: the app rail, always there, with one tile per component the workspace
 * has and Workspace Settings at the foot; and beside it the open component's menu, which the top bar's toggle
 * collapses to a column of icons and opens again. Everything is built from the manifests and GET /me/, with no request per click.
 */
import { Link, NavLink } from 'react-router-dom'

import type { NavItem } from '@/components/navItems'
import { RailTooltip, useTooltip } from '@/components/Rail'
import type { EntitledComponent } from './manifests'

const FOCUS = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent'
const TILE = `relative flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-md px-0.5 py-2 text-xs transition-colors duration-fast ease-standard ${FOCUS}`
const TILE_QUIET = 'font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-on-brand active:bg-sidebar-pressed'
const TILE_CURRENT = 'bg-sidebar-selected font-semibold text-on-brand hover:bg-sidebar-selected-hover'

export interface AppRailProps {
  components: EntitledComponent[]
  current: EntitledComponent | null
  /** Workspace Settings, when the person may open it */
  settings: NavItem | null
}

/** the 88px rail: each component's icon with its name below, the open one marked; a tile opens that component's Home */
export function AppRail({ components, current, settings }: AppRailProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-1.5">
      <ul aria-label="Components" className="flex flex-col gap-1">
        {components.map((component) => {
          const Icon = component.icon
          const isCurrent = component.key === current?.key
          return (
            <li key={component.key}>
              <Link to={component.home} aria-current={isCurrent ? 'true' : undefined} title={component.tagline} className={`${TILE} ${isCurrent ? TILE_CURRENT : TILE_QUIET}`}>
                <Icon size={20} strokeWidth={1.5} aria-hidden className={isCurrent ? 'text-on-brand' : 'text-sidebar-icon'} />
                <span className="max-w-full truncate">{component.name}</span>
                {component.access === 'TRIAL' && <span className="absolute top-1 right-1 rounded-sm bg-warning px-1 text-[10px] leading-4 font-semibold text-on-warning">Trial</span>}
              </Link>
            </li>
          )
        })}
      </ul>
      {settings && (
        <ul aria-label="Workspace" className="mt-auto border-t border-sidebar-divider pt-2">
          <li>
            <NavLink to={settings.to} className={({ isActive }) => `${TILE} ${isActive ? TILE_CURRENT : TILE_QUIET}`}>
              {({ isActive }) => (
                <>
                  <settings.icon size={20} strokeWidth={1.5} aria-hidden className={isActive ? 'text-on-brand' : 'text-sidebar-icon'} />
                  <span>Settings</span>
                </>
              )}
            </NavLink>
          </li>
        </ul>
      )}
    </div>
  )
}

const LIGHT_FOCUS = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'

function MenuLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const tooltip = useTooltip(collapsed)
  return (
    <>
      <NavLink
        to={item.to}
        end={item.end}
        aria-label={collapsed ? item.label : undefined}
        onClick={onNavigate}
        {...tooltip.props}
        className={({ isActive }) => `group flex h-10 items-center gap-3 rounded-md whitespace-nowrap transition-colors duration-fast ease-standard ${LIGHT_FOCUS} ${collapsed ? 'w-10 justify-center' : 'px-3'} ${
          isActive ? 'bg-brand-100 font-semibold text-brand-800' : 'font-medium text-ink-900 hover:bg-surface-hover'
        }`}
      >
        {({ isActive }) => (
          <>
            <item.icon size={20} strokeWidth={1.5} aria-hidden className={`shrink-0 ${isActive ? 'text-brand-800' : 'text-ink-800'}`} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </>
        )}
      </NavLink>
      {tooltip.shown && <RailTooltip at={tooltip.shown} label={item.label} />}
    </>
  )
}

/**
 * The open component's menu, on white: its name and tagline, then its pages, the current one on Blue 100. Collapsed,
 * it is a 64px column of the same pages as icons, each with its label as a tooltip.
 */
export function ComponentMenu({ current, collapsed = false, onNavigate }: { current: EntitledComponent; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <div className={`flex flex-col gap-4 pt-4 ${collapsed ? 'w-16 items-center' : 'w-60 px-3'}`}>
      {!collapsed && (
        <Link to={current.home} onClick={onNavigate} className={`flex flex-col rounded-md px-3 py-1 leading-tight ${LIGHT_FOCUS}`}>
          <span className="truncate font-display text-section-title font-semibold text-ink-900">{current.name}</span>
          <span className="truncate text-sm text-ink-800">{current.tagline}</span>
        </Link>
      )}
      <ul aria-label={current.name} className="flex flex-col gap-1">
        {current.menu.map((item) => <li key={item.to}><MenuLink item={item} collapsed={collapsed} onNavigate={onNavigate} /></li>)}
      </ul>
    </div>
  )
}
