/**
 * A report, run: its rows in the grid, with what the run says (rows, time, freshness, truncated), Edit for whoever may,
 * Export CSV, and Delete for the owner. The grid is the first of the four views.
 */
import { Download, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { buttonDanger, buttonSecondary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { insightsApi, useDeleteReport, useReport, useRun } from '../api'
import { ResultGrid } from '../components/ResultGrid'
import { runWords } from '../components/resultWords'

export function ReportViewerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const report = useReport(id)
  const run = useRun(id, {})
  const remove = useDeleteReport()
  const [exporting, setExporting] = useState(false)

  async function exportCsv() {
    if (!id) return
    setExporting(true)
    try {
      const blob = await insightsApi.exportCsv(id)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${report.data?.name ?? 'report'}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      toast.failure(error, 'The export did not run')
    } finally {
      setExporting(false)
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="text-xs text-ink-800"><Link to="/insights/reports" className="text-brand-800 hover:underline">All Reports</Link> › {report.data.name}</p>
      <PageHeader
        title={report.data.name}
        description={info ? `${runWords(info)} · version ${report.data.version}` : report.data.description ?? undefined}
        actions={(
          <div className="flex items-center gap-2">
            <Tag tone="brand">Grid</Tag>
            {report.data.can_edit && <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/reports/${id}/edit`)}><Pencil size={16} strokeWidth={1.5} aria-hidden />Edit</button>}
            <button type="button" className={buttonSecondary} onClick={exportCsv} disabled={exporting || !info}><Download size={16} strokeWidth={1.5} aria-hidden />Export CSV</button>
            {report.data.can_edit && <button type="button" className={buttonDanger} onClick={deleteReport} disabled={remove.isPending}><Trash2 size={16} strokeWidth={1.5} aria-hidden />Delete</button>}
          </div>
        )}
      />
      {run.isPending ? (
        <Spinner label="Running the report" />
      ) : refused ? (
        <ErrorState title={refused.problem?.title ?? 'The report did not run'} detail={refused.problem?.detail} onRetry={() => run.refetch()} />
      ) : run.isError ? (
        <ErrorState error={run.error} onRetry={() => run.refetch()} />
      ) : (
        <ResultGrid result={run.data} />
      )}
    </div>
  )
}
