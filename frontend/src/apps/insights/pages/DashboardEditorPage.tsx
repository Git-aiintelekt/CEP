/**
 * A dashboard, edited (docs/mockups/dashboards.html, phase D4), in the whole window like the report editor. The bar: back, the
 * name and its saved state, Close (Discard Changes once something changed) and Save, which stores a new version and returns to
 * the viewer; leaving with changes asks first. The settings line: the period, the comparison, the slicers (dimensions of the
 * tiles' datasets viewers filter by), the theme, who can open it, a grid of sized tiles or a free canvas, a phone preview, and Add,
 * which docks the Add panel at the right: a report tile, words or a button, at a size. The tile added is chosen, its toolbar showing. Then the pages as tabs, + Add Page, and the chosen page's ⋯ to rename or remove it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MoreHorizontal, Pencil, Plus, Smartphone, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useLeaveGuard } from '@/apps/cep/features/designer/useLeaveGuard'
import { IconButton } from '@/components/Button'
import { iconButtonClass } from '@/components/buttonStyles'
import { FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { filterChipClass } from '@/components/filterChipStyles'
import { buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Modal } from '@/components/Modal'
import { Popover } from '@/components/Popover'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { Tabs } from '@/components/Tabs'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { dashboardsApi, keys, useCatalog, useDashboard, useReports } from '../api'
import { AddPanel, type NewTile } from '../dashboards/AddPanel'
import { DashboardBody } from '../dashboards/DashboardBody'
import { newTileId, setSlicers, slicerCandidates } from '../dashboards/layout'
import { isPacked, pack, place, readingOrder, rowsToCells } from '../dashboards/canvas'
import { PeriodMenu } from '../dashboards/PeriodMenu'
import { SlicerEditor } from '../dashboards/SlicerBar'
import { THEMES } from '../dashboards/themes'
import { addPage, containerOf, FIRST_PAGE, MAX_PAGES, pagesOf, removePage, renamePage, setContainer } from '../dashboards/pages'
import type { DashboardCell, DashboardContainer, DashboardLayout, DashboardTheme, Period } from '../types'

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const
const WHO = [{ value: 'PRIVATE' as const, label: 'Only Me' }, { value: 'WORKSPACE' as const, label: 'The Workspace' }]

/** the chosen page's ⋯: Rename Page, Remove Page */
function PageMenu({ title, onRename, onRemove }: { title: string; onRename: () => void; onRemove?: () => void }) {
  const menus = useSingleDropdown<'page'>()
  const pick = (go: () => void) => { menus.close(); go() }
  return (
    <span className="relative inline-flex">
      <button type="button" {...menus.triggerProps('page')} aria-haspopup="menu" aria-label={`Actions for the page ${title}`} className={iconButtonClass({ pressed: menus.isOpen('page'), size: 'sm' })}>
        <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
      </button>
      {menus.isOpen('page') && (
        <Popover {...menus.panelProps('page')} label={`Actions for the page ${title}`} placement="bottom-start" width={200}>
          <div role="menu" aria-label={`Actions for the page ${title}`} className="py-1">
            <MenuRow role="menuitem" divider={false} leading={<Pencil {...ICON} />} title="Rename Page" onClick={() => pick(onRename)} />
            {onRemove && <MenuRow role="menuitem" divider={false} tone="error" leading={<Trash2 {...ICON} className="text-danger-text" />} title="Remove Page" onClick={() => pick(onRemove)} />}
          </div>
        </Popover>
      )}
    </span>
  )
}

function RenamePageDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (title: string) => void }) {
  const [text, setText] = useState(title)
  return (
    <Modal title="Rename Page" onClose={onClose} size="md"
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="button" className={buttonPrimary} disabled={!text.trim()} onClick={() => onSave(text.trim())}>Rename</button></>}>
      <Field label="Page title" required>{({ id }) => <TextInput id={id} value={text} maxLength={60} autoFocus onChange={(event) => setText(event.target.value)} />}</Field>
    </Modal>
  )
}

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
  /** the Add panel: open, or changing a text tile or a button */
  const [panel, setPanel] = useState<{ tile?: DashboardCell } | null>(null)
  /** the tile just added, its toolbar showing */
  const [chosen, setChosen] = useState<string | null>(null)
  const [pageId, setPageId] = useState(FIRST_PAGE)
  const [renaming, setRenaming] = useState(false)
  const [phone, setPhone] = useState(false)
  /** a page switched to Free Canvas stays one until switched back, even before a tile moves */
  const [modes, setModes] = useState<Record<string, 'grid' | 'canvas'>>({})
  const reports = useReports({})
  const catalog = useCatalog()
  const viewerPath = `/insights/dashboards/${id}`
  const dirty = name !== null || visibility !== null || layout !== null || period !== null || compare !== null
  const shownName = name ?? dashboard.data?.name ?? ''
  const { requestLeave, dialog: leaveDialog } = useLeaveGuard(dirty, () => navigate(viewerPath), `Your changes to ${shownName || 'this dashboard'} will be lost.`)

  const save = useMutation({
    mutationFn: () => dashboardsApi.update(id as string, {
      row_version: dashboard.data?.row_version as number, name: shownName.trim() || dashboard.data?.name, visibility: visibility ?? undefined,
      layout: layout ?? undefined, period: period ?? undefined, compare: compare ?? undefined,
    }),
    onSuccess: (saved) => {
      client.setQueryData(keys.dashboard(id as string), saved)
      client.invalidateQueries({ queryKey: keys.dashboards })
      toast.success('Saved', `${saved.name} is version ${saved.version}.`)
      // in place of the leave guard's extra history entry, so Back from the viewer comes to the editor once
      navigate(viewerPath, { replace: true })
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
  const shownWho = visibility ?? data.visibility
  const theme = shownLayout.theme ?? 'default'
  const pages = pagesOf(shownLayout)
  const page = pages.find((item) => item.id === pageId) ?? pages[0]
  const container = containerOf(shownLayout, page.id)
  const setPage = (next: DashboardContainer) => setLayout(setContainer(shownLayout, page.id, next))
  const onPageChange = (next: DashboardLayout) => setPage({ rows: next.rows, ...(next.canvas ? { canvas: true, cells: next.cells ?? [] } : {}) })
  const mode = modes[page.id] ?? (container.canvas && !isPacked(container.cells ?? []) ? 'canvas' : 'grid')
  /** the page's tiles in their order, flowed: a page of rows becomes a grid as it is */
  const gridCells = () => (container.canvas ? pack(readingOrder(container.cells ?? [])) : pack(rowsToCells(container.rows.filter((row) => row.tiles.length > 0))))
  const setCells = (cells: DashboardCell[]) => setPage({ rows: [], canvas: true, cells })
  /** a new tile: after the others on a grid, below them on a free canvas */
  const putTile = (tile: NewTile, w: number) => {
    const made = place(mode === 'grid' ? gridCells() : container.cells ?? [], { ...tile, id: newTileId(shownLayout) })
    const fresh = made[made.length - 1]
    made[made.length - 1] = { ...fresh, w }
    setCells(mode === 'grid' ? pack(made) : made)
    setChosen(fresh.id)
  }
  const replaceTile = (tileId: string, tile: NewTile, w: number) => {
    const cells = container.canvas ? container.cells ?? [] : gridCells()
    const next = cells.map((c) => (c.id === tileId ? { ...c, ...tile, id: tileId, w } : c))
    setCells(mode === 'grid' ? pack(next) : next)
  }
  const switchLayout = (next: 'grid' | 'canvas') => {
    setModes((now) => ({ ...now, [page.id]: next }))
    if (next === 'grid') setCells(gridCells())
    else if (!container.canvas) setCells(gridCells())
  }
  const candidates = slicerCandidates(shownLayout, (reportId) => reports.data?.reports.find((report) => report.id === reportId)?.dataset, catalog.data?.datasets ?? [])
  const slicers = shownLayout.slicers ?? []
  const setTheme = (next: DashboardTheme) => { const { theme: _old, ...rest } = shownLayout; setLayout(next === 'default' ? rest : { ...rest, theme: next }) }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {leaveDialog}
      <header aria-label="Editor" className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface pr-4 pl-3">
        <IconButton label="Back to Dashboard" icon={ChevronLeft} size="md" onClick={() => requestLeave(() => navigate(viewerPath))} />
        <span aria-hidden className="h-6 w-px shrink-0 bg-line-subtle" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-xs text-ink-800">Dashboards</p>
          <div className="flex min-w-0 items-center gap-3">
            <input aria-label="Dashboard name" value={shownName} onChange={(event) => setName(event.target.value)} maxLength={200}
              className="-ml-1.5 field-sizing-content min-w-[8ch] max-w-full truncate rounded-sm border border-transparent bg-transparent px-1.5 font-display text-section-title font-semibold text-ink-900 hover:border-line focus:border-focus focus:outline-none" />
            <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 text-helper whitespace-nowrap ${dirty ? 'font-medium text-warning-text' : 'text-ink-800'}`}>
              <span aria-hidden className={`h-2 w-2 rounded-full ${dirty ? 'bg-warning' : 'bg-ink-300'}`} />
              {dirty ? 'Unsaved Changes' : `Saved ${formatDateTime(data.updated_at)} · Version ${data.version}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dirty
            ? <button type="button" className={buttonSecondary} onClick={() => navigate(viewerPath, { replace: true })}>Discard Changes</button>
            : <button type="button" className={buttonSecondary} onClick={() => requestLeave(() => navigate(viewerPath))}>Close</button>}
          <button type="button" className={buttonPrimary} onClick={() => save.mutate()} disabled={!dirty || save.isPending}>Save</button>
        </div>
      </header>

      <div role="group" aria-label="Dashboard settings" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-6 py-3">
        <PeriodMenu period={shownPeriod} onPeriod={setPeriod} bounds={period === null ? data.bounds : undefined} />
        <Switch checked={shownCompare} onChange={setCompare} label="Compare With Previous Period" />
        <span aria-hidden className="mx-1 h-6 w-px bg-line-subtle" />
        <FilterChip label={slicers.length ? `Slicers · ${slicers.length}` : 'Slicers'} active={slicers.length > 0} menuLabel="Slicers" menuWidth={400}>
          {() => <div className="p-3"><SlicerEditor slicers={slicers} candidates={candidates} onChange={(next) => setLayout(setSlicers(shownLayout, next))} /></div>}
        </FilterChip>
        <FilterChip label={`Theme: ${THEMES.find((t) => t.value === theme)?.label ?? 'Default'}`} menuLabel="Theme" menuWidth={220} align="start">
          {({ close }) => <SingleSelectMenu label="Theme" value={theme} options={THEMES} onChange={(next) => { setTheme(next as DashboardTheme); close() }} />}
        </FilterChip>
        <FilterChip label={`Who Can Open It: ${WHO.find((w) => w.value === shownWho)?.label}`} menuLabel="Who Can Open It" menuWidth={220} align="start">
          {({ close }) => <SingleSelectMenu label="Who Can Open It" value={shownWho} options={WHO} onChange={(next) => { setVisibility(next); close() }} />}
        </FilterChip>
        <span aria-hidden className="mx-1 h-6 w-px bg-line-subtle" />
        <SegmentedControl label="Layout" options={[{ value: 'grid', label: 'Grid' }, { value: 'canvas', label: 'Free Canvas' }]} value={mode} onChange={(next) => switchLayout(next as 'grid' | 'canvas')} />
        <button type="button" aria-pressed={phone} onClick={() => setPhone((now) => !now)} className={filterChipClass(phone)}>
          <Smartphone {...ICON} />Phone Preview
        </button>
        <span className="ml-auto">
          <button type="button" className={buttonPrimary} aria-pressed={Boolean(panel && !panel.tile)} onClick={() => setPanel({})}><Plus {...ICON} />Add</button>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle bg-surface px-6">
        {pages.length > 1 && <Tabs label="Pages" idPrefix="dashboard-edit-page" size="sm" tabs={pages.map((item) => ({ id: item.id, label: item.title }))} value={page.id} onChange={setPageId} />}
        {pages.length > 1 && <PageMenu title={page.title} onRename={() => setRenaming(true)} onRemove={() => { setLayout(removePage(shownLayout, page.id)); setPageId(FIRST_PAGE) }} />}
        <button type="button" className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-800 disabled:opacity-50" disabled={pages.length >= MAX_PAGES}
          onClick={() => { const added = addPage(shownLayout); setLayout(added.layout); setPageId(added.pageId) }}><Plus size={14} strokeWidth={1.5} aria-hidden />Add Page</button>
        {slicers.length === 0 && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-800"><SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden />No slicers yet: viewers filter by the period only.</span>}
      </div>

      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-canvas px-6 py-5">
        <DashboardBody layout={phone && mode === 'grid' ? { ...shownLayout, rows: [], canvas: true, cells: gridCells() } : { ...shownLayout, rows: container.rows, canvas: container.canvas, cells: container.cells }}
          period={shownPeriod} compare={shownCompare} keyPrefix={keys.tiles(id as string)}
          load={(tile, p, c, _s, d) => dashboardsApi.previewTile(id as string, { tile, period: p, compare: c, ...(d ? { drill: { path: d } } : {}) })} phone={phone}
          editing={{ onChange: onPageChange, grid: mode === 'grid' && !phone, newId: () => newTileId(shownLayout), nameOf: (tile) => reports.data?.reports.find((r) => r.id === tile.report_id)?.name, chosen, onAddTile: () => setPanel({}), onEditTile: (tile) => setPanel({ tile: tile as DashboardCell }) }} />
      </div>
      {panel && <AddPanel key={panel.tile?.id ?? 'new'} dashboardId={id as string} pages={pages} pageTitle={pages.length > 1 ? page.title : "the Dashboard"} tile={panel.tile} onClose={() => setPanel(null)}
        onAdd={(tile, w) => { if (panel.tile) { replaceTile(panel.tile.id, tile, w); setPanel(null) } else putTile(tile, w) }} />}
      </div>
      {renaming && <RenamePageDialog title={page.title} onClose={() => setRenaming(false)} onSave={(title) => { setLayout(renamePage(shownLayout, page.id, title)); setRenaming(false) }} />}
    </div>
  )
}
