/**
 * A report, run: its rows in the saved view, with what the run says (rows, time, freshness, truncated), Edit for whoever
 * may, Export CSV, and Delete for the owner. The view can be switched here for a look; the editor saves the choice. In the
 * chart, a click on a bar, a slice or a stage drills one level down (the report's next dimension, or a date's next
 * bucket); the drill path above it goes back up. Switching the view leaves the drill.
 */
import { CalendarClock, Download, FileSpreadsheet, FileText, History, Pencil, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { buttonDanger, buttonSecondary } from '@/components/Form'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useAuth } from '@/auth/AuthContext'
import { insightsApi, keys, useDeleteReport, useReport, useRun, useSchedules, useVersions } from '../api'
import { FolderSelect } from '../components/FolderSelect'
import { ScheduleBanner } from '../components/ScheduleBanner'
import { ScheduleDialog } from '../components/ScheduleDialog'
import { VersionsDrawer } from '../components/VersionsDrawer'
import { canDrill, deeper } from '../components/drill'
import { DrillBar } from '../components/DrillBar'
import { DEFAULT_VIEW, ReportResult, ViewBar } from '../components/ReportViews'
import { runWords } from '../components/resultWords'
import type { DrillStep, ReportView } from '../types'

export function ReportViewerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const report = useReport(id)
  const [view, setViewOnly] = useState<ReportView | null>(null)
  const [path, setPath] = useState<DrillStep[]>([])
  const setView = (next: ReportView | null) => { setViewOnly(next); if (next?.type !== 'chart') setPath([]) }
  const askedView = view ?? report.data?.definition.view
  const charted = (askedView?.type ?? 'grid') === 'chart'
  const run = useRun(report.data ? id : undefined, askedView && (askedView.type === 'pivot' || askedView.type === 'hierarchy') ? { view: { type: askedView.type, across: askedView.across } }
    : charted && path.length ? { drill: { path } } : {})
  const remove = useDeleteReport()
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const { can, me } = useAuth()
  const [scheduling, setScheduling] = useState(false)
  const schedules = useSchedules({ item: id })
  const schedule = schedules.data?.schedules[0] ?? null

  const [shownVersion, setShownVersion] = useState<number | null>(null)
  const versions = useVersions(versionsOpen || shownVersion !== null ? id : undefined)
  const old = shownVersion === null ? null : versions.data?.versions.find((v) => v.version === shownVersion) ?? null
  const oldRun = useQuery({
    queryKey: ['insights', 'version-run', id, shownVersion],
    queryFn: () => insightsApi.preview({ dataset: report.data?.dataset as string, definition: old?.definition as never, ...(view ? { view } : {}) }),
    enabled: Boolean(old && report.data),
    retry: false,
  })
  const client = useQueryClient()
  const file = useMutation({
    mutationFn: (folderId: string | null) => insightsApi.update(id as string, { row_version: report.data?.row_version as number, folder_id: folderId }),
    onSuccess: (saved) => {
      client.setQueryData(keys.report(id as string), { ...saved, can_edit: true })
      client.invalidateQueries({ queryKey: ['insights', 'reports'] })
      client.invalidateQueries({ queryKey: keys.folders })
    },
    onError: (error) => toast.failure(error, 'The report was not moved'),
  })

  async function exportAs(kind: 'csv' | 'xlsx' | 'pdf') {
    if (!id) return
    setExporting(kind)
    try {
      const blob = await (kind === 'csv' ? insightsApi.exportCsv(id) : kind === 'pdf' ? insightsApi.exportPdf(id) : insightsApi.exportXlsx(id))
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${report.data?.name ?? 'report'}.${kind}`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      toast.failure(error, 'The export did not run')
    } finally {
      setExporting(null)
    }
  }

  function deleteReport() {
    if (!id || !window.confirm(`Delete “${report.data?.name}”? Its versions go with it.`)) return
    remove.mutate(id, { onSuccess: () => navigate('/insights/reports', { replace: true }), onError: (error) => toast.failure(error, 'The report was not deleted') })
  }

  if (report.isPending) return <Spinner label="Loading the report" />
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />
  const info = run.data
  const refused = run.error instanceof ApiError && run.error.status === 422 ? run.error : null
  const shownView = view ?? (old ? old.definition.view : report.data.definition.view) ?? DEFAULT_VIEW

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="text-xs text-ink-800"><Link to="/insights/reports" className="text-brand-800 hover:underline">All Reports</Link> › {report.data.name}</p>
      <PageHeader
        help={<PageHelp chapter="insights" />}
        title={report.data.name}
        description={info ? `${runWords(info)} · version ${report.data.version}` : report.data.description ?? undefined}
        actions={(
          <div className="flex items-center gap-2">
            {report.data.can_edit && <FolderSelect value={report.data.folder_id} onChange={(folderId) => file.mutate(folderId)} disabled={file.isPending} />}
            <button type="button" className={buttonSecondary} onClick={() => setVersionsOpen(true)}><History size={16} strokeWidth={1.5} aria-hidden />Versions</button>
            {(can('report.edit') || can('report.admin')) && (
              <button type="button" className={buttonSecondary} onClick={() => setScheduling(true)}><CalendarClock size={16} strokeWidth={1.5} aria-hidden />{schedule ? `Scheduled · ${schedule.words}` : 'Schedule'}</button>
            )}
            {report.data.can_edit && <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/reports/${id}/edit`)}><Pencil size={16} strokeWidth={1.5} aria-hidden />Edit</button>}
            <button type="button" className={buttonSecondary} onClick={() => exportAs('csv')} disabled={exporting !== null || !info}><Download size={16} strokeWidth={1.5} aria-hidden />Export CSV</button>
            <button type="button" className={buttonSecondary} onClick={() => exportAs('xlsx')} disabled={exporting !== null || !info}><FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />Export Excel</button>
            <button type="button" className={buttonSecondary} onClick={() => exportAs('pdf')} disabled={exporting !== null || !info}><FileText size={16} strokeWidth={1.5} aria-hidden />Export PDF</button>
            {report.data.can_edit && <button type="button" className={buttonDanger} onClick={deleteReport} disabled={remove.isPending}><Trash2 size={16} strokeWidth={1.5} aria-hidden />Delete</button>}
          </div>
        )}
      />
      {schedule && <ScheduleBanner schedule={schedule} onChange={() => setScheduling(true)} />}
      {old && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">
          <span>Showing version {old.version} of {report.data.version}, as saved {formatDateTime(old.changed_at)}. The current version is not changed.</span>
          <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => setShownVersion(null)}>Back to Current</button>
        </div>
      )}
      {old ? (
        oldRun.isPending ? <Spinner label={`Running version ${old.version}`} /> : oldRun.isError ? <ErrorState error={oldRun.error} onRetry={() => oldRun.refetch()} /> : (
          <div className="flex flex-col gap-3">
            <ViewBar view={shownView} onChange={setView} columns={oldRun.data.columns} dimensions={[]} />
            <ReportResult result={oldRun.data} view={shownView} label={`Version ${old.version} rows`} />
          </div>
        )
      ) : run.isPending ? (
        <Spinner label="Running the report" />
      ) : refused ? (
        <ErrorState title={refused.problem?.title ?? 'The report did not run'} detail={refused.problem?.detail} onRetry={() => run.refetch()} />
      ) : run.isError ? (
        <ErrorState error={run.error} onRetry={() => run.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <ViewBar view={shownView} onChange={setView} columns={run.data.columns} dimensions={[]} />
          {shownView.type === 'chart' && run.data.drill && <DrillBar info={run.data.drill} onPath={setPath} />}
          <ReportResult result={run.data} view={shownView}
            onPick={shownView.type === 'chart' && canDrill(run.data.drill) ? (column, value) => { if (run.data?.drill && canDrill(run.data.drill, column)) setPath(deeper(run.data.drill, value)) } : undefined} />
        </div>
      )}
      {scheduling && <ScheduleDialog reportId={id as string} reportName={report.data.name} zone={me?.tenant.timezone ?? 'UTC'} existing={schedule} onClose={() => setScheduling(false)} onSaved={() => setScheduling(false)} />}
      {versionsOpen && <VersionsDrawer report={report.data} shown={shownVersion} canEdit={report.data.can_edit} onOpen={(v) => { setShownVersion(v); setView(null); if (v !== null) setVersionsOpen(false) }} onClose={() => setVersionsOpen(false)} />}
    </div>
  )
}
