import { useMutation, useQuery } from '@tanstack/react-query'
import { Bell, ChevronsLeft, ChevronsRight, Keyboard, Menu, Search, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { UploadsIndicator } from '@/features/contact-lists/UploadsIndicator'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { SearchResults } from '@/lib/types'
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
      <button type="button" disabled={end.isPending} onClick={() => end.mutate()} className="h-8 rounded-control-md bg-ink-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-ink-800 disabled:bg-fill-subtle disabled:text-ink-300">
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

const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: '/', does: 'Search campaigns, lists, templates and pages' },
  { keys: 'n', does: 'Create a campaign' },
  { keys: 'g then c', does: 'Go to Campaigns' },
  { keys: 'g then t', does: 'Go to Templates' },
  { keys: 'g then l', does: 'Go to Contact lists' },
  { keys: 'g then h', does: 'Go to Home' },
  { keys: '?', does: 'Show these shortcuts' },
  { keys: 'Esc', does: 'Close a menu or a pop-up' },
]
const GO: Record<string, string> = { c: '/campaigns', t: '/templates', l: '/contact-lists', h: '/' }

/** typing in a field, or holding a modifier, is never a shortcut */
function typingIn(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable || Boolean(element.closest('[role="dialog"]'))
}

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-menu" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id="shortcuts-title" className="font-display text-card-title font-semibold text-ink-900">Keyboard Shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-control-md text-ink-800 hover:bg-fill-subtle"><X size={16} strokeWidth={1.5} aria-hidden /></button>
        </div>
        <dl className="divide-y divide-line-subtle text-sm">
          {SHORTCUTS.map((item) => (
            <div key={item.keys} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-ink-800">{item.does}</dt>
              <dd className="cep-num shrink-0 rounded-sm border border-line bg-surface-subtle px-1.5 py-0.5 text-xs font-semibold text-ink-900">{item.keys}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-800">Shortcuts pause while you type in a field.</p>
      </div>
    </div>
  )
}

/** Finds records and pages: campaigns, contact lists and templates by name, and the menu the person can already see. */
function GlobalSearch({ pages, inputRef }: { pages: NavItem[]; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === location.pathname
  const setOpen = (value: boolean) => setOpenedOn(value ? location.pathname : null)
  const term = query.trim().toLowerCase()
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term), 220)
    return () => window.clearTimeout(timer)
  }, [term])
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => api.get<SearchResults>('/search/', { q: debounced }, signal),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  })
  const pageMatches = term ? pages.filter((page) => page.label.toLowerCase().includes(term)) : []
  const found = results.data && results.data.q === debounced ? results.data : null
  const rows: { key: string; kind: string; label: string; meta?: string; to: string; icon?: LucideIcon }[] = [
    ...(found?.campaigns ?? []).map((item) => ({ key: `c-${item.id}`, kind: 'Campaign', label: item.name, meta: `${item.status_label}${item.code ? ` · ${item.code}` : ''}`, to: item.setup_complete ? `/campaigns/${item.id}` : `/campaigns/${item.id}/edit` })),
    ...(found?.lists ?? []).map((item) => ({ key: `l-${item.id}`, kind: 'Contact list', label: item.name, meta: `${item.member_count.toLocaleString()} contacts`, to: `/contact-lists/${item.id}` })),
    ...(found?.templates ?? []).map((item) => ({ key: `t-${item.id}`, kind: 'Template', label: item.name, meta: item.channel, to: `/templates/${item.id}` })),
    ...pageMatches.map((page) => ({ key: `p-${page.to}`, kind: 'Page', label: page.label, to: page.to, icon: page.icon })),
  ]
  const searching = open && term.length >= 2 && (results.isPending || debounced !== term)

  function go(to: string) {
    setQuery('')
    setOpen(false)
    navigate(to)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (rows[0]) go(rows[0].to)
  }

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="relative w-full max-w-md"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-800" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search"
        placeholder="Search campaigns, lists, templates  /"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); (event.target as HTMLInputElement).blur() }
        }}
        className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 transition-colors focus:bg-surface focus-visible:border-brand-600"
      />
      {open && term && (
        <ul aria-label="Search results" className="absolute top-full right-0 left-0 z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-menu">
          {rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-800">{searching ? 'Searching' : term.length < 2 ? 'Type two characters or more.' : 'Nothing matches. Try a campaign, list or template name, or a page such as Settings.'}</li>
          ) : (
            rows.map((row) => (
              <li key={row.key}>
                <button type="button" onClick={() => go(row.to)} className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-ink-900 transition-colors hover:bg-surface-subtle">
                  {row.icon ? <row.icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" /> : <span className="w-16 shrink-0 text-xs text-ink-800">{row.kind}</span>}
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.meta && <span className="shrink-0 truncate text-xs text-ink-800">{row.meta}</span>}
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
  const allowed = (item: NavItem) => (!item.feature || has(item.feature)) && (!item.permission || can(item.permission))
  // support never manages users, roles, keys or security: the API refuses, so the menu does not offer it
  const showSettings = !enrolFirst && can('user.admin') && !support
  const main = enrolFirst ? [] : MAIN_NAV.filter(allowed)
  const admin = showSettings ? [SETTINGS] : []
  const pages = [...main, ...admin]
  const labels = useLabelsAfterWidth(expanded)
  const name = me?.principal.display_name ?? me?.principal.email
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const canCreate = can('campaign.edit')

  // the shortcuts: single keys, never while typing, never with a modifier held
  useEffect(() => {
    let pendingGo: number | null = null
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typingIn(event.target)) return
      if (pendingGo !== null) {
        window.clearTimeout(pendingGo)
        pendingGo = null
        const to = GO[event.key]
        if (to) { event.preventDefault(); navigate(to); return }
      }
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (event.key === 'n' && canCreate) { event.preventDefault(); navigate('/campaigns/new') }
      else if (event.key === '?') { event.preventDefault(); setHelpOpen((was) => !was) }
      else if (event.key === 'g') { pendingGo = window.setTimeout(() => { pendingGo = null }, 1500) }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); if (pendingGo !== null) window.clearTimeout(pendingGo) }
  }, [navigate, canCreate])

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
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md text-ink-800 transition-colors hover:bg-fill-subtle"
              >
                <Menu size={20} strokeWidth={1.5} aria-hidden />
              </button>
            )}
            <GlobalSearch pages={pages} inputRef={searchRef} />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-sm md:flex">
              <span className="text-ink-800">Tenant</span>
              <span className="rounded-sm bg-fill-subtle px-2 py-0.5 font-semibold text-ink-900">{me?.tenant.code}</span>
              <span className="hidden text-ink-800 xl:inline">{me?.tenant.timezone}</span>
            </span>
            <UploadsIndicator />
            <button type="button" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"
              className="hidden h-8 w-8 items-center justify-center rounded-control-md text-ink-800 transition-colors hover:bg-fill-subtle md:flex">
              <Keyboard size={20} strokeWidth={1.5} aria-hidden />
            </button>
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
              <p className="text-xs text-ink-800">{me?.principal.email}</p>
            </Link>
            <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
              {initials(me?.principal.display_name)}
            </span>
            <button
              type="button"
              onClick={logout}
              className="h-8 shrink-0 rounded-control-md border border-line px-3 text-sm font-medium whitespace-nowrap text-ink-800 transition-colors hover:bg-surface-subtle"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* same side padding as the header and no width cap, so content lines up with the search bar and Sign out */}
        <main className="w-full min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">
          <Outlet />
        </main>
      </div>
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
