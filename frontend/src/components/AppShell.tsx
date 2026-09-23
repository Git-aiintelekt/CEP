import { useMutation } from '@tanstack/react-query'
import { Bell, ChevronsLeft, ChevronsRight, Menu, Search, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { UploadsIndicator } from '@/features/contact-lists/UploadsIndicator'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'
import { ENGAGE, MANAGE, OVERVIEW, SETTINGS, type NavItem } from './navItems'

const SECURITY = '/account/security'
const COLLAPSED_KEY = 'cep.nav.collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    /* blocked storage: the rail simply opens expanded next time */
  }
}

/** Shown for as long as platform support is acting as this user: never subtle, and always one click from ending. */
function SupportBanner({ by, mode, expiresAt, onEnded }: { by: string; mode: 'READ' | 'WRITE'; expiresAt: string; onEnded: () => void }) {
  const end = useMutation({ mutationFn: () => api.post('/auth/support-session/end/'), onSettled: onEnded })
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 bg-warning px-4 py-2 text-sm font-medium text-ink-900 md:px-8">
      <p>
        Support session: {by} is acting as this user · {mode === 'WRITE' ? 'changes are allowed and recorded' : 'read-only'} · ends {formatDateTime(expiresAt)}
      </p>
      <button type="button" disabled={end.isPending} onClick={() => end.mutate()} className="h-8 rounded-sm bg-ink-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-ink-700 disabled:bg-line-subtle disabled:text-ink-300">
        End session
      </button>
    </div>
  )
}

function initials(name: string | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function NavGroup({ label, items, expanded }: { label: string; items: NavItem[]; expanded: boolean }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <p className={`px-3 pt-4 pb-1 text-[11px] font-semibold tracking-[0.02em] text-ink-300 uppercase ${expanded ? '' : 'invisible h-4 py-0'}`}>{label}</p>
      {items.map((item) => (
        <SideLink key={item.to} item={item} expanded={expanded} />
      ))}
    </div>
  )
}

function SideLink({ item, expanded }: { item: NavItem; expanded: boolean }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={expanded ? undefined : item.label}
      className={({ isActive }) =>
        `flex h-10 items-center gap-2 rounded-sm text-sm font-medium whitespace-nowrap transition-colors ${expanded ? 'px-3' : 'justify-center'} ${
          isActive ? 'bg-brand-100 text-brand-800' : 'text-white hover:bg-brand-800'
        }`
      }
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden className="shrink-0" />
      <span className={expanded ? '' : 'sr-only'}>{item.label}</span>
    </NavLink>
  )
}

/** Finds pages, not records: it matches the menu the person can already see. */
function PageSearch({ pages }: { pages: NavItem[] }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  // the menu is open only for the page it was opened on, so navigating closes it without an effect
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === location.pathname
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value
    setOpenedOn(next ? location.pathname : null)
  }
  const term = query.trim().toLowerCase()
  const matches = term ? pages.filter((page) => page.label.toLowerCase().includes(term)) : []

  function go(to: string) {
    setQuery('')
    setOpen(false)
    navigate(to)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (matches[0]) go(matches[0].to)
  }

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="relative w-full max-w-sm"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
      <input
        type="search"
        aria-label="Search pages"
        placeholder="Search pages"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
        className="h-8 w-full rounded-sm border border-line bg-surface-subtle pr-3 pl-8 text-sm text-ink-900 transition-colors focus-visible:border-brand-600"
      />
      {open && term && (
        <ul className="absolute top-full right-0 left-0 z-40 mt-1 rounded-md border border-line bg-surface py-1 shadow-menu">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-700">No matching pages. Try Campaigns, Templates or Contact lists.</li>
          ) : (
            matches.map((page) => (
              <li key={page.to}>
                <button type="button" onClick={() => go(page.to)} className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-ink-900 transition-colors hover:bg-surface-subtle">
                  <page.icon size={16} strokeWidth={1.5} aria-hidden className="text-ink-700" />
                  {page.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </form>
  )
}

export function AppShell() {
  const { me, logout, can, has } = useAuth()
  const location = useLocation()
  const isXl = useMinWidth(BREAKPOINT.xl)
  const isMd = useMinWidth(BREAKPOINT.md)
  // xl and up: the rail is 256px unless the person collapsed it. Below xl it is 64px icon-only, and opening it
  // expands it over the content (never pushing it). Below md there is no rail until the menu button opens it.
  const [userCollapsed, setUserCollapsed] = useState(readCollapsed)
  // the menu is open only for the page it was opened on, so navigating closes it without an effect
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === location.pathname
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value
    setOpenedOn(next ? location.pathname : null)
  }
  const expanded = isXl ? !userCollapsed : open
  const overlay = open && !isXl
  const showRail = isMd || open
  const support = me?.support_session ?? null
  const enrolFirst = Boolean(me?.mfa_setup_required)
  const allowed = (item: NavItem) => !item.feature || has(item.feature)
  // support never manages users, roles, keys or security: the API refuses, so the menu does not offer it
  const showSettings = !enrolFirst && can('user.admin') && !support
  const engage = enrolFirst ? [] : ENGAGE.filter(allowed)
  const manage = enrolFirst ? [] : [...MANAGE.filter(allowed), ...(showSettings ? [SETTINGS] : [])]
  const overview = enrolFirst ? [] : [OVERVIEW]
  const pages = [...overview, ...engage, ...manage]
  const name = me?.principal.display_name ?? me?.principal.email

  useEffect(() => {
    if (!overlay) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpenedOn(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [overlay])

  // the token of someone who must enrol in MFA reaches nothing else: take them there instead of showing a page of errors
  if (enrolFirst && location.pathname !== SECURITY) return <Navigate to={SECURITY} replace />

  function toggle() {
    if (isXl) {
      setUserCollapsed((current) => {
        writeCollapsed(!current)
        return !current
      })
    } else {
      setOpen((current) => !current)
    }
  }

  const toggleLabel = !isMd ? 'Close navigation' : expanded ? 'Collapse navigation' : 'Expand navigation'
  const ToggleIcon = !isMd ? X : expanded ? ChevronsLeft : ChevronsRight
  const contentOffset = !isMd ? '' : isXl && !userCollapsed ? 'pl-64' : 'pl-16'

  return (
    <div className="cep-settle-in min-h-screen">
      {overlay && <div aria-hidden className="fixed inset-0 z-30 animate-fade-in bg-scrim" onClick={() => setOpen(false)} />}

      {showRail && (
        <aside aria-label="Sidebar" className={`fixed inset-y-0 left-0 z-40 flex flex-col overflow-y-auto border-r border-line bg-sidebar ${expanded ? 'w-64' : 'w-16'}`}>
          <div className={`flex h-14 shrink-0 items-center ${expanded ? 'justify-between px-4' : 'justify-center'}`}>
            <span className={`font-display text-xl font-bold tracking-[-0.03em] text-white ${expanded ? '' : 'sr-only'}`}>CEP</span>
            <button
              type="button"
              onClick={toggle}
              aria-label={toggleLabel}
              aria-expanded={isMd ? expanded : undefined}
              className="flex h-8 w-8 items-center justify-center rounded-sm text-white transition-colors hover:bg-brand-800"
            >
              <ToggleIcon size={20} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <nav aria-label="Main" className="flex flex-col gap-1 px-3 pb-3">
            {overview.map((item) => (
              <SideLink key={item.to} item={item} expanded={expanded} />
            ))}
            <NavGroup label="Engage" items={engage} expanded={expanded} />
            <NavGroup label="Manage" items={manage} expanded={expanded} />
          </nav>
        </aside>
      )}

      <div className={`flex min-h-screen min-w-0 flex-col ${contentOffset}`}>
        {support && <SupportBanner by={support.by} mode={support.mode} expiresAt={support.expires_at} onEnded={logout} />}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 md:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {!isMd && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open navigation"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-700 transition-colors hover:bg-line-subtle"
              >
                <Menu size={20} strokeWidth={1.5} aria-hidden />
              </button>
            )}
            <PageSearch pages={pages} />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-sm md:flex">
              <span className="text-ink-700">Tenant</span>
              <span className="rounded-sm bg-line-subtle px-2 py-0.5 font-semibold text-ink-900">{me?.tenant.code}</span>
              <span className="hidden text-ink-700 xl:inline">{me?.tenant.timezone}</span>
            </span>
            <UploadsIndicator />
            <button
              type="button"
              disabled
              aria-label="Notifications"
              title="Notifications are not available yet"
              className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-300"
            >
              <Bell size={20} strokeWidth={1.5} aria-hidden />
            </button>
            <Link to={SECURITY} title="Account security" className="hidden rounded-sm px-2 py-1 text-right leading-tight transition-colors hover:bg-surface-subtle lg:block">
              <p className="text-sm font-medium text-ink-900">{name}</p>
              <p className="text-xs text-ink-700">{me?.principal.email}</p>
            </Link>
            <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
              {initials(me?.principal.display_name)}
            </span>
            <button
              type="button"
              onClick={logout}
              className="h-8 shrink-0 rounded-sm border border-line px-3 text-sm font-medium whitespace-nowrap text-ink-700 transition-colors hover:bg-surface-subtle"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* 1440 up to ~2100px wide, then grows with the viewport so ultra-wide screens are not mostly gutter */}
        <main className="mx-auto w-full max-w-[clamp(1440px,68vw,2400px)] min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
