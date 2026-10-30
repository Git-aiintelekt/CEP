/**
 * The suite's top bar, navy and the full width of the window: the navigation toggle over the rail, the app launcher,
 * the C360 brand with the open component's name, the search in the middle, and help, notifications and the account at
 * the right.
 */
import { ArrowLeftRight, Bell, ChevronDown, CircleHelp, LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, ShieldCheck, Sun, X, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'

import { iconButtonClass } from '@/components/buttonStyles'
import { MenuRow } from '@/components/MenuRow'
import type { NavItem } from '@/components/navItems'
import { Popover } from '@/components/Popover'
import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl'
import { useThemePreference, type ThemePreference } from '@/lib/theme'
import type { Me } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { AppLauncher } from './AppLauncher'
import { GlobalSearch } from './GlobalSearch'
import { SwitchWorkspaceDialog } from './SwitchWorkspaceDialog'
import type { EntitledComponent } from './manifests'

const SECURITY = '/account/security'

const THEME_OPTIONS: SegmentOption<ThemePreference>[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function initials(name: string | undefined): string {
  if (!name) return '?'
  return name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('')
}

/** the button over the rail: on phones it opens and closes the navigation, from md it collapses and expands it */
export type NavToggle = { kind: 'open' | 'close' | 'collapse' | 'expand'; onClick: () => void }

const TOGGLE: Record<NavToggle['kind'], { label: string; icon: LucideIcon }> = {
  open: { label: 'Open navigation', icon: Menu },
  close: { label: 'Close navigation', icon: X },
  collapse: { label: 'Collapse navigation', icon: PanelLeftClose },
  expand: { label: 'Expand navigation', icon: PanelLeftOpen },
}

const ON_NAVY_FOCUS = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-accent'

export interface TopBarProps {
  me: Me | null
  components: EntitledComponent[]
  current: EntitledComponent | null
  pages: NavItem[]
  searchRef: RefObject<HTMLInputElement | null>
  /** none in a workspace, which has no rail or menu to open */
  toggle?: NavToggle
  onHelp: () => void
  onLogout: () => void
  /** what sits before the account: the uploads indicator */
  extra?: ReactNode
}

export function TopBar({ me, components, current, pages, searchRef, toggle, onHelp, onLogout, extra }: TopBarProps) {
  const [themePreference, setThemePreference] = useThemePreference()
  const account = useSingleDropdown<'account'>()
  const navigate = useNavigate()
  const [switching, setSwitching] = useState(false)
  // a platform administrator in their own workspace: not inside a visit, not in a support session
  const canSwitch = Boolean(me?.principal.is_platform_admin && !me.platform_visit && !me.support_session)
  const name = me?.principal.display_name ?? me?.principal.email
  const role = me?.principal.roles?.[0] ?? me?.principal.email
  const ToggleIcon = toggle ? TOGGLE[toggle.kind].icon : null
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-1.5 bg-sidebar pr-3 pl-3 md:gap-2.5">
      {toggle && ToggleIcon && (
        <button
          type="button"
          onClick={toggle.onClick}
          aria-label={TOGGLE[toggle.kind].label}
          aria-expanded={toggle.kind === 'collapse' || toggle.kind === 'close'}
          className={`${iconButtonClass({ variant: 'onNavy', size: 'md' })} ${ON_NAVY_FOCUS}`}
        >
          <ToggleIcon size={20} strokeWidth={1.5} aria-hidden />
        </button>
      )}
      <AppLauncher me={me} components={components} current={current} />
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 font-display text-base font-bold text-on-brand">C</span>
        <span className="hidden font-display text-base font-bold tracking-[-0.02em] whitespace-nowrap text-on-brand sm:inline">C360</span>
        {current && (
          <>
            <span aria-hidden className="hidden h-4 w-px bg-sidebar-icon sm:block" />
            <span data-component-name className="hidden font-display text-base font-semibold whitespace-nowrap text-on-brand sm:block">{current.name}</span>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-1 justify-center px-2 md:px-6">
        <GlobalSearch pages={pages} inputRef={searchRef} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden items-center gap-1.5 pr-1 text-sm whitespace-nowrap xl:flex">
          <span className="text-sidebar-text">Workspace</span>
          <span className="font-semibold text-on-brand">{me?.tenant.code}</span>
        </span>
        {extra}
        <span className="hidden md:flex">
          <button type="button" onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className={`${iconButtonClass({ variant: 'onNavy' })} ${ON_NAVY_FOCUS}`}>
            <CircleHelp size={20} strokeWidth={1.5} aria-hidden />
          </button>
        </span>
        <button type="button" disabled aria-label="Notifications" title="Notifications are not available yet" className={iconButtonClass({ variant: 'onNavy', disabled: true })}>
          <Bell size={20} strokeWidth={1.5} aria-hidden />
        </button>
        <div className="relative">
          <button
            type="button"
            {...account.triggerProps('account')}
            aria-label={`Account: ${name ?? ''}`}
            className={`flex h-10 items-center gap-2 rounded-control-md pr-1 pl-1 transition-colors hover:bg-sidebar-hover active:bg-sidebar-pressed ${ON_NAVY_FOCUS}`}
          >
            <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {initials(me?.principal.display_name)}
            </span>
            <span className="hidden min-w-0 flex-col text-left leading-tight lg:flex">
              <span className="truncate text-sm font-semibold text-on-brand">{name}</span>
              <span data-role className="truncate text-xs text-sidebar-text">{role}</span>
            </span>
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden className="hidden shrink-0 text-sidebar-icon lg:block" />
          </button>
          {account.isOpen('account') && (
            <Popover {...account.panelProps('account')} label="Account" placement="bottom-end" width={240}>
              <div className="border-b border-line-subtle px-3 py-2.5 leading-tight">
                <p className="truncate text-sm font-semibold text-ink-900">{name}</p>
                <p className="truncate text-xs text-ink-800">{me?.principal.email}</p>
                {me?.workspace?.name && (
                  <p data-workspace className="mt-1.5 truncate text-xs text-ink-800">
                    <span className="font-semibold text-ink-900">{me.workspace.name}</span>
                    {me.workspace.plan && ` · ${me.workspace.plan.name} plan`}
                  </p>
                )}
              </div>
              <div className="border-b border-line-subtle px-3 py-2.5">
                <SegmentedControl label="Appearance" options={THEME_OPTIONS} value={themePreference} onChange={setThemePreference} stretch />
              </div>
              {canSwitch && (
                <MenuRow title="Switch Workspace…" leading={<ArrowLeftRight size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />}
                  onClick={() => { account.close({ restoreFocus: false }); setSwitching(true) }} />
              )}
              <MenuRow title="Account Security" leading={<ShieldCheck size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />}
                onClick={() => { account.close({ restoreFocus: false }); navigate(SECURITY) }} />
              <MenuRow title="Sign Out" leading={<LogOut size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />} onClick={() => { account.close({ restoreFocus: false }); onLogout() }} />
            </Popover>
          )}
        </div>
      </div>
      {switching && <SwitchWorkspaceDialog onClose={() => setSwitching(false)} />}
    </header>
  )
}
