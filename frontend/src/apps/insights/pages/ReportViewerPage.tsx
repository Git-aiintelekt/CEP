/**
 * A report, run: its rows in the saved view, with what the run says (rows, time, freshness, truncated), Edit for whoever
 * may, Export CSV, and Delete for the owner. The view can be switched here for a look; the editor saves the choice. In the
 * chart, a click on a bar, a slice or a stage drills one level down (the report's next dimension, or a date's next
 * bucket); the drill path above it goes back up. Switching the view leaves the drill.
 */
import { Bell, CalendarClock, Code2, Download, FileSpreadsheet, FileText, History, Link2, Lock, MessageSquare, Pencil, Presentation, Printer, Share2, Sparkles, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { MenuRow } from '@/components/MenuRow'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useAuth } from '@/auth/AuthContext'
import { insightsApi, keys, usageApi, useAssistant, useCatalog, useComments, useDeleteReport, useReport, useRun, useSchedules, useVersions } from '../api'
import { ActionsMenu, MenuGap } from '../components/ActionsMenu'
import { AlertsDialog } from '../components/AlertsDialog'
import { CommentsDrawer } from '../components/CommentsDrawer'
import { ParameterBar } from '../components/ParameterBar'
import { PrintDialog } from '../components/PrintDialog'
import { EmbedDialog } from '../components/EmbedDialog'
import { ExplainPanel } from '../components/ExplainPanel'
import { SqlDialog } from '../components/SqlDialog'
import { ComponentSelect } from '../components/ComponentSelect'
import { FolderSelect } from '../components/FolderSelect'
import { ScheduleBanner } from '../components/ScheduleBanner'
import { ScheduleDialog } from '../components/ScheduleDialog'
import { VersionsDrawer } from '../components/VersionsDrawer'
import { canDrill, deeper, throughable } from '../components/drill'
import { DrillThroughMenu, type ThroughTarget } from '../components/DrillThroughMenu'
import { ShareDialog } from '../components/ShareDialog'
import { DrillBar } from '../components/DrillBar'
import { DEFAULT_VIEW, ReportResult, ViewBar } from '../components/ReportViews'
import { formatCell, runWords } from '../components/resultWords'
import { readAnswers, sentAnswers, unanswered } from '../editor/parameters'
import type { CommentAnchor, DrillStep, Explanation, ParameterValues, ReportView, ResultColumn } from '../types'

/** the values a report was opened through, from the address: [{field, value}] */
function readThrough(raw: string | null): { field: string; value: unknown }[] {
  try {
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.field === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const

export function ReportViewerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const report = useReport(id)
  const [params, setParams] = useSearchParams()
  const through = readThrough(params.get('through'))
  const asked = report.data?.definition.parameters ?? []
  const answers = readAnswers(params.get('ask'))
  const sent = asked.length ? sentAnswers(answers) : undefined
  const waiting = unanswered(asked, answers)
  const catalog = useCatalog()
  const askedFields = catalog.data?.datasets.find((d) => d.key === report.data?.dataset)?.fields ?? []
  const answer = (next: ParameterValues) => { const kept = new URLSearchParams(params); kept.set('ask', JSON.stringify(next)); setParams(kept) }
  const [sharing, setSharing] = useState(false)
  const [menu, setMenu] = useState<ThroughTarget | null>(null)
  const [view, setViewOnly] = useState<ReportView | null>(null)
  const [path, setPath] = useState<DrillStep[]>([])
  const setView = (next: ReportView | null) => { if (next?.type !== (view ?? report.data?.definition.view)?.type) setPath([]); setViewOnly(next) }
  const askedView = view ?? report.data?.definition.view
  const charted = (askedView?.type ?? 'grid') === 'chart'
  const tabled = askedView?.type === 'pivot' || askedView?.type === 'hierarchy'
  const page = {
    ...(askedView && tabled ? { view: { type: askedView.type, across: askedView.across } } : {}),
    ...(askedView && charted && (askedView.chart === 'kpi' || askedView.chart === 'gauge') ? { view: { type: 'chart' as const, chart: askedView.chart } } : {}),
    ...((charted || tabled) && path.length ? { drill: { path, ...(tabled ? { keep_rest: true } : {}) } } : {}),
    ...(through.length ? { through } : {}),
    ...(sent ? { params: sent } : {}),
  }
  const run = useRun(report.data && waiting.length === 0 ? id : undefined, page)
  const remove = useDeleteReport()
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | 'pptx' | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const { can, me } = useAuth()
  const [scheduling, setScheduling] = useState(false)
  const schedules = useSchedules({ item: id })
  const schedule = schedules.data?.schedules[0] ?? null
  const assistant = useAssistant()
  const explainer = assistant.data?.explain
  const [explaining, setExplaining] = useState(false)
  const explain = useMutation<Explanation, Error>({
    mutationFn: () => insightsApi.explain(id as string, { model: explainer?.model?.id, ...(path.length ? { drill: { path, ...(tabled ? { keep_rest: true } : {}) } } : {}), ...(sent ? { params: sent } : {}) }),
  })
  const [showSql, setShowSql] = useState(false)
  const [embedding, setEmbedding] = useState(false)
  useEffect(() => { if (id) usageApi.opened('report', id).catch(() => undefined) }, [id])
  const builder = can('report.edit') || can('report.admin')
  const comments = useComments('report', id)
  const [talking, setTalking] = useState<{ anchor: CommentAnchor | null } | null>(null)
  const [alerting, setAlerting] = useState(false)
  const [printing, setPrinting] = useState(false)
  const openComments = (comments.data?.comments ?? []).filter((c) => !c.resolved_at)
  const notes = openComments.filter((c) => c.anchor?.field && !c.anchor.tile_id).map((c) => ({ field: c.anchor!.field as string, value: c.anchor!.value, label: c.body.length > 80 ? `${c.body.slice(0, 79)}…` : c.body }))

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
  // Refresh: the report run again now, not the kept result (a workspace's own database is kept 15 minutes)
  const refresh = useMutation({
    mutationFn: () => insightsApi.run(id as string, { ...page, fresh: true }),
    onSuccess: (data) => client.setQueryData(keys.run(id ?? '', page), data),
  })
  const move = useMutation({
    mutationFn: (component: string | null) => insightsApi.update(id as string, { row_version: report.data?.row_version as number, component }),
    onSuccess: (saved) => {
      client.setQueryData(keys.report(id as string), { ...saved, can_edit: true })
      client.invalidateQueries({ queryKey: ['insights', 'reports'] })
    },
    onError: (error) => toast.failure(error, 'The report was not moved'),
  })
  const file = useMutation({
    mutationFn: (folderId: string | null) => insightsApi.update(id as string, { row_version: report.data?.row_version as number, folder_id: folderId }),
    onSuccess: (saved) => {
      client.setQueryData(keys.report(id as string), { ...saved, can_edit: true })
      client.invalidateQueries({ queryKey: ['insights', 'reports'] })
      client.invalidateQueries({ queryKey: keys.folders })
    },
    onError: (error) => toast.failure(error, 'The report was not moved'),
  })

  async function exportAs(kind: 'csv' | 'xlsx' | 'pdf' | 'pptx') {
    if (!id) return
    setExporting(kind)
    try {
      const blob = await (kind === 'csv' ? insightsApi.exportCsv(id, sent) : kind === 'pdf' ? insightsApi.exportPdf(id, sent) : kind === 'pptx' ? insightsApi.exportPptx(id, sent) : insightsApi.exportXlsx(id, sent))
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
    <div className="report-density flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-ink-800"><Link to="/insights/reports" className="text-brand-800 hover:underline">All Reports</Link> › {report.data.name}</p>
      <PageHeader
        help={<PageHelp chapter="insights" />}
        title={report.data.name}
        description={info ? <>{runWords(info)} · version {report.data.version} · <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending || run.isFetching}
          className="font-medium text-link hover:underline disabled:text-ink-700 disabled:no-underline">{refresh.isPending ? 'Refreshing…' : 'Refresh'}</button></> : report.data.description ?? undefined}
        actions={(
          <div className="flex items-center gap-2">
            {report.data.can_edit && <ComponentSelect inline value={report.data.component_key ?? null} auto={report.data.component_auto ?? null} onChange={(key) => move.mutate(key)} disabled={move.isPending} />}
            {report.data.can_edit && <FolderSelect value={report.data.folder_id} onChange={(folderId) => file.mutate(folderId)} disabled={file.isPending} />}
            <ActionsMenu>{(act) => (
                <>
                  <MenuRow role="menuitem" divider={false} leading={<Sparkles {...ICON} />} title="Explain" disabled={!info} onClick={() => act(() => setExplaining(true))} />
                  {report.data.can_edit && <MenuRow role="menuitem" divider={false} leading={<Pencil {...ICON} />} title="Edit" onClick={() => act(() => navigate(`/insights/reports/${id}/edit`))} />}
                  <MenuGap />
                  {report.data.can_share && <MenuRow role="menuitem" divider={false} leading={<Share2 {...ICON} />} title={report.data.shared ? 'Shared' : 'Share'} onClick={() => act(() => setSharing(true))} />}
                  <MenuRow role="menuitem" divider={false} leading={<MessageSquare {...ICON} />} title={openComments.length ? `Comments · ${openComments.length}` : 'Comments'} onClick={() => act(() => setTalking({ anchor: null }))} />
                  <MenuRow role="menuitem" divider={false} leading={<Bell {...ICON} />} title="Alerts" onClick={() => act(() => setAlerting(true))} />
                  {(can('report.edit') || can('report.admin')) && (
                    <MenuRow role="menuitem" divider={false} leading={<CalendarClock {...ICON} />} title={schedule ? `Scheduled · ${schedule.words}` : 'Schedule'} onClick={() => act(() => setScheduling(true))} />
                  )}
                  <MenuRow role="menuitem" divider={false} leading={<History {...ICON} />} title="Versions" onClick={() => act(() => setVersionsOpen(true))} />
                  <MenuGap />
                  <MenuRow role="menuitem" divider={false} leading={<Download {...ICON} />} title="Export CSV" disabled={exporting !== null || !info} onClick={() => act(() => void exportAs('csv'))} />
                  <MenuRow role="menuitem" divider={false} leading={<FileSpreadsheet {...ICON} />} title="Export Excel" disabled={exporting !== null || !info} onClick={() => act(() => void exportAs('xlsx'))} />
                  <MenuRow role="menuitem" divider={false} leading={<FileText {...ICON} />} title="Export PDF" disabled={exporting !== null || !info} onClick={() => act(() => void exportAs('pdf'))} />
                  <MenuRow role="menuitem" divider={false} leading={<Presentation {...ICON} />} title="Export PowerPoint" disabled={exporting !== null || !info} onClick={() => act(() => void exportAs('pptx'))} />
                  <MenuRow role="menuitem" divider={false} leading={<Printer {...ICON} />} title="Print-Ready PDF" disabled={!info} onClick={() => act(() => setPrinting(true))} />
                  {(builder || report.data.can_share) && <MenuGap />}
                  {builder && <MenuRow role="menuitem" divider={false} leading={<Code2 {...ICON} />} title="Show the SQL" onClick={() => act(() => setShowSql(true))} />}
                  {report.data.can_share && <MenuRow role="menuitem" divider={false} leading={<Link2 {...ICON} />} title="Embed on Another Site" onClick={() => act(() => setEmbedding(true))} />}
                  {report.data.can_edit && <>
                    <MenuGap />
                    <MenuRow role="menuitem" divider={false} tone="error" leading={<Trash2 {...ICON} className="text-danger-text" />} title="Delete" disabled={remove.isPending} onClick={() => act(deleteReport)} />
                  </>}
                </>
            )}</ActionsMenu>
          </div>
        )}
      />
      {schedule && <ScheduleBanner schedule={schedule} onChange={() => setScheduling(true)} />}
      {through.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">
          <span>Opened from {params.get('from') || 'another report'}: {(info?.through ?? through.map((t) => ({ ...t, label: t.field }))).map((t) => `${t.label} is ${t.value === null ? 'empty' : String(t.value)}`).join(', ')}.</span>
          <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => setParams({})}>Show All Rows</button>
        </div>
      )}
      {info?.access && info.access.length > 0 && (
        <p role="note" className="flex items-center gap-1.5 text-xs text-ink-800">
          <Lock size={12} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />
          Your access shows only {info.access.map((a) => `${a.label}: ${a.values.map(String).join(', ')}`).join('; ')}.
        </p>
      )}
      {info?.linked?.own_rules && info.linked.own_rules.length > 0 && (
        <p role="note" className="text-xs text-ink-800">
          The filters on {info.linked.own_rules.join(', ')} apply to this report&apos;s own data only; the measures from {info.linked.label ?? info.linked.dataset} are not narrowed by them.
        </p>
      )}
      {asked.length > 0 && !old && (
        <ParameterBar key={params.get('ask') ?? ''} dataset={report.data.dataset} fields={askedFields} parameters={asked} values={answers} onRun={answer} running={run.isFetching} used={info?.parameters}
          missing={refused && asked.length ? refused.problem?.detail : undefined} />
      )}
      {explaining && (
        <ExplainPanel reportId={id as string} reportName={report.data.name} params={sent} onClose={() => { setExplaining(false); explain.reset() }}
          ai={explainer?.enabled ? { explain: () => explain.mutate(), pending: explain.isPending, error: explain.error, explanation: explain.data ?? null, asked: !explain.isIdle } : null} />
      )}
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
      ) : waiting.length > 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-10 text-center text-sm text-ink-800">Choose {waiting.map((p) => p.label).join(' and ')} above, then run the report.</p>
      ) : run.isPending ? (
        <Spinner label="Running the report" />
      ) : refused ? (
        <ErrorState title={refused.problem?.title ?? 'The report did not run'} detail={refused.problem?.detail} onRetry={() => run.refetch()} />
      ) : run.isError ? (
        <ErrorState error={run.error} onRetry={() => run.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <ViewBar view={shownView} onChange={setView} columns={run.data.columns} dimensions={[]} />
          {shownView.type !== 'grid' && run.data.drill && <DrillBar info={run.data.drill} onPath={setPath} table={shownView.type === 'pivot' || shownView.type === 'hierarchy'} />}
          <ReportResult result={run.data} view={shownView} analysis={{ reportId: id as string, ...(sent ? { params: sent } : {}) }} notes={notes} tooltips
            onPick={shownView.type !== 'grid' && canDrill(run.data.drill) ? (column, value) => { if (run.data?.drill && canDrill(run.data.drill, column)) setPath(deeper(run.data.drill, value)) } : undefined}
            onContext={(column: ResultColumn, value, at) => { if (throughable(column)) setMenu({ dataset: report.data.dataset, field: column.key, fieldLabel: column.label, value, valueWords: formatCell(column, value), at, from: { id, name: report.data.name } }) }} />
        </div>
      )}
      {scheduling && <ScheduleDialog reportId={id as string} reportName={report.data.name} zone={me?.tenant.timezone ?? 'UTC'} existing={schedule} onClose={() => setScheduling(false)} onSaved={() => setScheduling(false)} />}
      {menu && <DrillThroughMenu target={menu} onClose={() => setMenu(null)} onComment={(target) => setTalking({ anchor: { field: target.field, value: target.value as never, label: target.valueWords } })} />}
      {talking && <CommentsDrawer kind="report" id={id as string} name={report.data.name} anchor={talking.anchor} onAnchor={(anchor) => setTalking({ anchor })} onClose={() => setTalking(null)} />}
      {alerting && <AlertsDialog reportId={id as string} reportName={report.data.name} measures={(info?.columns ?? []).filter((c) => c.aggregate && !c.compare && !c.linked)} onClose={() => setAlerting(false)} />}
      {printing && <PrintDialog reportId={id as string} reportName={report.data.name} firstField={info?.columns.find((c) => !c.aggregate)?.label} params={sent} onClose={() => setPrinting(false)} />}
      {sharing && <ShareDialog kind="report" id={id as string} name={report.data.name} onClose={() => setSharing(false)} />}
      {showSql && <SqlDialog dataset={report.data.dataset} definition={report.data.definition} name={report.data.name} onClose={() => setShowSql(false)} />}
      {embedding && <EmbedDialog kind="report" id={id as string} name={report.data.name} onClose={() => setEmbedding(false)} />}
      {versionsOpen && <VersionsDrawer report={report.data} shown={shownVersion} canEdit={report.data.can_edit} onOpen={(v) => { setShownVersion(v); setView(null); if (v !== null) setVersionsOpen(false) }} onClose={() => setVersionsOpen(false)} />}
    </div>
  )
}
