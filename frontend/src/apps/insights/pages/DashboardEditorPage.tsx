/**
 * A dashboard, edited: its name, period and comparison, its theme, its slicers (dimensions of the tiles' datasets viewers filter
 * by), and each page's tiles: rows with the layout controls on, or a free canvas to drag and resize on (with a phone preview).
 * Add Tile puts a report on it, Add Text words, Add Button a way to a saved view, a page or a report; Done saves the lot as a
 * new version and returns to the viewer; Cancel drops the changes.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, MousePointerClick, Plus, Smartphone, Type } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { buttonPrimary, buttonSecondary, Select } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { dashboardsApi, keys, useCatalog, useDashboard, useReports } from '../api'
import { AddTileDialog } from '../dashboards/AddTileDialog'
import { DashboardBody } from '../dashboards/DashboardBody'
import { addTile, newTileId, setSlicers, slicerCandidates } from '../dashboards/layout'
import { cellsToRows, place, rowsToCells } from '../dashboards/canvas'
import { THEMES } from '../dashboards/themes'
import { WordTileDialog } from '../dashboards/WordTileDialog'
import { addPage, containerOf, FIRST_PAGE, MAX_PAGES, pagesOf, removePage, renamePage, setContainer } from '../dashboards/pages'
import { Tabs } from '@/components/Tabs'
import { PeriodBar } from '../dashboards/PeriodBar'
import { SlicerEditor } from '../dashboards/SlicerBar'
import type { DashboardContainer, DashboardLayout, DashboardTheme, DashboardTile, Period } from '../types'

export function DashboardEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const dashboard = useDashboard(id)
  const [name, setName] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<'PRIVATE' | 'WORKSPACE' | null>(null)
  const [layout, setLayout] = useState<DashboardLayout | null>(null)
  const [period, setPeriod] = useState<Period | null>(null)
  const [compare, setCompare] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)
  const [pageId, setPageId] = useState(FIRST_PAGE)
  const [words, setWords] = useState<{ kind: 'text' | 'button'; tile?: DashboardTile } | null>(null)
  const [phone, setPhone] = useState(false)
  const reports = useReports({})
  const catalog = useCatalog()

  const save = useMutation({
    mutationFn: () => dashboardsApi.update(id as string, {
      row_version: dashboard.data?.row_version as number, name: (name ?? dashboard.data?.name ?? '').trim() || dashboard.data?.name, visibility: visibility ?? undefined,
      layout: layout ?? undefined, period: period ?? undefined, compare: compare ?? undefined,
    }),
    onSuccess: (saved) => {
      client.setQueryData(keys.dashboard(id as string), saved)
      client.invalidateQueries({ queryKey: keys.dashboards })
      toast.success('Saved', `${saved.name} is version ${saved.version}.`)
      navigate(`/insights/dashboards/${id}`)
    },
    onError: (error) => toast.failure(error, 'The dashboard was not saved'),
  })

  if (dashboard.isPending) return <Spinner label="Loading the dashboard" />
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
  if (!dashboard.data.can_edit) return <ErrorState title="You cannot change this dashboard" detail="Only its owner, or a report administrator, can. You can still open it." />
  const data = dashboard.data
  const shownLayout = layout ?? data.layout
  const shownPeriod = period ?? data.period
  const shownCompare = compare ?? data.compare
  const dirty = name !== null || visibility !== null || layout !== null || period !== null || compare !== null
  const pages = pagesOf(shownLayout)
  const page = pages.find((item) => item.id === pageId) ?? pages[0]
  const container = containerOf(shownLayout, page.id)
  const setPage = (next: DashboardContainer) => setLayout(setContainer(shownLayout, page.id, next))
  const onPageChange = (next: DashboardLayout) => setPage({ rows: next.rows, ...(next.canvas ? { canvas: true, cells: next.cells ?? [] } : {}) })
  /** a new tile into this page: the next free place on a canvas, else the last row with room */
  const putTile = (tile: Omit<DashboardTile, 'id'>) => (container.canvas
    ? setPage({ rows: [], canvas: true, cells: place(container.cells ?? [], { ...tile, id: newTileId(shownLayout) }) })
    : setPage({ rows: addTile({ ...shownLayout, rows: container.rows }, tile).rows }))
  const replaceTile = (id: string, tile: Omit<DashboardTile, 'id'>) => (container.canvas
    ? setPage({ rows: [], canvas: true, cells: (container.cells ?? []).map((c) => (c.id === id ? { ...c, ...tile, id } : c)) })
    : setPage({ rows: container.rows.map((row) => ({ ...row, tiles: row.tiles.map((t) => (t.id === id ? { ...tile, id } : t)) })) }))
  const switchLayout = (mode: 'rows' | 'canvas') => (mode === 'canvas'
    ? setPage({ rows: [], canvas: true, cells: rowsToCells(container.rows) })
    : setPage({ rows: cellsToRows(container.cells ?? []) }))
  const candidates = slicerCandidates(shownLayout, (reportId) => reports.data?.reports.find((report) => report.id === reportId)?.dataset, catalog.data?.datasets ?? [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle pb-3">
        <Link to={`/insights/dashboards/${id}`} className="inline-flex items-center gap-1 text-sm text-brand-800 hover:underline"><ArrowLeft size={14} strokeWidth={1.5} aria-hidden />Dashboard</Link>
        <input aria-label="Dashboard name" value={name ?? data.name} onChange={(event) => setName(event.target.value)} maxLength={200}
          className="min-w-0 flex-1 rounded-control-md border border-transparent bg-transparent px-2 font-display text-page-title font-semibold text-ink-900 hover:border-line focus:border-focus focus:outline-none" />
        <span className="w-36"><Select aria-label="Who can open it" controlSize="sm" value={visibility ?? data.visibility} onChange={(event) => setVisibility(event.target.value as 'PRIVATE' | 'WORKSPACE')}>
          <option value="PRIVATE">Only me</option><option value="WORKSPACE">The workspace</option>
        </Select></span>
        <span className="w-32"><Select aria-label="Theme" controlSize="sm" value={shownLayout.theme ?? 'default'} onChange={(event) => { const theme = event.target.value as DashboardTheme; const { theme: _old, ...rest } = shownLayout; setLayout(theme === 'default' ? rest : { ...rest, theme }) }}>
          {THEMES.map((theme) => <option key={theme.value} value={theme.value}>{theme.label} Theme</option>)}
        </Select></span>
        <span className="text-xs text-ink-800">{dirty ? 'Not saved yet' : `Version ${data.version}`}</span>
        <button type="button" className={buttonSecondary} onClick={() => setAdding(true)}><Plus size={16} strokeWidth={1.5} aria-hidden />Add Tile</button>
        <button type="button" className={buttonSecondary} onClick={() => setWords({ kind: 'text' })}><Type size={16} strokeWidth={1.5} aria-hidden />Add Text</button>
        <button type="button" className={buttonSecondary} onClick={() => setWords({ kind: 'button' })}><MousePointerClick size={16} strokeWidth={1.5} aria-hidden />Add Button</button>
        <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/dashboards/${id}`)}>Cancel</button>
        <button type="button" className={buttonPrimary} onClick={() => save.mutate()} disabled={save.isPending}>Done</button>
      </div>
      <PeriodBar period={shownPeriod} onPeriod={setPeriod} compare={shownCompare} onCompare={setCompare} bounds={period === null ? data.bounds : undefined} />
      <SlicerEditor slicers={shownLayout.slicers ?? []} candidates={candidates} onChange={(slicers) => setLayout(setSlicers(shownLayout, slicers))} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle pb-2">
        {pages.length > 1 && <Tabs label="Pages" idPrefix="dashboard-edit-page" size="sm" tabs={pages.map((item) => ({ id: item.id, label: item.title }))} value={page.id} onChange={setPageId} />}
        {pages.length > 1 && <input aria-label="Page title" value={page.title} maxLength={60} onChange={(event) => setLayout(renamePage(shownLayout, page.id, event.target.value))}
          className="h-8 w-40 rounded-control-md border border-line bg-surface px-2 text-sm text-ink-900 focus:border-focus focus:outline-none" />}
        {pages.length > 1 && <button type="button" className="text-xs font-semibold text-danger-text hover:underline" onClick={() => { setLayout(removePage(shownLayout, page.id)); setPageId(FIRST_PAGE) }}>Remove Page</button>}
        <SegmentedControl label="Layout" options={[{ value: 'rows', label: 'Rows' }, { value: 'canvas', label: 'Free Canvas' }]} value={container.canvas ? 'canvas' : 'rows'} onChange={(mode) => switchLayout(mode as 'rows' | 'canvas')} />
        {container.canvas && (
          <button type="button" aria-pressed={phone} onClick={() => setPhone((now) => !now)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-control-md border px-2.5 text-xs font-semibold ${phone ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>
            <Smartphone size={14} strokeWidth={1.5} aria-hidden />Phone Preview
          </button>
        )}
        <button type="button" className="ml-auto inline-flex h-8 items-center gap-1 rounded-control-md border border-dashed border-line-control px-2.5 text-sm font-semibold text-ink-800 hover:bg-surface-hover disabled:opacity-50" disabled={pages.length >= MAX_PAGES}
          onClick={() => { const added = addPage(shownLayout); setLayout(added.layout); setPageId(added.pageId) }}><Plus size={14} strokeWidth={1.5} aria-hidden />Add Page</button>
      </div>
      <DashboardBody layout={{ ...shownLayout, rows: container.rows, canvas: container.canvas, cells: container.cells }} period={shownPeriod} compare={shownCompare} keyPrefix={keys.tiles(id as string)}
        load={(tile, p, c, _s, d) => dashboardsApi.previewTile(id as string, { tile, period: p, compare: c, ...(d ? { drill: { path: d } } : {}) })} phone={phone && Boolean(container.canvas)}
        editing={{ onChange: onPageChange, onAddTile: () => setAdding(true), onEditTile: (tile) => setWords({ kind: tile.show === 'button' ? 'button' : 'text', tile }) }} />
      {adding && <AddTileDialog onClose={() => setAdding(false)} onAdd={(tile) => { putTile(tile); setAdding(false) }} />}
      {words && <WordTileDialog kind={words.kind} dashboardId={id as string} pages={pages} tile={words.tile} onClose={() => setWords(null)}
        onSave={(tile) => { if (words.tile) replaceTile(words.tile.id, tile); else putTile(tile); setWords(null) }} />}
    </div>
  )
}
