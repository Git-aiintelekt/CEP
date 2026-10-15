/**
 * A dashboard, viewed: its rows of tiles on its period. The period and the comparison can be switched here for a look,
 * unsaved; Edit opens the editor for whoever may; Delete is the owner's.
 */
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { buttonDanger, buttonSecondary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { dashboardsApi, keys, useDashboard, useDeleteDashboard } from '../api'
import { DashboardBody } from '../dashboards/DashboardBody'
import { periodWords, tiles } from '../dashboards/layout'
import { PeriodBar } from '../dashboards/PeriodBar'
import type { Period } from '../types'

export function DashboardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const dashboard = useDashboard(id)
  const remove = useDeleteDashboard()
  const [period, setPeriod] = useState<Period | null>(null)
  const [compare, setCompare] = useState<boolean | null>(null)

  function deleteDashboard() {
    if (!id || !window.confirm(`Delete “${dashboard.data?.name}”? Its tiles go with it; the reports stay.`)) return
    remove.mutate(id, { onSuccess: () => navigate('/insights/dashboards', { replace: true }), onError: (error) => toast.failure(error, 'The dashboard was not deleted') })
  }

  if (dashboard.isPending) return <Spinner label="Loading the dashboard" />
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
  const data = dashboard.data
  const shownPeriod = period ?? data.period
  const shownCompare = compare ?? data.compare
  const saved = period === null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="text-xs text-ink-800"><Link to="/insights/dashboards" className="text-brand-800 hover:underline">Dashboards</Link> › {data.name}</p>
      <PageHeader title={data.name} description={data.description ?? `${tiles(data.layout).length} tile${tiles(data.layout).length === 1 ? '' : 's'} · ${periodWords(data.bounds)}`}
        actions={(
          <div className="flex items-center gap-2">
            {data.can_edit && <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/dashboards/${id}/edit`)}><Pencil size={16} strokeWidth={1.5} aria-hidden />Edit</button>}
            {data.can_edit && <button type="button" className={buttonDanger} onClick={deleteDashboard} disabled={remove.isPending}><Trash2 size={16} strokeWidth={1.5} aria-hidden />Delete</button>}
          </div>
        )} />
      <PeriodBar period={shownPeriod} onPeriod={setPeriod} compare={shownCompare} onCompare={setCompare} bounds={saved ? data.bounds : undefined} />
      {tiles(data.layout).length === 0 ? (
        <EmptyState title="Nothing on This Dashboard Yet" hint={data.can_edit ? 'Edit it and add a tile: one of your reports in its view, or one of its numbers as a figure.' : 'Its owner has not added a tile yet.'}
          action={data.can_edit ? <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/dashboards/${id}/edit`)}>Edit</button> : undefined} />
      ) : (
        <DashboardBody layout={data.layout} period={shownPeriod} compare={shownCompare} keyPrefix={keys.tiles(id as string)}
          load={(tile, p, c) => dashboardsApi.runTile(id as string, tile.id, { period: p, compare: c })} />
      )}
    </div>
  )
}
