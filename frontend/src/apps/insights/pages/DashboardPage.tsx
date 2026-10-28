/**
 * A dashboard, viewed: its rows of tiles on its period. The period and the comparison can be switched here for a look,
 * unsaved; so can the slicers, and a value clicked on a tile filters the others (a field that is not a saved slicer gets a
 * chip of its own for the visit). Edit opens the editor for whoever may; Delete is the owner's.
 */
import { CalendarClock, FileText, Link2, MessageSquare, Pencil, Presentation, Share2, Trash2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { buttonSecondary } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { dashboardsApi, keys, usageApi, useComments, useDashboard, useDeleteDashboard, useSchedules } from '../api'
import { ActionsMenu, MenuGap } from '../components/ActionsMenu'
import { CommentsDrawer } from '../components/CommentsDrawer'
import { themeStyle } from '../dashboards/themes'
import { EmbedDialog } from '../components/EmbedDialog'
import { ScheduleBanner } from '../components/ScheduleBanner'
import { ScheduleDialog } from '../components/ScheduleDialog'
import { ShareDialog } from '../components/ShareDialog'
import { DashboardBody } from '../dashboards/DashboardBody'
import { activeSlicers, periodWords, tiles, toggleValue } from '../dashboards/layout'
import { containerOf, pagesOf } from '../dashboards/pages'
import { PeriodBar } from '../dashboards/PeriodBar'
import { SavedViews } from '../dashboards/SavedViews'
import { SlicerBar } from '../dashboards/SlicerBar'
import { Tabs } from '@/components/Tabs'
import type { CommentAnchor, DashboardSlicer, DashboardTile, DrillStep, Period, ResultColumn, SavedView, SlicerSelection } from '../types'

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const

export function DashboardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const dashboard = useDashboard(id)
  const remove = useDeleteDashboard()
  const [period, setPeriod] = useState<Period | null>(null)
  const [compare, setCompare] = useState<boolean | null>(null)
  const [selection, setSelection] = useState<SlicerSelection>({})
  const [extra, setExtra] = useState<DashboardSlicer[]>([])
  const [page, setPage] = useState<string | null>(null)
  const [drills, setDrills] = useState<Record<string, DrillStep[]>>({})
  const [applied, setApplied] = useState<string | null>(null)
  const { can, me } = useAuth()
  const [scheduling, setScheduling] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [embedding, setEmbedding] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'pptx' | null>(null)
  const [talking, setTalking] = useState<{ anchor: CommentAnchor | null } | null>(null)
  const comments = useComments('dashboard', id)
  const views = useQuery({ queryKey: ['insights', 'views', id], queryFn: () => dashboardsApi.views(id as string), enabled: Boolean(id) })
  useEffect(() => { if (id) usageApi.opened('dashboard', id).catch(() => undefined) }, [id])
  const schedules = useSchedules({ item: id })
  const schedule = schedules.data?.schedules[0] ?? null

  async function exportAs(kind: 'pdf' | 'pptx') {
    if (!id) return
    setExporting(kind)
    try {
      const blob = await (kind === 'pptx' ? dashboardsApi.exportPptx(id) : dashboardsApi.exportPdf(id))
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${dashboard.data?.name ?? 'dashboard'}.${kind}`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      toast.failure(error, 'The export did not run')
    } finally {
      setExporting(null)
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
  const slicers = data.layout.slicers ?? []
  const pick = (column: ResultColumn, value: unknown) => {
    if (!slicers.some((item) => item.field === column.key) && !extra.some((item) => item.field === column.key)) setExtra((now) => [...now, { field: column.key, label: column.label }])
    setSelection((now) => toggleValue(now, column.key, value))
  }
  const pages = pagesOf(data.layout)
  const shownPage = pages.find((item) => item.id === page) ?? pages[0]
  const onDrill = (tileId: string, next: DrillStep[] | null) => setDrills((now) => {
    const { [tileId]: _gone, ...rest } = now
    return next ? { ...rest, [tileId]: next } : rest
  })
  const applyView = (view: SavedView) => {
    const state = view.state
    setPeriod(state.period ?? null); setCompare(state.compare ?? null); setPage(state.page ?? null)
    setSelection(state.selection ?? {}); setExtra(state.extra ?? []); setDrills(state.drills ?? {}); setApplied(view.id)
  }
  const container = containerOf(data.layout, shownPage.id)
  const openComments = (comments.data?.comments ?? []).filter((c) => !c.resolved_at)
  const tileName = (tileId: string) => { const tile = tiles(data.layout).find((t) => t.id === tileId); return tile?.title || tile?.label }
  const onAction = (action: NonNullable<DashboardTile['action']>) => {
    if (action.kind === 'page') setPage(action.id)
    else if (action.kind === 'report') navigate(`/insights/reports/${action.id}`)
    else {
      const view = views.data?.views.find((item) => item.id === action.id)
      if (view) applyView(view)
      else toast.failure(new Error('The saved view is gone.'), 'The button did nothing')
    }
  }
  const removeExtra = (field: string) => {
    setExtra((now) => now.filter((item) => item.field !== field))
    setSelection((now) => ({ ...now, [field]: [] }))
  }
  return (
    <div className="report-density flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-ink-800"><Link to="/insights/dashboards" className="text-brand-800 hover:underline">Dashboards</Link> › {data.name}</p>
      <PageHeader help={<PageHelp chapter="insights" />} title={data.name} description={data.description ?? `${tiles(data.layout).length} tile${tiles(data.layout).length === 1 ? '' : 's'} · ${periodWords(data.bounds)}`}
        actions={(
          <ActionsMenu>{(act) => (
            <>
              {data.can_edit && <>
                <MenuRow role="menuitem" divider={false} leading={<Pencil {...ICON} />} title="Edit" onClick={() => act(() => navigate(`/insights/dashboards/${id}/edit`))} />
                <MenuGap />
              </>}
              {data.can_share && <MenuRow role="menuitem" divider={false} leading={<Share2 {...ICON} />} title={data.shared ? 'Shared' : 'Share'} onClick={() => act(() => setSharing(true))} />}
              <MenuRow role="menuitem" divider={false} leading={<MessageSquare {...ICON} />} title={openComments.length ? `Comments · ${openComments.length}` : 'Comments'} onClick={() => act(() => setTalking({ anchor: null }))} />
              {(can('report.edit') || can('report.admin')) && (
                <MenuRow role="menuitem" divider={false} leading={<CalendarClock {...ICON} />} title={schedule ? `Scheduled · ${schedule.words}` : 'Schedule'} onClick={() => act(() => setScheduling(true))} />
              )}
              <MenuGap />
              <MenuRow role="menuitem" divider={false} leading={<FileText {...ICON} />} title="Export PDF" disabled={exporting !== null || tiles(data.layout).length === 0} onClick={() => act(() => void exportAs('pdf'))} />
              <MenuRow role="menuitem" divider={false} leading={<Presentation {...ICON} />} title="Export PowerPoint" disabled={exporting !== null || tiles(data.layout).length === 0} onClick={() => act(() => void exportAs('pptx'))} />
              {data.can_share && <>
                <MenuGap />
                <MenuRow role="menuitem" divider={false} leading={<Link2 {...ICON} />} title="Embed on Another Site" onClick={() => act(() => setEmbedding(true))} />
              </>}
              {data.can_edit && <>
                <MenuGap />
                <MenuRow role="menuitem" divider={false} tone="error" leading={<Trash2 {...ICON} className="text-danger-text" />} title="Delete" disabled={remove.isPending} onClick={() => act(deleteDashboard)} />
              </>}
            </>
          )}</ActionsMenu>
        )} />
      {schedule && <ScheduleBanner schedule={schedule} onChange={() => setScheduling(true)} />}
      <PeriodBar period={shownPeriod} onPeriod={setPeriod} compare={shownCompare} onCompare={setCompare} bounds={saved ? data.bounds : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <SavedViews dashboardId={id as string} canShare={data.can_edit} applied={applied} onApply={applyView}
          current={{ ...(period ? { period } : {}), ...(compare !== null ? { compare } : {}), ...(page ? { page } : {}), selection: activeSlicers(selection), extra, drills }} />
      </div>
      <SlicerBar slicers={slicers} extra={extra} selection={selection} onChange={(field, values) => setSelection((now) => ({ ...now, [field]: values }))} onRemoveExtra={removeExtra}
        loadValues={(field) => dashboardsApi.slicerValues(id as string, { field, period: shownPeriod })} queryKey={[...keys.tiles(id as string), shownPeriod]} />
      {sharing && <ShareDialog kind="dashboard" id={id as string} name={data.name} onClose={() => setSharing(false)} />}
      {embedding && <EmbedDialog kind="dashboard" id={id as string} name={data.name} onClose={() => setEmbedding(false)} />}
      {talking && <CommentsDrawer kind="dashboard" id={id as string} name={data.name} anchor={talking.anchor} onAnchor={(anchor) => setTalking({ anchor })} onClose={() => setTalking(null)} tileName={tileName} />}
      {scheduling && <ScheduleDialog kind="dashboard" reportId={id as string} reportName={data.name} zone={me?.tenant.timezone ?? 'UTC'} existing={schedule} onClose={() => setScheduling(false)} onSaved={() => setScheduling(false)} />}
      {tiles(data.layout).length === 0 ? (
        <EmptyState title="Nothing on This Dashboard Yet" hint={data.can_edit ? 'Edit it and add a tile: one of your reports in its view, or one of its numbers as a figure.' : 'Its owner has not added a tile yet.'}
          action={data.can_edit ? <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/dashboards/${id}/edit`)}>Edit</button> : undefined} />
      ) : (
        <>
        {pages.length > 1 && <Tabs label="Pages" idPrefix="dashboard-page" size="sm" tabs={pages.map((item) => ({ id: item.id, label: item.title }))} value={shownPage.id} onChange={setPage} />}
        <div style={themeStyle(data.layout.theme)} data-theme-name={data.layout.theme ?? 'default'}>
        <DashboardBody layout={{ ...data.layout, rows: container.rows, canvas: container.canvas, cells: container.cells }} period={shownPeriod} compare={shownCompare} keyPrefix={keys.tiles(id as string)} selection={activeSlicers(selection)} onPick={pick}
          drills={drills} onDrill={onDrill} onAction={onAction}
          comments={{ count: (tileId) => openComments.filter((c) => c.anchor?.tile_id === tileId).length, open: (tile) => setTalking({ anchor: { tile_id: tile.id } }) }}
          load={(tile, p, c, s, d) => dashboardsApi.runTile(id as string, tile.id, { period: p, compare: c, ...(s ? { slicers: s } : {}), ...(d ? { drill: { path: d } } : {}) })} />
        </div>
        </>
      )}
    </div>
  )
}
