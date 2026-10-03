import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ErrorState } from '@/components/States'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Workspace } from '@/lib/types'

import { SettingsMenu } from './SettingsMenu'
import { groupOf, pageAt } from './settingsCatalogue'

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-ink-900">{value}</dd>
    </div>
  )
}

const TrailChevron = () => <ChevronRight size={14} strokeWidth={1.5} aria-hidden className="text-ink-300" />

/** "Settings › Sending › Sending Engines": where in the menu the page sits */
function Trail({ path }: { path: string }) {
  const page = pageAt(path)
  const group = groupOf(path)
  if (!page || !group) return null
  return (
    <nav aria-label="Where you are" className="flex items-center gap-1.5 text-helper text-ink-800">
      <span>Settings</span><TrailChevron /><span>{group.label}</span><TrailChevron /><span aria-current="page" className="font-semibold text-ink-900">{page.label}</span>
    </nav>
  )
}

/** Settings: the menu bar across the top (the pages in their groups), the page below it with the workspace's facts in a column on the right. */
export function SettingsLayout() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const allowed = can('user.admin')
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: ({ signal }) => api.get<Workspace>('/workspace/', undefined, signal), enabled: allowed })

  if (!allowed) {
    return <ErrorState title="Settings are for workspace administrators" error={new Error('Ask someone with the user.admin permission to make this change, or to give you an administrator role.')} />
  }

  const data = workspace.data
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h1 className="font-display text-page-title font-semibold text-ink-900">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-800">Who can sign in to this workspace, what they may do, and which systems may call the API.</p>
      </div>
      <SettingsMenu />
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_232px]">
        <section aria-label="Settings page" className="flex min-w-0 flex-col gap-4">
          <Trail path={pathname} />
          <Outlet />
        </section>
        {data && (
          <aside aria-label="Workspace facts" className="rounded-lg border border-line bg-surface px-4 py-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5 xl:grid-cols-1 xl:gap-y-4">
              <Fact label="Workspace" value={`${data.name} (${data.code})`} />
              <Fact label="Plan" value={data.plan ?? 'No plan'} />
              <Fact label="Active Users" value={data.max_users ? `${formatNumber(data.active_users)} of ${formatNumber(data.max_users)}` : formatNumber(data.active_users)} />
              <Fact label="Time Zone" value={data.timezone} />
              <Fact label="Active API Keys" value={formatNumber(data.active_api_keys)} />
            </dl>
          </aside>
        )}
      </div>
    </div>
  )
}
