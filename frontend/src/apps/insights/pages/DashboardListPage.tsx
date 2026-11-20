/**
 * Insights → Dashboards (docs/mockups/dashboards.html, laid out like the Journeys page): the blue Dashboard Templates panel
 * (Start from Scratch, and the dashboards the Base Reports packs add), then Your Dashboards with a search, Owner, Shared and
 * Favourites filters kept in the address, and a list or grid view (remembered per viewer). Each dashboard's ⋯ opens, edits,
 * duplicates (a private copy), shares, stars or deletes it. Create Dashboard makes an empty one and opens the editor.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, LayoutDashboard, LayoutGrid, List, Pencil, Plus, Share2, Star, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ClearFiltersLink, FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { filterChipClass } from '@/components/filterChipStyles'
import { buttonPrimary } from '@/components/Form'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { SearchField } from '@/components/SearchField'
import { SegmentedControl } from '@/components/SegmentedControl'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { dashboardsApi, keys, libraryApi, useDashboards, useDeleteDashboard } from '../api'
import { BaseReportsDialog } from '../components/BaseReportsDialog'
import { FavouriteStar } from '../components/FavouriteStar'
import { RowMenu } from '../components/RowMenu'
import { ShareDialog } from '../components/ShareDialog'
import { DashboardTemplatePreview, DashboardTemplatesGallery, DashboardTemplatesPanel, type DashboardTemplate } from '../dashboards/DashboardTemplates'
import type { DashboardSummary } from '../types'

type View = 'grid' | 'list'
type Sharing = 'workspace' | 'shared' | 'private'
const VIEW_KEY = 'insights.dashboards.view'
const VIEW_OPTIONS = [
  { value: 'grid' as const, label: 'Grid View', icon: LayoutGrid },
  { value: 'list' as const, label: 'List View', icon: List },
]
const SHARING: { value: Sharing; label: string }[] = [{ value: 'workspace', label: 'Workspace' }, { value: 'shared', label: 'Shared' }, { value: 'private', label: 'Private' }]
const FILTERS = ['owner', 'shared', 'fav'] as const
const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

const sharingOf = (d: DashboardSummary): Sharing => (d.visibility === 'WORKSPACE' ? 'workspace' : d.shared ? 'shared' : 'private')

function SharingTag({ dashboard }: { dashboard: DashboardSummary }) {
  const sharing = sharingOf(dashboard)
  return sharing === 'private' ? <Tag>Private</Tag> : <Tag tone="brand">{sharing === 'workspace' ? 'Workspace' : 'Shared'}</Tag>
}

export function DashboardListPage() {
  const { can, me } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [view, setViewState] = useState<View>(readView)
  const [previewing, setPreviewing] = useState<DashboardTemplate | null>(null)
  const [gallery, setGallery] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [sharingWith, setSharingWith] = useState<DashboardSummary | null>(null)
  const dashboards = useDashboards()
  const remove = useDeleteDashboard()
  const canCreate = can('report.edit') || can('report.admin')
  const refreshList = () => client.invalidateQueries({ queryKey: keys.dashboards })

  const create = useMutation({
    mutationFn: () => dashboardsApi.create({}),
    onSuccess: (dashboard) => navigate(`/insights/dashboards/${dashboard.id}/edit`),
    onError: (error) => toast.failure(error, 'The dashboard was not created'),
  })
  const duplicate = useMutation({
    mutationFn: async (id: string) => {
      const full = await dashboardsApi.get(id)
      const copy = await dashboardsApi.create({ name: `Copy of ${full.name}`.slice(0, 200), description: full.description ?? undefined, visibility: 'PRIVATE' })
      return dashboardsApi.update(copy.id, { row_version: copy.row_version, layout: full.layout, period: full.period, compare: full.compare })
    },
    onSuccess: (copy) => { refreshList(); toast.success(`“${copy.name}” made`, 'Only you can open it until you share it.') },
    onError: (error) => toast.failure(error, 'The dashboard was not copied'),
  })
  const star = useMutation({
    mutationFn: (d: DashboardSummary) => (d.favourite ? libraryApi.unfavourite('dashboard', d.id) : libraryApi.favourite('dashboard', d.id)),
    onSuccess: refreshList,
    onError: (error) => toast.failure(error, 'The favourite did not change'),
  })
  const deleteDashboard = (d: DashboardSummary) => {
    if (window.confirm(`Delete “${d.name}”? Its tiles go with it; the reports stay.`)) remove.mutate(d.id, { onError: (error) => toast.failure(error, 'The dashboard was not deleted') })
  }

  const setView = (next: View) => {
    setViewState(next)
    try { window.localStorage.setItem(VIEW_KEY, next) } catch { /* the choice just is not remembered */ }
  }
  const owner = params.get('owner') ?? ''
  const sharedParam = params.get('shared')
  const shared = SHARING.some((s) => s.value === sharedParam) ? (sharedParam as Sharing) : ''
  const fav = params.get('fav') === '1'
  const update = (next: Record<string, string>) => setParams((current) => {
    const merged = new URLSearchParams(current)
    Object.entries(next).forEach(([key, value]) => (value ? merged.set(key, value) : merged.delete(key)))
    return merged
  }, { replace: true })
  const clearFilters = () => { setQ(''); update(Object.fromEntries(FILTERS.map((key) => [key, '']))) }

  const all = dashboards.data?.dashboards ?? []
  const term = q.trim().toLowerCase()
  const rows = all.filter((d) => (!term || [d.name, d.description ?? ''].some((text) => text.toLowerCase().includes(term)))
    && (!owner || d.owner_name === owner) && (!shared || sharingOf(d) === shared) && (!fav || d.favourite))
  const filtering = Boolean(term) || FILTERS.some((key) => params.get(key))
  const owners = Array.from(new Set(all.map((d) => d.owner_name).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b))
  const myId = me?.principal.id

  const menu = (d: DashboardSummary) => (
    <RowMenu label={`Actions for ${d.name}`} groups={[
      [
        { title: 'Open', icon: <ExternalLink {...ICON} />, onSelect: () => navigate(`/insights/dashboards/${d.id}`) },
        d.can_edit && { title: 'Edit', icon: <Pencil {...ICON} />, onSelect: () => navigate(`/insights/dashboards/${d.id}/edit`) },
        canCreate && { title: 'Duplicate', icon: <Copy {...ICON} />, onSelect: () => duplicate.mutate(d.id) },
      ],
      [
        (can('report.admin') || d.owner_user_id === myId) && { title: 'Share…', icon: <Share2 {...ICON} />, onSelect: () => setSharingWith(d) },
        { title: d.favourite ? 'Remove From Favourites' : 'Add to Favourites', icon: <Star {...ICON} />, onSelect: () => star.mutate(d) },
      ],
      [d.can_edit && { title: 'Delete…', icon: <Trash2 {...ICON} className="text-danger-text" />, tone: 'error', onSelect: () => deleteDashboard(d) }],
    ]} />
  )

  const createButton = canCreate && (
    <button type="button" className={buttonPrimary} onClick={() => create.mutate()} disabled={create.isPending}><Plus {...ICON} />Create Dashboard</button>
  )

  let results: ReactNode
  if (dashboards.isPending) results = <Spinner label="Loading the dashboards" />
  else if (dashboards.isError) results = <ErrorState error={dashboards.error} onRetry={() => dashboards.refetch()} />
  else if (all.length === 0) {
    results = <EmptyState icon={LayoutDashboard} title="No Dashboards Yet"
      hint={canCreate ? 'Put your reports on one page, with one period for all of them. Start from a template above or from scratch.' : 'Nobody has shared a dashboard with the workspace yet.'} />
  } else if (rows.length === 0) {
    results = <EmptyState icon={LayoutDashboard} title="No Dashboards Match These Filters" hint="Try another owner or sharing, or clear the filters." action={<ClearFiltersLink onClick={clearFilters} />} />
  } else if (view === 'grid') {
    results = (
      <ul aria-label="Dashboards" className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {rows.map((d) => <li key={d.id} className="min-w-0"><DashboardCard dashboard={d} menu={menu(d)} /></li>)}
      </ul>
    )
  } else {
    results = (
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[820px] table-fixed text-sm" aria-label="Dashboards">
          <colgroup><col className="w-10" /><col /><col className="w-20" /><col className="w-40" /><col className="w-32" /><col className="w-44" /><col className="w-12" /></colgroup>
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-left text-label font-medium text-ink-900">
              <th className="py-2"><span className="sr-only">Favourite</span></th>
              <th className="px-3 py-2">Dashboard</th>
              <th className="px-3 py-2">Tiles</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Shared</th>
              <th className="px-3 py-2">Changed</th>
              <th className="py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="h-14 border-t border-line-subtle first:border-t-0 hover:bg-surface-hover">
                <td className="pl-2"><FavouriteStar kind="dashboard" id={d.id} name={d.name} on={d.favourite} /></td>
                <td className="px-3 py-2">
                  <Link to={`/insights/dashboards/${d.id}`} className="block truncate font-medium text-ink-900 hover:underline">{d.name}</Link>
                  {d.description && <span className="block truncate text-helper text-ink-800" title={d.description}>{d.description}</span>}
                </td>
                <td className="cep-num px-3 py-2 text-ink-800">{d.tiles}</td>
                <td className="truncate px-3 py-2 text-ink-800">{d.owner_name ?? '—'}</td>
                <td className="px-3 py-2"><SharingTag dashboard={d} /></td>
                <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(d.updated_at)}</td>
                <td className="pr-2 text-right">{menu(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section>
      <PageHeader title="Dashboards" help={<PageHelp chapter="insights" />} actions={createButton || undefined} />

      {canCreate && (
        <div className="mb-10">
          <DashboardTemplatesPanel onScratch={() => create.mutate()} onPreview={setPreviewing} onViewMore={() => setGallery(true)} />
        </div>
      )}

      <section aria-labelledby="your-dashboards-title">
        <h2 id="your-dashboards-title" className="mb-4 flex items-center gap-2 font-display text-section-title font-semibold text-ink-900">
          Your Dashboards
          {dashboards.data && <span className="cep-num inline-flex h-[22px] items-center rounded-sm bg-fill-subtle px-2 font-body text-xs font-semibold text-ink-800">{all.length}</span>}
        </h2>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchField label="Search dashboards" value={q} onChange={setQ} />
          <FilterChip label={owner ? `Owner: ${owner}` : 'Owner'} active={Boolean(owner)} menuLabel="Owner">
            {({ close }) => <SingleSelectMenu label="Owner" value={owner}
              options={[{ value: '', label: 'Anyone' }, ...owners.map((name) => ({ value: name, label: name }))]}
              onChange={(value) => { update({ owner: value }); close() }} />}
          </FilterChip>
          <FilterChip label={shared ? `Shared: ${SHARING.find((s) => s.value === shared)?.label}` : 'Shared'} active={Boolean(shared)} menuLabel="Shared">
            {({ close }) => <SingleSelectMenu label="Shared" value={shared}
              options={[{ value: '', label: 'Any Sharing' }, ...SHARING]}
              onChange={(value) => { update({ shared: value }); close() }} />}
          </FilterChip>
          <button type="button" aria-pressed={fav} className={filterChipClass(fav)} onClick={() => update({ fav: fav ? '' : '1' })}>
            <Star {...ICON} className={fav ? 'fill-current' : ''} />Favourites
          </button>
          {filtering && <ClearFiltersLink onClick={clearFilters} />}
          <div className="ml-auto">
            <SegmentedControl label="View" options={VIEW_OPTIONS} value={view} onChange={setView} iconOnly />
          </div>
        </div>

        {results}
      </section>

      {gallery && <DashboardTemplatesGallery onClose={() => setGallery(false)} onPreview={setPreviewing} />}
      {previewing && <DashboardTemplatePreview template={previewing} canCreate={canCreate} onClose={() => setPreviewing(null)}
        onUse={() => { setAdding(previewing.pack.key); setPreviewing(null); setGallery(false) }} />}
      {adding && <BaseReportsDialog pack={adding} onClose={() => { setAdding(null); refreshList() }} />}
      {sharingWith && <ShareDialog kind="dashboard" id={sharingWith.id} name={sharingWith.name} onClose={() => { setSharingWith(null); refreshList() }} />}
    </section>
  )
}

function DashboardCard({ dashboard: d, menu }: { dashboard: DashboardSummary; menu: ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-line bg-surface">
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start gap-2">
          <Link to={`/insights/dashboards/${d.id}`} className="min-w-0 flex-1 text-card-title font-semibold text-ink-900 hover:underline">{d.name}</Link>
          <FavouriteStar kind="dashboard" id={d.id} name={d.name} on={d.favourite} />
          {menu}
        </div>
        {d.description && <p className="line-clamp-2 text-helper text-ink-800">{d.description}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs text-ink-800">
          <SharingTag dashboard={d} />
          <span className="cep-num">{d.tiles} tile{d.tiles === 1 ? '' : 's'}</span>
          {d.owner_name && <span>· {d.owner_name}</span>}
        </div>
      </div>
      <p className="cep-num border-t border-line-subtle px-4 py-2.5 text-xs text-ink-800">Changed {formatDateTime(d.updated_at)}</p>
    </div>
  )
}
