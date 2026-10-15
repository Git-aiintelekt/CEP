/** Insights → Dashboards: every dashboard this person may open, with its tiles, owner, sharing and when it changed. New Dashboard makes an empty one and opens the editor. */
import { useMutation } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { dashboardsApi, useDashboards } from '../api'
import { FavouriteStar } from '../components/FavouriteStar'
import type { DashboardSummary } from '../types'

export function DashboardListPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const dashboards = useDashboards()
  const canCreate = can('report.edit') || can('report.admin')
  const create = useMutation({
    mutationFn: () => dashboardsApi.create({}),
    onSuccess: (dashboard) => navigate(`/insights/dashboards/${dashboard.id}/edit`),
    onError: (error) => toast.failure(error, 'The dashboard was not created'),
  })
  const rows = dashboards.data?.dashboards ?? []
  const starred = rows.filter((d) => d.favourite)
  const rest = rows.filter((d) => !d.favourite)
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboards" description="Pages of your reports, on one period."
        actions={canCreate ? <button type="button" className={buttonPrimary} onClick={() => create.mutate()} disabled={create.isPending}><Plus size={16} strokeWidth={1.5} aria-hidden />New Dashboard</button> : undefined} />
      {dashboards.isPending ? <Spinner label="Loading the dashboards" /> : dashboards.isError ? <ErrorState error={dashboards.error} onRetry={() => dashboards.refetch()} /> : rows.length === 0 ? (
        <EmptyState title="No Dashboards Yet" hint={canCreate ? 'Put your reports on one page, with one period for all of them. Start with New Dashboard.' : 'Nobody has shared a dashboard with the workspace yet.'} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm" aria-label="Dashboards">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                <th className="w-9 px-1 py-2"><span className="sr-only">Favourite</span></th><th className="px-3 py-2">Dashboard</th><th className="px-3 py-2">Tiles</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Shared</th><th className="px-3 py-2">Changed</th>
              </tr>
            </thead>
            <tbody>
              {starred.length > 0 && <Rows name="Favourites" dashboards={starred} />}
              <Rows name={starred.length > 0 ? 'All Dashboards' : undefined} dashboards={rest} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Rows({ name, dashboards }: { name?: string; dashboards: DashboardSummary[] }) {
  return (
    <>
      {name && <tr className="bg-surface-subtle"><th scope="rowgroup" colSpan={6} className="px-3 py-1.5 text-left text-sm font-semibold text-ink-900">{name} <span className="font-normal text-ink-800">{dashboards.length}</span></th></tr>}
      {dashboards.map((dashboard) => (
        <tr key={dashboard.id} className="border-t border-line-subtle">
          <td className="px-1 py-1.5 text-center"><FavouriteStar kind="dashboard" id={dashboard.id} name={dashboard.name} on={dashboard.favourite} /></td>
          <td className="px-3 py-2"><Link to={`/insights/dashboards/${dashboard.id}`} className="font-medium text-ink-900 hover:underline">{dashboard.name}</Link>{dashboard.description && <span className="block text-xs text-ink-800">{dashboard.description}</span>}</td>
          <td className="cep-num px-3 py-2 text-ink-800">{dashboard.tiles}</td>
          <td className="px-3 py-2 text-ink-800">{dashboard.owner_name ?? '\u2014'}</td>
          <td className="px-3 py-2">{dashboard.visibility === 'WORKSPACE' ? <Tag tone="brand">Workspace</Tag> : <Tag>Private</Tag>}</td>
          <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(dashboard.updated_at)}</td>
        </tr>
      ))}
    </>
  )
}
