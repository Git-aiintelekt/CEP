import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/contact-lists', label: 'Contact lists' },
  { to: '/templates', label: 'Templates' },
  { to: '/journeys', label: 'Journeys' },
]

function initials(name: string | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function AppShell() {
  const { me, logout } = useAuth()
  const name = me?.principal.display_name ?? me?.principal.email

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
          {NAV.map((item) => (
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
        <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 md:px-8">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-500">Tenant</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-ink-900">{me?.tenant.code}</span>
            <span className="hidden text-ink-500 sm:inline">{me?.tenant.timezone}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-ink-900">{name}</p>
              <p className="text-xs text-ink-500">{me?.principal.email}</p>
            </div>
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
