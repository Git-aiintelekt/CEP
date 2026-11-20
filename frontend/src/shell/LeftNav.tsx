/**
 * The suite's left navigation: one navy rail with the open component's pages and Workspace Settings at the foot. The
 * top bar's toggle collapses it to a column of icons and opens it again; switching components happens in the launcher.
 * Everything is built from the manifests and GET /me/, with no request per click.
 */
import { Link, NavLink } from 'react-router-dom'

import type { NavItem } from '@/components/navItems'
import { RailTooltip, useTooltip } from '@/components/Rail'
import type { EntitledComponent } from './manifests'

const FOCUS = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent'
const ROW = `flex h-10 shrink-0 items-center gap-3 rounded-md whitespace-nowrap transition-colors duration-fast ease-standard ${FOCUS}`
const ROW_QUIET = 'font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-on-brand active:bg-sidebar-pressed'
const ROW_CURRENT = 'bg-sidebar-selected font-semibold text-on-brand hover:bg-sidebar-selected-hover'

function RailRow({ item, label = item.label, collapsed, onNavigate }: { item: NavItem; label?: string; collapsed: boolean; onNavigate?: () => void }) {
  const tooltip = useTooltip(collapsed)
  return (
    <>
      <NavLink
        to={item.to}
        end={item.end}
        aria-label={collapsed ? label : undefined}
        onClick={onNavigate}
        {...tooltip.props}
        className={({ isActive }) => `group ${ROW} ${collapsed ? 'w-10 justify-center' : 'px-3'} ${isActive ? ROW_CURRENT : ROW_QUIET}`}
      >
        {({ isActive }) => (
          <>
            <item.icon size={20} strokeWidth={1.5} aria-hidden className={`shrink-0 ${isActive ? 'text-on-brand' : 'text-sidebar-text group-hover:text-on-brand'}`} />
            {!collapsed && <span className="truncate">{label}</span>}
          </>
        )}
      </NavLink>
      {tooltip.shown && <RailTooltip at={tooltip.shown} label={label} />}
    </>
  )
}

export interface PageRailProps {
  /** the open component; none when the workspace has none this person can open */
  current: EntitledComponent | null
  /** Workspace Settings, when the person may open it */
  settings: NavItem | null
  collapsed: boolean
  onNavigate?: () => void
}

/**
 * The navy rail: the open component's name (a link to its Home), its pages with the current one on the selected fill,
 * and Settings at the foot under a divider. Collapsed, it is a 64px column of the same pages as icons, each label a tooltip.
 */
export function PageRail({ current, settings, collapsed, onNavigate }: PageRailProps) {
  return (
    <div className={`flex min-h-full flex-col pt-2 pb-4 ${collapsed ? 'w-16 items-center' : 'w-60 px-3'}`}>
      {current && !collapsed && (
        <Link to={current.home} onClick={onNavigate} className={`mb-2 truncate rounded-md px-3 py-2 font-display text-section-title font-semibold text-on-brand ${FOCUS}`}>
          {current.name}
        </Link>
      )}
      {current && (
        <ul aria-label={current.name} className="flex flex-col gap-1">
          {current.menu.map((item) => <li key={item.to}><RailRow item={item} collapsed={collapsed} onNavigate={onNavigate} /></li>)}
        </ul>
      )}
      {settings && (
        <ul aria-label="Workspace" className={`mt-auto border-t border-sidebar-divider pt-2 ${collapsed ? 'w-10' : ''}`}>
          <li><RailRow item={settings} label="Settings" collapsed={collapsed} onNavigate={onNavigate} /></li>
        </ul>
      )}
    </div>
  )
}
