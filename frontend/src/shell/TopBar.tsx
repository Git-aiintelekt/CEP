/**
 * The suite's top bar, Microsoft 365 style: the app launcher at the far left, the C360 brand with the open component's
 * name, the search in the middle, and help, notifications and the account at the right. White, one hairline below.
 */
import { Bell, ChevronDown, CircleHelp, LogOut, Menu, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
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

export interface TopBarProps {
  me: Me | null
  components: EntitledComponent[]
  current: EntitledComponent | null
  pages: NavItem[]
  searchRef: RefObject<HTMLInputElement | null>
  /** below md: the button that opens the navigation */
  onOpenNav?: () => void
  onHelp: () => void
  onLogout: () => void
  /** what sits before the account: the uploads indicator */
  extra?: ReactNode
}

export function TopBar({ me, components, current, pages, searchRef, onOpenNav, onHelp, onLogout, extra }: TopBarProps) {
  const [themePreference, setThemePreference] = useThemePreference()
  const account = useSingleDropdown<'account'>()
  const navigate = useNavigate()
  const name = me?.principal.display_name ?? me?.principal.email
  const role = me?.principal.roles?.[0] ?? me?.principal.email
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface pr-3 pl-1.5 md:gap-2.5">
      {onOpenNav && (
        <button type="button" onClick={onOpenNav} aria-label="Open navigation" className={iconButtonClass()}>
          <Menu size={20} strokeWidth={1.5} aria-hidden />
        </button>
      )}
      <AppLauncher components={components} current={current} />
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <span className="font-display text-[15px] font-bold tracking-[-0.02em] whitespace-nowrap text-ink-900">C<span className="text-brand-600">360</span></span>
        {current && (
          <>
            <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
            <span data-component-name className="hidden text-sm font-semibold whitespace-nowrap text-ink-800 sm:block">{current.name}</span>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-1 justify-center px-2 md:px-6">
        <GlobalSearch pages={pages} inputRef={searchRef} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden items-center gap-1.5 pr-1 text-sm whitespace-nowrap xl:flex">
          <span className="text-ink-700">Workspace</span>
          <span className="font-semibold text-ink-900">{me?.tenant.code}</span>
        </span>
        {extra}
        <span className="hidden md:flex">
          <button type="button" onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className={iconButtonClass()}>
            <CircleHelp size={20} strokeWidth={1.5} aria-hidden />
          </button>
        </span>
        <button type="button" disabled aria-label="Notifications" title="Notifications are not available yet" className={iconButtonClass({ disabled: true })}>
          <Bell size={20} strokeWidth={1.5} aria-hidden />
        </button>
        <div className="relative">
          <button
            type="button"
            {...account.triggerProps('account')}
            aria-label={`Account: ${name ?? ''}`}
            className="flex h-10 items-center gap-2 rounded-control-md pr-1 pl-1 transition-colors hover:bg-surface-hover"
          >
            <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {initials(me?.principal.display_name)}
            </span>
            <span className="hidden min-w-0 flex-col text-left leading-tight lg:flex">
              <span className="truncate text-sm font-semibold text-ink-900">{name}</span>
              <span data-role className="truncate text-xs text-ink-800">{role}</span>
            </span>
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden className="hidden shrink-0 text-ink-700 lg:block" />
          </button>
          {account.isOpen('account') && (
            <Popover {...account.panelProps('account')} label="Account" placement="bottom-end" width={240}>
              <div className="border-b border-line-subtle px-3 py-2.5 leading-tight">
                <p className="truncate text-sm font-semibold text-ink-900">{name}</p>
                <p className="truncate text-xs text-ink-800">{me?.principal.email}</p>
              </div>
              <div className="border-b border-line-subtle px-3 py-2.5">
                <SegmentedControl label="Appearance" options={THEME_OPTIONS} value={themePreference} onChange={setThemePreference} stretch />
              </div>
              <MenuRow title="Account Security" leading={<ShieldCheck size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />}
                onClick={() => { account.close({ restoreFocus: false }); navigate(SECURITY) }} />
              <MenuRow title="Sign Out" leading={<LogOut size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />} onClick={() => { account.close({ restoreFocus: false }); onLogout() }} />
            </Popover>
          )}
        </div>
      </div>
    </header>
  )
}
