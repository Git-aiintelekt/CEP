/**
 * A dashboard, viewed: its rows of tiles on its period. The period and the comparison can be switched here for a look,
 * unsaved; Edit opens the editor for whoever may; Delete is the owner's.
 */
import { CalendarClock, FileText, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { buttonDanger, buttonSecondary } from '@/components/Form'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { dashboardsApi, keys, useDashboard, useDeleteDashboard, useSchedules } from '../api'
import { ScheduleBanner } from '../components/ScheduleBanner'
import { ScheduleDialog } from '../components/ScheduleDialog'
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
  const { can, me } = useAuth()
  const [scheduling, setScheduling] = useState(false)
  const [exporting, setExporting] = useState(false)
  const schedules = useSchedules({ item: id })
  const schedule = schedules.data?.schedules[0] ?? null

  async function exportPdf() {
    if (!id) return
    setExporting(true)
    try {
      const blob = await dashboardsApi.exportPdf(id)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${dashboard.data?.name ?? 'dashboard'}.pdf`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      toast.failure(error, 'The export did not run')
    } finally {
      setExporting(false)
    }
  }

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
      <PageHeader help={<PageHelp chapter="insights" />} title={data.name} description={data.description ?? `${tiles(data.layout).length} tile${tiles(data.layout).length === 1 ? '' : 's'} · ${periodWords(data.bounds)}`}
        actions={(
          <div className="flex items-center gap-2">
            {(can('report.edit') || can('report.admin')) && (
              <button type="button" className={buttonSecondary} onClick={() => setScheduling(true)}><CalendarClock size={16} strokeWidth={1.5} aria-hidden />{schedule ? `Scheduled · ${schedule.words}` : 'Schedule'}</button>
            )}
            <button type="button" className={buttonSecondary} onClick={exportPdf} disabled={exporting || tiles(data.layout).length === 0}><FileText size={16} strokeWidth={1.5} aria-hidden />Export PDF</button>
            {data.can_edit && <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/dashboards/${id}/edit`)}><Pencil size={16} strokeWidth={1.5} aria-hidden />Edit</button>}
            {data.can_edit && <button type="button" className={buttonDanger} onClick={deleteDashboard} disabled={remove.isPending}><Trash2 size={16} strokeWidth={1.5} aria-hidden />Delete</button>}
          </div>
        )} />
      {schedule && <ScheduleBanner schedule={schedule} onChange={() => setScheduling(true)} />}
      <PeriodBar period={shownPeriod} onPeriod={setPeriod} compare={shownCompare} onCompare={setCompare} bounds={saved ? data.bounds : undefined} />
      {scheduling && <ScheduleDialog kind="dashboard" reportId={id as string} reportName={data.name} zone={me?.tenant.timezone ?? 'UTC'} existing={schedule} onClose={() => setScheduling(false)} onSaved={() => setScheduling(false)} />}
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
