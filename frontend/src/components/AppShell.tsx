import { useMutation } from '@tanstack/react-query'
import { Bell, ChevronsLeft, ChevronsRight, Menu, Search, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { UploadsIndicator } from '@/features/contact-lists/UploadsIndicator'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'
import { MAIN_NAV, SETTINGS, type NavItem } from './navItems'
import { RailGroup, RailMark } from './Rail'

const SECURITY = '/account/security'
const RAIL_EXPANDED = 240
const RAIL_COLLAPSED = 64

/**
 * Labels leave at the start of a collapse and come back at the end of an expand (240ms, the width's own
 * transition), so text never squeezes while the rail moves. With reduced motion they follow at once.
 */
function useLabelsAfterWidth(expanded: boolean): boolean {
  const [ready, setReady] = useState(expanded)
  useEffect(() => {
    if (!expanded) return
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setReady(true), reduced ? 0 : 240)
    return () => {
      window.clearTimeout(timer)
      setReady(false)
    }
  }, [expanded])
  return expanded && ready
}
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
      <button type="button" disabled={end.isPending} onClick={() => end.mutate()} className="h-8 rounded-control-md bg-ink-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-ink-700 disabled:bg-line-subtle disabled:text-ink-300">
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
        className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 transition-colors focus:bg-surface focus-visible:border-brand-600"
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
  // xl and up: the rail is 240px unless the person collapsed it. Below xl it is 64px icon-only, and opening it
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
  const main = enrolFirst ? [] : MAIN_NAV.filter(allowed)
  const admin = showSettings ? [SETTINGS] : []
  const pages = [...main, ...admin]
  const labels = useLabelsAfterWidth(expanded)
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
  const contentOffset = !isMd ? '' : isXl && !userCollapsed ? 'pl-60' : 'pl-16'

  return (
    <div className="cep-settle-in min-h-screen">
      {overlay && <div aria-hidden className="fixed inset-0 z-30 animate-fade-in bg-scrim" onClick={() => setOpen(false)} />}

      {showRail && (
        <>
          <aside aria-label="Sidebar"
            className={`fixed inset-y-0 left-0 z-40 flex flex-col overflow-x-hidden overflow-y-auto bg-sidebar py-5 transition-[width] duration-moderate ease-standard motion-reduce:transition-none ${expanded ? 'w-60' : 'w-16'}`}>
            <div className="mb-8 shrink-0 px-4"><RailMark expanded={labels} /></div>
            <nav aria-label="Main" className="flex flex-col px-3">
              <RailGroup label="Pages" items={main} expanded={labels} />
              <RailGroup label="Administration" items={admin} expanded={labels} divided={main.length > 0} />
            </nav>
          </aside>
          <button
            type="button"
            onClick={toggle}
            aria-label={toggleLabel}
            aria-expanded={isMd ? expanded : undefined}
            style={{ left: (expanded ? RAIL_EXPANDED : RAIL_COLLAPSED) - 16 }}
            className="fixed top-5 z-50 flex h-8 w-8 items-center justify-center rounded-sm border border-sidebar-divider bg-sidebar text-sidebar-text transition-[left,background-color] duration-moderate ease-standard outline-none hover:bg-sidebar-hover hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-accent active:bg-sidebar-pressed motion-reduce:transition-none"
          >
            <ToggleIcon size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </>
      )}

      <div className={`flex min-h-screen min-w-0 flex-col transition-[padding] duration-moderate ease-standard motion-reduce:transition-none ${contentOffset}`}>
        {support && <SupportBanner by={support.by} mode={support.mode} expiresAt={support.expires_at} onEnded={logout} />}
        {/* stays put while the page scrolls under it, like the rail: search and the account are always one reach away */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 md:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {!isMd && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open navigation"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md text-ink-700 transition-colors hover:bg-line-subtle"
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
              className="flex h-8 w-8 items-center justify-center rounded-control-md text-ink-300"
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
              className="h-8 shrink-0 rounded-control-md border border-line px-3 text-sm font-medium whitespace-nowrap text-ink-700 transition-colors hover:bg-surface-subtle"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* same side padding as the header and no width cap, so content lines up with the search bar and Sign out */}
        <main className="w-full min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
