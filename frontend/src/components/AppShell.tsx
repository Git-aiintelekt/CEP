import { useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { LegalFooter } from '@/components/LegalFooter'
import { UploadsIndicator } from '@/features/contact-lists/UploadsIndicator'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'
import { LeftNav } from '@/shell/LeftNav'
import { componentAt, entitled, type EntitledComponent } from '@/shell/manifests'
import { TopBar } from '@/shell/TopBar'
import { SETTINGS, type NavItem } from './navItems'
import { useToast } from './Toast'

const SECURITY = '/account/security'

/**
 * Labels leave at the start of a collapse and come back at the end of an expand (240ms, the width's own
 * transition), so text never squeezes while the navigation moves. With reduced motion they follow at once.
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
    /* blocked storage: the navigation simply opens expanded next time */
  }
}

/** Shown for as long as platform support is acting as this user: never subtle, and always one click from ending. */
function SupportBanner({ by, mode, expiresAt, onEnded }: { by: string; mode: 'READ' | 'WRITE'; expiresAt: string; onEnded: () => void }) {
  const toast = useToast()
  const end = useMutation({
    mutationFn: () => api.post('/auth/support-session/end/'),
    onSuccess: onEnded,
    // a session that already ended (401) is over either way; any other failure leaves it running, and says so
    onError: (error) => (error instanceof ApiError && error.status === 401 ? onEnded() : toast.failure(error, 'The support session was not ended')),
  })
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 bg-warning px-4 py-2 text-sm font-medium text-on-warning md:px-8">
      <p>
        Support session: {by} is acting as this user · {mode === 'WRITE' ? 'changes are allowed and recorded' : 'read-only'} · ends {formatDateTime(expiresAt)}
      </p>
      <button type="button" disabled={end.isPending} onClick={() => end.mutate()} className="h-8 rounded-control-md bg-toast px-3 text-xs font-semibold text-on-brand transition-colors hover:bg-toast/85 disabled:bg-fill-subtle disabled:text-ink-300">
        End session
      </button>
    </div>
  )
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
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface-overlay p-5 shadow-menu" onClick={(event) => event.stopPropagation()}>
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

/**
 * The suite shell: the top bar (launcher, brand, search, account), the left navigation by component, and the page.
 * xl and up: the navigation is 240px unless the person collapsed it. Below xl it is 64px icon-only, and opening it
 * expands it over the page (never pushing it). Below md there is no navigation until the menu button opens it.
 */
export function AppShell() {
  const { me, logout, can, has } = useAuth()
  const location = useLocation()
  const isXl = useMinWidth(BREAKPOINT.xl)
  const isMd = useMinWidth(BREAKPOINT.md)
  const [userCollapsed, setUserCollapsed] = useState(readCollapsed)
  // the overlay is open only for the page it was opened on, so navigating closes it without an effect
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === location.pathname
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value
    setOpenedOn(next ? location.pathname : null)
  }
  const expanded = isXl ? !userCollapsed : open
  const overlay = open && !isXl
  const showNav = isMd || open
  const support = me?.support_session ?? null
  const enrolFirst = Boolean(me?.mfa_setup_required)
  const allowed = (item: NavItem) => (!item.feature || has(item.feature)) && (!item.permission || can(item.permission))
  // support never manages users, roles, keys or security: the API refuses, so the menu does not offer it
  const showSettings = !enrolFirst && can('user.admin') && !support
  const components: EntitledComponent[] = enrolFirst ? [] : entitled(me).map((component) => ({ ...component, menu: component.menu.filter(allowed) }))
  const current = componentAt(location.pathname, components)
  const settings = showSettings ? { ...SETTINGS, label: 'Workspace Settings' } : null
  const pages = [...(current?.menu ?? []), ...(settings ? [settings] : [])]
  const labels = useLabelsAfterWidth(expanded)
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

  const contentOffset = !isMd ? '' : isXl && !userCollapsed ? 'pl-60' : 'pl-16'

  return (
    <div className="cep-settle-in min-h-screen bg-canvas">
      {overlay && <div aria-hidden className="fixed inset-0 z-30 animate-fade-in bg-scrim" onClick={() => setOpen(false)} />}

      {showNav && (
        <aside aria-label="Sidebar"
          className={`fixed inset-y-0 left-0 z-40 flex flex-col overflow-x-hidden overflow-y-auto bg-sidebar pb-4 transition-[width] duration-moderate ease-standard motion-reduce:transition-none ${expanded ? 'w-60' : 'w-16'} pt-3`}>
          <nav aria-label="Main" className={`flex min-h-0 flex-1 flex-col ${labels ? 'px-3' : 'items-center px-0'}`}>
            <LeftNav
              components={components}
              current={current}
              expanded={labels}
              workspace={me?.workspace}
              settings={settings}
              toggle={{ kind: !isMd ? 'close' : expanded ? 'collapse' : 'expand', onClick: toggle }}
              onNavigate={overlay ? () => setOpen(false) : undefined}
            />
          </nav>
        </aside>
      )}

      <div className={`flex min-h-screen min-w-0 flex-col transition-[padding] duration-moderate ease-standard motion-reduce:transition-none ${contentOffset}`}>
        {support && <SupportBanner by={support.by} mode={support.mode} expiresAt={support.expires_at} onEnded={logout} />}
        <TopBar
          me={me}
          components={components}
          current={current}
          pages={pages}
          searchRef={searchRef}
          onOpenNav={!isMd ? () => setOpen(true) : undefined}
          onHelp={() => setHelpOpen(true)}
          onLogout={logout}
          extra={<UploadsIndicator />}
        />
        {/* same side padding as the top bar's search and account, and no width cap, so content lines up with them */}
        <main className="flex w-full min-w-0 flex-1 flex-col bg-canvas px-4 py-5 md:px-8 md:py-6">
          <div className="flex-1"><Outlet /></div>
          <LegalFooter variant="bar" />
        </main>
      </div>
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
