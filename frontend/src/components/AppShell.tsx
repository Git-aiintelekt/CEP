import { useMutation } from '@tanstack/react-query'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { Feature } from '@/lib/types'

const NAV: { to: string; label: string; end?: boolean; feature?: Feature }[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/contact-lists', label: 'Contact lists' },
  { to: '/templates', label: 'Templates' },
  { to: '/journeys', label: 'Journeys', feature: 'journeys' },
]

const SECURITY = '/account/security'

/** Shown for as long as platform support is acting as this user: never subtle, and always one click from ending. */
function SupportBanner({ by, mode, expiresAt, onEnded }: { by: string; mode: 'READ' | 'WRITE'; expiresAt: string; onEnded: () => void }) {
  const end = useMutation({ mutationFn: () => api.post('/auth/support-session/end/'), onSettled: onEnded })
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950 md:px-8">
      <p>
        Support session: {by} is acting as this user · {mode === 'WRITE' ? 'changes are allowed and recorded' : 'read-only'} · ends {formatDateTime(expiresAt)}
      </p>
      <button type="button" disabled={end.isPending} onClick={() => end.mutate()} className="rounded-lg bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60">
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

export function AppShell() {
  const { me, logout, can, has } = useAuth()
  const location = useLocation()
  const support = me?.support_session ?? null
  const enrolFirst = Boolean(me?.mfa_setup_required)
  const visible = NAV.filter((item) => !item.feature || has(item.feature))
  // support never manages users, roles, keys or security: the API refuses, so the menu does not offer it
  const nav = enrolFirst ? [] : can('user.admin') && !support ? [...visible, { to: '/settings', label: 'Settings', end: false }] : visible
  const name = me?.principal.display_name ?? me?.principal.email

  // the token of someone who must enrol in MFA reaches nothing else: take them there instead of showing a page of errors
  if (enrolFirst && location.pathname !== SECURITY) return <Navigate to={SECURITY} replace />

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-line bg-surface md:w-60 md:shrink-0 md:border-r">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            C
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-ink-900">CEP</p>
            <p className="text-xs text-ink-500">Customer Engagement</p>
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {support && <SupportBanner by={support.by} mode={support.mode} expiresAt={support.expires_at} onEnded={logout} />}
        <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 md:px-8">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-500">Tenant</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-ink-900">{me?.tenant.code}</span>
            <span className="hidden text-ink-500 sm:inline">{me?.tenant.timezone}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to={SECURITY} title="Account security" className="hidden rounded-lg px-2 py-1 text-right leading-tight hover:bg-slate-50 sm:block">
              <p className="text-sm font-medium text-ink-900">{name}</p>
              <p className="text-xs text-ink-500">{me?.principal.email}</p>
            </Link>
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
            >
              {initials(me?.principal.display_name)}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
