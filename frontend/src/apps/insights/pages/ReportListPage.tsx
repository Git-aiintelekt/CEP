/**
 * Insights → Reports: every report this person may see, as one flat table (docs/mockups/reports-list-b.html). Tabs split
 * them by owner, the filter line narrows them by folder, component, dataset, owner and favourites, and every choice is kept
 * in the address (?component=cep is how each component's Insights menu item opens it). The list is fetched once and
 * filtered, sorted and paged here. New Report starts from a dataset; Ask AI opens AI Reports. Each row's ⋯ (ReportRowMenu)
 * opens, edits, duplicates (a private copy), files, shares, schedules or deletes the report.
 */
import { ArrowDown, ArrowUp, Building2, CalendarClock, ChartColumn, FileBarChart, Lightbulb, ListTree, Lock, Network, Plus, Sheet, Sparkles, Star, Table2, Users, type LucideIcon } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ClearFiltersLink, FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { filterChipClass } from '@/components/filterChipStyles'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SearchField } from '@/components/SearchField'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tabs } from '@/components/Tabs'
import { tabId, tabPanelId } from '@/components/tabIds'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { insightsApi, useCatalog, useDeleteReport, useFolders, useReports, useSchedules } from '../api'
import { AiPill } from '../components/AskForReport'
import { FavouriteStar } from '../components/FavouriteStar'
import { FolderSelect } from '../components/FolderSelect'
import { PAGE_SIZES, rememberedSize } from '../components/paging'
import { ReportRowMenu, type RowAction } from '../components/ReportRowMenu'
import { Pager } from '../components/ResultGrid'
import { ScheduleDialog } from '../components/ScheduleDialog'
import { ShareDialog } from '../components/ShareDialog'
import type { ReportSummary, Schedule } from '../types'

const VIEW: Record<ReportSummary['view_type'], { label: string; icon: LucideIcon }> = {
  grid: { label: 'Grid', icon: Table2 },
  chart: { label: 'Chart', icon: ChartColumn },
  pivot: { label: 'Pivot', icon: Sheet },
  hierarchy: { label: 'Hierarchy', icon: ListTree },
  influencers: { label: 'Key Influencers', icon: Lightbulb },
  decomposition: { label: 'Decomposition Tree', icon: Network },
}
const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const SIZE_KEY = 'insights.reports.rows'
const PANEL = 'reports'

type TabKey = 'all' | 'mine' | 'shared'
type SortKey = 'name' | 'owner' | 'last_run'
type Dir = 'asc' | 'desc'
const NATURAL: Record<SortKey, Dir> = { name: 'asc', owner: 'asc', last_run: 'desc' }
const FILTERS = ['folder', 'component', 'dataset', 'owner', 'fav'] as const

export function ReportListPage() {
  const { can, me } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(() => rememberedSize(SIZE_KEY))
  const reports = useReports({})
  const catalog = useCatalog()
  const folders = useFolders()
  const schedules = useSchedules({})
  const client = useQueryClient()
  const toast = useToast()
  const [acting, setActing] = useState<{ action: 'folder' | 'share' | 'schedule'; report: ReportSummary } | null>(null)
  const refreshList = () => client.invalidateQueries({ queryKey: ['insights', 'reports'] })
  const duplicate = useMutation({
    mutationFn: async (id: string) => {
      const full = await insightsApi.report(id)
      return insightsApi.create({ name: `Copy of ${full.name}`.slice(0, 200), dataset: full.dataset, definition: full.definition, description: full.description ?? undefined, visibility: 'PRIVATE', component: full.component_key ?? null })
    },
    onSuccess: (copy) => { refreshList(); toast.success(`“${copy.name}” made`, 'Only you can open it until you share it.') },
    onError: (error) => toast.failure(error, 'The report was not copied'),
  })
  const fileIn = useMutation({
    mutationFn: async ({ id, folderId }: { id: string; folderId: string | null }) => {
      const full = await insightsApi.report(id)
      return insightsApi.update(id, { row_version: full.row_version, folder_id: folderId })
    },
    onSuccess: (_saved, { folderId }) => {
      refreshList()
      setActing(null)
      toast.success(folderId ? `Moved to ${folders.data?.folders.find((f) => f.id === folderId)?.name ?? 'the folder'}` : 'Taken out of its folder')
    },
    onError: (error) => toast.failure(error, 'The report was not moved'),
  })
  const remove = useDeleteReport()
  const act = (report: ReportSummary, action: RowAction) => {
    if (action === 'open') navigate(`/insights/reports/${report.id}`)
    else if (action === 'edit') navigate(`/insights/reports/${report.id}/edit`)
    else if (action === 'duplicate') duplicate.mutate(report.id)
    else if (action === 'delete') {
      if (window.confirm(`Delete “${report.name}”? Its versions go with it.`)) remove.mutate(report.id, { onError: (error) => toast.failure(error, 'The report was not deleted') })
    } else setActing({ action, report })
  }

  const tab: TabKey = params.get('tab') === 'mine' ? 'mine' : params.get('tab') === 'shared' ? 'shared' : 'all'
  const folder = params.get('folder') ?? ''
  const component = params.get('component') ?? ''
  const dataset = params.get('dataset') ?? ''
  const owner = params.get('owner') ?? ''
  const fav = params.get('fav') === '1'
  const sortParam = params.get('sort')
  const sort: SortKey = sortParam === 'name' || sortParam === 'owner' ? sortParam : 'last_run'
  const dir: Dir = params.get('dir') === 'asc' || params.get('dir') === 'desc' ? (params.get('dir') as Dir) : NATURAL[sort]

  const update = (next: Record<string, string>) => {
    setPage(0)
    setParams((current) => {
      const merged = new URLSearchParams(current)
      Object.entries(next).forEach(([key, value]) => (value ? merged.set(key, value) : merged.delete(key)))
      return merged
    }, { replace: true })
  }
  const clearFilters = () => {
    setQ('')
    update(Object.fromEntries(FILTERS.map((key) => [key, ''])))
  }
  const sortBy = (key: SortKey) => {
    const nextDir = key === sort ? (dir === 'asc' ? 'desc' : 'asc') : NATURAL[key]
    update({ sort: key === 'last_run' ? '' : key, dir: nextDir === NATURAL[key] ? '' : nextDir })
  }
  const resize = (next: number) => {
    setSize(next)
    setPage(0)
    try { window.localStorage.setItem(SIZE_KEY, String(next)) } catch { /* the default next visit */ }
  }

  const all = reports.data?.reports ?? []
  const myId = me?.principal.id
  const term = q.trim().toLowerCase()
  const filtered = all.filter((r) =>
    (!term || [r.name, r.description ?? '', r.dataset_label].some((text) => text.toLowerCase().includes(term)))
    && (!folder || (folder === 'none' ? !r.folder_id : r.folder_id === folder))
    && (!component || r.component.key === component)
    && (!dataset || r.dataset === dataset)
    && (!owner || r.owner_name === owner)
    && (!fav || r.favourite))
  const mine = filtered.filter((r) => r.owner_user_id === myId)
  const shared = filtered.filter((r) => r.owner_user_id !== myId)
  const inTab = tab === 'mine' ? mine : tab === 'shared' ? shared : filtered
  const rows = [...inTab].sort(compare(sort, dir))
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const shownPage = Math.min(page, pages - 1)
  const pageRows = rows.slice(shownPage * size, (shownPage + 1) * size)
  const filtering = Boolean(term) || FILTERS.some((key) => params.get(key))

  // a chip per component with datasets or reports (a report may be filed under a component with no data of its own), in the suite's order
  const offered = new Map([...(catalog.data?.datasets ?? []).map((d) => [d.component.key, d.component] as const), ...all.map((r) => [r.component.key, r.component] as const)])
  const components = catalog.data?.components?.length ? catalog.data.components.filter((c) => offered.has(c.key) || c.key === component) : Array.from(offered.values())
  const datasets = Array.from(new Map(all.map((r) => [r.dataset, r.dataset_label])).entries()).sort((a, b) => a[1].localeCompare(b[1]))
  const owners = Array.from(new Set(all.map((r) => r.owner_name).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b))
  const folderList = folders.data?.folders ?? []
  const scheduleOf = new Map<string, Schedule>()
  for (const s of schedules.data?.schedules ?? []) {
    if (s.kind === 'report' && (!scheduleOf.has(s.item_id) || s.status === 'ACTIVE')) scheduleOf.set(s.item_id, s)
  }

  const canCreate = can('report.edit') || can('report.admin')
  const canAsk = can('report.edit') && Boolean(me?.insights?.ai_reports)
  const askAi = canAsk && <button type="button" className={buttonSecondary} onClick={() => navigate('/insights/ai-reports')}><Sparkles size={16} strokeWidth={1.5} aria-hidden />Ask AI</button>
  const newReport = canCreate && <button type="button" className={buttonPrimary} onClick={() => navigate(`/insights/reports/new${component ? `?component=${component}` : ''}`)}><Plus size={16} strokeWidth={1.5} aria-hidden />New Report</button>
  const startHint = canAsk ? 'Pick a dataset and choose what to show, or describe the report and let AI draft it.' : 'Pick a dataset, choose what to show, and save it.'
  const starters = canCreate ? <div className="flex flex-wrap justify-center gap-2">{askAi}{newReport}</div> : undefined
  const folderName = folder === 'none' ? 'No Folder' : folderList.find((f) => f.id === folder)?.name
  const componentName = components.find((c) => c.key === component)?.name ?? component

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        help={<>{reports.data && <span className="cep-num inline-flex h-6 items-center rounded-sm bg-fill-subtle px-2 text-xs font-semibold text-ink-800">{all.length.toLocaleString()}</span>}<PageHelp chapter="insights" /></>}
        description="Every report you can open, yours and the ones shared with you."
        actions={canCreate ? <div className="flex flex-wrap gap-2">{askAi}{newReport}</div> : undefined}
      />

      <div className="flex overflow-x-auto border-b border-line">
        <Tabs label="Whose reports" idPrefix={PANEL} value={tab} onChange={(next) => update({ tab: next === 'all' ? '' : next })}
          tabs={[{ id: 'all', label: 'All Reports', count: filtered.length }, { id: 'mine', label: 'My Reports', count: mine.length }, { id: 'shared', label: 'Shared With Me', count: shared.length }]} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField label="Search reports" value={q} onChange={(next) => { setQ(next); setPage(0) }} />
        {folderList.length > 0 && (
          <FilterChip label={folderName ? `Folder: ${folderName}` : 'Folder'} active={Boolean(folderName)} menuLabel="Folder">
            {({ close }) => <SingleSelectMenu label="Folder" value={folder}
              options={[{ value: '', label: 'All Folders' }, ...folderList.map((f) => ({ value: f.id, label: `${f.name} (${all.filter((r) => r.folder_id === f.id).length})` })), { value: 'none', label: `No Folder (${all.filter((r) => !r.folder_id).length})` }]}
              onChange={(value) => { update({ folder: value }); close() }} />}
          </FilterChip>
        )}
        <FilterChip label={component ? `Component: ${componentName}` : 'Component'} active={Boolean(component)} menuLabel="Component">
          {({ close }) => <SingleSelectMenu label="Component" value={component}
            options={[{ value: '', label: 'All Components' }, ...components.map((c) => ({ value: c.key, label: c.name }))]}
            onChange={(value) => { update({ component: value }); close() }} />}
        </FilterChip>
        <FilterChip label={dataset ? `Dataset: ${datasets.find(([key]) => key === dataset)?.[1] ?? dataset}` : 'Dataset'} active={Boolean(dataset)} menuLabel="Dataset">
          {({ close }) => <SingleSelectMenu label="Dataset" value={dataset}
            options={[{ value: '', label: 'All Datasets' }, ...datasets.map(([key, label]) => ({ value: key, label }))]}
            onChange={(value) => { update({ dataset: value }); close() }} />}
        </FilterChip>
        <FilterChip label={owner ? `Owner: ${owner}` : 'Owner'} active={Boolean(owner)} menuLabel="Owner">
          {({ close }) => <SingleSelectMenu label="Owner" value={owner}
            options={[{ value: '', label: 'Anyone' }, ...owners.map((name) => ({ value: name, label: name }))]}
            onChange={(value) => { update({ owner: value }); close() }} />}
        </FilterChip>
        <button type="button" aria-pressed={fav} className={filterChipClass(fav)} onClick={() => update({ fav: fav ? '' : '1' })}>
          <Star size={16} strokeWidth={1.5} aria-hidden className={fav ? 'fill-current' : ''} />Favourites
        </button>
        {filtering && <ClearFiltersLink onClick={clearFilters} />}
        {filtering && reports.data && <span className="cep-num ml-auto text-xs text-ink-800">{filtered.length.toLocaleString()} of {all.length.toLocaleString()} reports</span>}
      </div>

      <div role="tabpanel" id={tabPanelId(PANEL, tab)} aria-labelledby={tabId(PANEL, tab)}>
        {reports.isPending ? (
          <Spinner label="Loading the reports" />
        ) : reports.isError ? (
          <ErrorState error={reports.error} onRetry={() => reports.refetch()} />
        ) : rows.length === 0 ? (
          filtering ? <EmptyState icon={FileBarChart} title="No Reports Match These Filters" hint="Try another folder, component or owner, or clear the filters." action={<ClearFiltersLink onClick={clearFilters} />} />
          : tab === 'mine' ? <EmptyState icon={FileBarChart} title="No Reports of Yours Yet" hint={canCreate ? startHint : 'Reports you make appear here.'} action={starters} />
          : tab === 'shared' ? <EmptyState icon={FileBarChart} title="Nothing Shared With You Yet" hint="Reports other people share with you, or with the whole workspace, appear here." />
          : <EmptyState icon={FileBarChart} title="No Reports Yet" hint={canCreate ? startHint : 'Nobody has shared a report with the workspace yet.'} action={starters} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[920px] table-fixed text-sm" aria-label="Reports">
              <colgroup><col className="w-10" /><col /><col className="w-36" /><col className="w-32" /><col className="w-36" /><col className="w-40" /><col className="w-12" /></colgroup>
              <thead>
                <tr className="border-b border-line bg-surface-subtle text-left text-label font-medium text-ink-900">
                  <th className="py-2"><span className="sr-only">Favourite</span></th>
                  <SortHeader label="Name" field="name" sort={sort} dir={dir} onSort={sortBy} />
                  <SortHeader label="Owner" field="owner" sort={sort} dir={dir} onSort={sortBy} />
                  <th className="px-3 py-2">Access</th>
                  <th className="px-3 py-2">Schedule</th>
                  <SortHeader label="Last Run" field="last_run" sort={sort} dir={dir} onSort={sortBy} />
                  <th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((report) => <ReportRow key={report.id} report={report} schedule={scheduleOf.get(report.id)}
                  menu={<ReportRowMenu report={report} canCreate={canCreate} canShare={report.can_share ?? (can('report.admin') || report.owner_user_id === myId)} scheduled={scheduleOf.has(report.id)} onAction={(action) => act(report, action)} />} />)}
              </tbody>
            </table>
            {rows.length > PAGE_SIZES[0] && <Pager page={shownPage} pages={pages} size={size} rows={rows.length} onPage={setPage} onSize={resize} />}
          </div>
        )}
      </div>

      {acting?.action === 'folder' && (
        <Modal title="Move to Folder" onClose={() => setActing(null)}>
          <p className="mb-3 text-sm text-ink-800">Choose where “{acting.report.name}” is filed.</p>
          <FolderSelect value={acting.report.folder_id} disabled={fileIn.isPending} onChange={(folderId) => fileIn.mutate({ id: acting.report.id, folderId })} />
        </Modal>
      )}
      {acting?.action === 'share' && <ShareDialog kind="report" id={acting.report.id} name={acting.report.name} onClose={() => { setActing(null); refreshList() }} />}
      {acting?.action === 'schedule' && (
        <ScheduleDialog reportId={acting.report.id} reportName={acting.report.name} zone={me?.tenant.timezone ?? 'UTC'} existing={scheduleOf.get(acting.report.id) ?? null}
          onClose={() => setActing(null)} onSaved={() => setActing(null)} />
      )}
    </div>
  )
}

function compare(sort: SortKey, dir: Dir) {
  const sign = dir === 'asc' ? 1 : -1
  return (a: ReportSummary, b: ReportSummary): number => {
    if (sort === 'last_run') {
      if (!a.last_run_at || !b.last_run_at) return a.last_run_at ? -1 : b.last_run_at ? 1 : 0    // never run sits last either way
      return sign * a.last_run_at.localeCompare(b.last_run_at)
    }
    const text = (r: ReportSummary) => (sort === 'name' ? r.name : r.owner_name ?? '')
    return sign * text(a).localeCompare(text(b), undefined, { sensitivity: 'base' })
  }
}

function SortHeader({ label, field, sort, dir, onSort }: { label: string; field: SortKey; sort: SortKey; dir: Dir; onSort: (field: SortKey) => void }) {
  const on = sort === field
  const Arrow = dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className="px-3 py-2" aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-brand-800">
        {label}{on && <Arrow size={12} strokeWidth={1.5} aria-hidden className="text-ink-800" />}
      </button>
    </th>
  )
}

function ReportRow({ report, schedule, menu }: { report: ReportSummary; schedule: Schedule | undefined; menu: ReactNode }) {
  const view = VIEW[report.view_type] ?? VIEW.grid
  return (
    <tr className="h-14 border-t border-line-subtle first:border-t-0 hover:bg-surface-hover">
      <td className="pl-2"><FavouriteStar kind="report" id={report.id} name={report.name} on={report.favourite} /></td>
      <td className="px-3 py-2">
        <span className="flex min-w-0 items-center gap-3">
          <span role="img" aria-label={view.label} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-fill-subtle text-ink-800"><view.icon size={16} strokeWidth={1.5} aria-hidden /></span>
          <span className="flex min-w-0 items-center gap-1.5">
            <Link to={`/insights/reports/${report.id}`} className="truncate font-medium text-ink-900 hover:underline">{report.name}</Link>
            {report.ai && <AiPill />}
          </span>
        </span>
      </td>
      <td className="truncate px-3 py-2 text-ink-800">{report.owner_name ?? '—'}</td>
      <td className="px-3 py-2 text-ink-800"><Access report={report} /></td>
      <td className="px-3 py-2"><ScheduleCell schedule={schedule} /></td>
      <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{report.last_run_at ? formatDateTime(report.last_run_at) : <span className="text-ink-300">Never run</span>}</td>
      <td className="pr-2 text-right">{menu}</td>
    </tr>
  )
}

function Access({ report }: { report: ReportSummary }) {
  const [Icon, words] = report.visibility === 'WORKSPACE' ? [Building2, 'Everyone'] : report.shared ? [Users, 'Shared'] : [Lock, 'Private']
  return <span className="inline-flex items-center gap-1.5"><Icon size={16} strokeWidth={1.5} aria-hidden />{words}</span>
}

function ScheduleCell({ schedule }: { schedule: Schedule | undefined }) {
  if (!schedule) return <span className="text-ink-300">—</span>
  const rhythm = schedule.every === 'day' ? 'Daily' : schedule.every === 'weekday' ? 'Weekdays' : schedule.every === 'week' ? WEEKDAYS[(schedule.on_day ?? 1) - 1] ?? 'Weekly' : 'Monthly'
  const active = schedule.status === 'ACTIVE'
  return (
    <span title={schedule.words} className={`inline-flex items-center gap-1.5 whitespace-nowrap ${active ? 'text-ink-900' : 'text-ink-800'}`}>
      <CalendarClock size={16} strokeWidth={1.5} aria-hidden className={active ? 'text-brand-600' : 'text-ink-800'} />
      {active ? `${rhythm} · ${schedule.recipients.length}` : 'Paused'}
    </span>
  )
}
