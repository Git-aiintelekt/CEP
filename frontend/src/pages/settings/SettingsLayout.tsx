import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState } from '@/components/States'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Feature, Workspace } from '@/lib/types'

const TABS: { to: string; label: string; feature?: Feature }[] = [
  { to: '/settings/users', label: 'Users' },
  { to: '/settings/roles', label: 'Roles' },
  { to: '/settings/api-keys', label: 'API keys', feature: 'api_access' },
  { to: '/settings/plan', label: 'Plan & usage' },
  { to: '/settings/security', label: 'Security' },
  { to: '/settings/email', label: 'Email server' },
  { to: '/settings/delivery', label: 'Sending engines' },
]

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">{value}</dd>
    </div>
  )
}

export function SettingsLayout() {
  const { can, has } = useAuth()
  const allowed = can('user.admin')
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: ({ signal }) => api.get<Workspace>('/workspace/', undefined, signal), enabled: allowed })

  if (!allowed) {
    return <ErrorState title="Settings are for workspace administrators" error={new Error('Ask someone with the user.admin permission to make this change, or to give you an administrator role.')} />
  }

  const data = workspace.data
  return (
    <section>
      <PageHeader title="Settings" description="Who can sign in to this workspace, what they may do, and which systems may call the API." />
      {data && (
        <dl className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-5">
          <Fact label="Workspace" value={`${data.name} (${data.code})`} />
          <Fact label="Plan" value={data.plan ?? 'No plan'} />
          <Fact label="Active users" value={data.max_users ? `${formatNumber(data.active_users)} of ${formatNumber(data.max_users)}` : formatNumber(data.active_users)} />
          <Fact label="Time zone" value={data.timezone} />
          <Fact label="Active API keys" value={formatNumber(data.active_api_keys)} />
        </dl>
      )}
      <nav aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line whitespace-nowrap">
        {TABS.filter((tab) => !tab.feature || has(tab.feature)).map((tab) => (
          <NavLink key={tab.to} to={tab.to} className={({ isActive }) =>
            `-mb-px border-b-2 px-4 py-2 text-sm font-medium ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  )
}
