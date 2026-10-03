/**
 * Campaigns landing (BRD 6.3): what is coming up, then two views of the same filtered campaigns. List view: saved views
 * (Mine, Sending Today, Needs Attention…), search, filters, sorting, pages of 25 / 50 / 100, a preview pop-up per
 * campaign (?preview=<id>), Pause / Resume / Approve on the row, a row menu by status and bulk clone / archive / pause /
 * resume. Calendar view: the month, a bar per campaign. Archived campaigns stay out unless the Status filter asks for them.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Pause, Play, Plus, ShieldCheck, User, Workflow, X } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { Tabs } from '@/components/Tabs'
import { tabPanelId } from '@/components/tabIds'
import { buttonClass } from '@/components/buttonStyles'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { Campaign, CampaignFormOptions, CountedPage } from '@/lib/types'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { CampaignCalendar } from './CampaignCalendar'
import { CampaignActionsMenu } from './CampaignActionsMenu'
import { CampaignFilters } from './CampaignFilters'
import { campaignMenuItems, type CampaignMenuItem } from './campaignMenu'
import { CampaignPreview } from './CampaignPreview'
import { ChannelIcon } from './ChannelIcon'
import { EMPTY_FILTERS, type Filters, filtersFromParams, SAVED_VIEWS, type SavedView, savedViewOf, withFilterParams } from './listFilters'
import { CampaignSetupDialog } from './setup/CampaignSetupDialog'
import { setupHref, stepsFor } from './setupFlow'
import { BULK_DONE, CONFIRM, useBulkAction, useCampaignAction, type BulkAction, type StatusAction } from './useCampaignAction'
import { channelLabel, hasAction, typeShortLabel } from './vocabulary'
import { timeInZone } from './zone'

import { PageHelp } from '@/help/HelpPanel'

const PAGE_SIZES = [25, 50, 100]

const COLUMNS: { key: string; label: string }[] = [
  { key: 'name', label: 'Campaign Name' }, { key: 'campaign_type', label: 'Type' }, { key: 'channel', label: 'Channel' }, { key: 'status', label: 'Status' },
  { key: '', label: 'Triggered By' }, { key: '', label: 'Audience' }, { key: 'next_run', label: 'Next Send' }, { key: 'created_at', label: 'Created' },
]

function scheduledText(campaign: Campaign): string {
  if (campaign.next_run_at) return formatDate(campaign.next_run_at)
  if (campaign.campaign_type === 'E_RECEIPT' && ['PRODUCTION_PUBLISHED', 'ACTIVE'].includes(campaign.status)) return 'Ongoing'
  if (campaign.status === 'ACTIVE') return 'Sending now'
  return formatDate(campaign.scheduled_at ?? campaign.published_at)
}

/** the Next Send cell: the day, and under it the time in the campaign's zone (or the workspace's) */
function NextSendCell({ campaign, zone }: { campaign: Campaign; zone: string }) {
  const when = campaign.next_run_at
  return (
    <div className="min-w-0">
      <span className="cep-num block whitespace-nowrap text-helper text-ink-800">{scheduledText(campaign)}</span>
      {when && <span className="cep-num block whitespace-nowrap text-helper text-ink-300">{timeInZone(when, campaign.send_timezone || zone)}{campaign.timezone_optimization ? ' · local time' : ''}</span>}
    </div>
  )
}

/** the one thing most worth doing to the row, beside ⋮: Pause, Resume, or Approve (a link to the Review step) */
function RowAction({ campaign, rights, onAct }: { campaign: Campaign; rights: { publish: boolean; approve: boolean }; onAct: (action: StatusAction) => void }) {
  const small = 'inline-flex h-8 items-center gap-1 rounded-control-md px-2 text-helper font-semibold text-brand-800 transition-colors duration-fast ease-standard hover:bg-brand-100'
  if (rights.approve && campaign.approval?.status === 'REQUESTED' && hasAction(campaign, 'approve')) {
    return <Link to={setupHref(campaign.id, { step: 'publish', section: 'review' })} className={small} aria-label={`Approve ${campaign.name}`}><ShieldCheck size={14} strokeWidth={1.5} aria-hidden />Approve</Link>
  }
  if (rights.publish && hasAction(campaign, 'pause')) {
    return <button type="button" className={small} aria-label={`Pause ${campaign.name}`} onClick={() => onAct('pause')}><Pause size={14} strokeWidth={1.5} aria-hidden />Pause</button>
  }
  if (rights.publish && hasAction(campaign, 'resume')) {
    return <button type="button" className={small} aria-label={`Resume ${campaign.name}`} onClick={() => onAct('resume')}><Play size={14} strokeWidth={1.5} aria-hidden />Resume</button>
  }
  return null
}

/** a click that lands on something with its own job (a link, the checkbox, the ⋮ button or its menu) is not a row click */
const ownsClick = (event: MouseEvent) => (event.target as HTMLElement).closest('a, button, input, label, [role="region"]') !== null

const VIEWS = [{ id: 'list' as const, label: 'List View' }, { id: 'calendar' as const, label: 'Calendar View' }]

function Upcoming({ workspaceZone, canEdit }: { workspaceZone: string; canEdit: boolean }) {
  const upcoming = useQuery({
    queryKey: ['campaigns', 'upcoming'],
    queryFn: ({ signal }) => api.get<CountedPage<Campaign>>('/campaigns/', { status: 'SCHEDULED', ordering: 'next_run', page_size: 4 }, signal),
  })
  const rows = (upcoming.data?.results ?? []).filter((campaign) => campaign.next_run_at)
  return (
    <section aria-labelledby="upcoming-title" className="mb-6">
      <h2 id="upcoming-title" className="mb-3 font-display text-section-title font-semibold text-ink-900">Upcoming Campaigns</h2>
      {upcoming.isError ? (
        <ErrorState title="The upcoming campaigns could not be loaded" error={upcoming.error} onRetry={() => void upcoming.refetch()} />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-4 text-sm text-ink-800">
          {upcoming.isPending ? 'Loading' : `Nothing is scheduled. A campaign appears here once it is published with a send time ahead${canEdit ? ': choose “Schedule for later” or “Recurring” on the Scheduling step.' : '.'}`}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((campaign) => {
            return (
              <li key={campaign.id} className="min-w-0">
                <Link to={`/campaigns/${campaign.id}`} className="flex h-full flex-col gap-2 rounded-lg border border-line bg-surface p-4 transition-colors duration-fast ease-standard hover:bg-surface-subtle">
                  <span className="flex min-w-0 items-center gap-2">
                    <ChannelIcon channel={campaign.channel} aria-label={channelLabel(campaign.channel)} className="shrink-0 text-ink-800" />
                    <span className="truncate text-sm font-semibold text-ink-900">{campaign.name}</span>
                  </span>
                  <span className="cep-num font-display text-page-title font-semibold text-ink-900">{formatDate(campaign.next_run_at)}</span>
                  <span className="text-helper text-ink-800">
                    {timeInZone(campaign.next_run_at, campaign.send_timezone || workspaceZone)}
                    {campaign.audience_size ? ` · ${formatNumber(campaign.audience_size)} in the lists` : ''}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** a flat drawing of a campaign card being added; the round button is an approved exception to the 8px radius rule */
function EmptyDrawing() {
  return (
    <div aria-hidden className="relative h-24 w-[132px]">
      <div className="absolute top-14 left-3.5 h-3 w-[104px] rounded-sm bg-surface-sunken" />
      <div className="absolute top-[74px] left-[26px] h-3 w-20 rounded-sm bg-surface-sunken" />
      <div className="absolute top-1.5 left-1.5 h-11 w-[120px] rounded-md border border-brand-100 bg-callout-bg" />
      <div className="absolute top-[18px] left-[18px] h-2 w-[52px] rounded-sm bg-brand-100" />
      <div className="absolute top-8 left-[18px] h-2 w-20 rounded-sm bg-brand-100" />
      <div className="absolute top-0.5 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
        <Plus size={16} strokeWidth={2} />
      </div>
    </div>
  )
}

function EmptyCampaigns({ filtered, canEdit, onClear, onCreate }: { filtered: boolean; canEdit: boolean; onClear: () => void; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 px-8 py-[88px] text-center">
      <EmptyDrawing />
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="font-display text-xl font-semibold text-ink-900">{filtered ? 'No matching campaigns' : 'You haven’t created any campaigns yet'}</h2>
        <p className="max-w-[380px] text-sm text-ink-800">{filtered ? 'Try widening the date range or clearing filters.' : 'Build an email, SMS or MMS campaign, or let a journey generate one for you.'}</p>
      </div>
      {filtered ? (
        <button type="button" onClick={onClear} className={buttonPrimary}><X size={16} strokeWidth={1.5} aria-hidden />Clear Filters</button>
      ) : canEdit && (
        <button type="button" onClick={onCreate} className={buttonPrimary}><Plus size={16} strokeWidth={1.5} aria-hidden />Create Your First Campaign</button>
      )}
    </div>
  )
}

function Footer({ page, pageSize, total, onPage, onPageSize, divided }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void; divided: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return (
    <div className={`flex flex-col gap-3 px-6 py-3 md:flex-row md:items-center md:justify-between ${divided ? 'border-t border-line-subtle' : ''}`}>
      <p aria-live="polite" className="cep-num text-helper text-ink-800">Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)} campaign{total === 1 ? '' : 's'}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div role="group" aria-label="Rows per Page" className="flex items-center gap-2 text-helper text-ink-800">
          <span aria-hidden>Rows per Page</span>
          {PAGE_SIZES.map((size) => (
            <button key={size} type="button" aria-pressed={size === pageSize} onClick={() => onPageSize(size)}
              className={`cep-num h-8 min-w-[38px] rounded-control-md border px-2 text-helper font-semibold transition-colors duration-fast ease-standard ${size === pageSize ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-800 hover:bg-surface-subtle'}`}>
              {size}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Previous Page" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} />
          <span className="cep-num px-1 text-helper text-ink-800">Page {page} of {pages}</span>
          <IconButton label="Next Page" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} />
        </div>
      </div>
    </div>
  )
}

function ChannelCell({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-900">
      <ChannelIcon channel={channel} aria-hidden className="shrink-0 text-ink-800" />
      {channelLabel(channel)}
    </span>
  )
}

function TriggeredCell({ campaign }: { campaign: Campaign }) {
  const journey = campaign.triggered_by === 'JOURNEY'
  const Icon = journey ? Workflow : User
  return (
    <div className="min-w-0 max-w-40">
      <span className="flex items-center gap-2 text-ink-800"><Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />{journey ? 'Journey' : 'Manual'}</span>
      <span className="block truncate pl-6 text-helper text-ink-300">{journey ? 'Automated' : campaign.owner_name || 'No owner'}</span>
    </div>
  )
}

/** `creating`: /campaigns/new, the list with the Create Campaign pop-up open (closing it goes to /campaigns) */
export function CampaignListPage({ creating = false }: { creating?: boolean }) {
  const navigate = useNavigate()
  const { can, me } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list'
  const workspaceZone = me?.tenant.timezone || 'UTC'
  const canEdit = can('campaign.edit')
  const canPublish = can('campaign.publish')
  const canApprove = can('campaign.approve')
  // ?approval=requested is the Awaiting Approval view under another name
  const saved = savedViewOf(params.get('saved') ?? (params.get('approval')?.toLowerCase() === 'requested' ? 'approval' : null))
  const savedQuery = SAVED_VIEWS.find((item) => item.key === saved)?.query ?? {}
  const wide = useMinWidth(BREAKPOINT.md)
  const menus = useSingleDropdown<string>()
  const [createOpen, setCreateOpen] = useState(creating)
  const closeCreate = () => { setCreateOpen(false); if (creating) navigate('/campaigns', { replace: true }) }

  const [search, setSearch] = useState('')
  const [localFilters, setLocalFilters] = useState<Filters>(EMPTY_FILTERS)
  // Status, Type and Channel are read from the address, so a refresh keeps them and Back undoes a change
  const filters: Filters = { ...localFilters, ...filtersFromParams(params) }
  const [ordering, setOrdering] = useState('-created_at')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState<ReactNode>('')
  const [confirming, setConfirming] = useState<{ campaign: Campaign; action: StatusAction } | null>(null)
  const [bulkArchive, setBulkArchive] = useState(false)
  const [bulkAsked, setBulkAsked] = useState<Exclude<BulkAction, 'archive' | 'clone'> | null>(null)

  const { created: _created, ...apiFilters } = filters
  const query = { search: search.trim(), ...apiFilters, ...savedQuery, ordering, page, page_size: pageSize }
  const list = useQuery({
    queryKey: ['campaigns', 'list', query],
    queryFn: ({ signal }) => api.get<CountedPage<Campaign>>('/campaigns/', query, signal),
    placeholderData: keepPreviousData,
    enabled: view === 'list',
  })
  const options = useQuery({
    queryKey: ['campaigns', 'form-options'],
    queryFn: ({ signal }) => api.get<CampaignFormOptions>('/campaigns/form-options/', undefined, signal),
    staleTime: 5 * 60_000,
  })

  const act = useCampaignAction((message, after, action) => {
    setConfirming(null)
    setNotice(action === 'clone' ? <>{message} <Link to={setupHref(after.id, { step: stepsFor(after.campaign_type)[0].key, details: true })} className="font-medium underline underline-offset-2">Open the Copy</Link></> : message)
  })
  const bulk = useBulkAction((result) => {
    setBulkArchive(false)
    setBulkAsked(null)
    setSelected([])
    const verb = BULK_DONE[result.action as BulkAction] ?? result.action
    setNotice(`${result.done.length} campaign${result.done.length === 1 ? '' : 's'} ${verb}.` + (result.skipped.length ? ` Left as they were: ${result.skipped.map((item) => `${item.name} (${item.reason})`).join('; ')}` : ''))
  })

  const rows = list.data?.results ?? []
  const total = list.data?.count ?? 0
  const filtered = search.trim() !== '' || Object.values(filters).some(Boolean) || saved !== ''
  const pageIds = rows.map((row) => row.id)
  const allPicked = pageIds.length > 0 && pageIds.every((id) => selected.includes(id))

  function change(patch: Partial<Filters>) {
    const { status, type, channel, ...rest } = patch
    const inUrl = Object.fromEntries(Object.entries({ status, type, channel }).filter(([, value]) => value !== undefined))
    setLocalFilters((current) => ({ ...current, ...rest }))
    if (Object.keys(inUrl).length) setParams((current) => withFilterParams(current, inUrl))
    setPage(1)
    setSelected([])
  }
  function clearAll() {
    setSearch('')
    setLocalFilters(EMPTY_FILTERS)
    setParams((current) => {
      const now = withFilterParams(current, { status: '', type: '', channel: '' })
      now.delete('saved')
      now.delete('approval')
      return now
    }, { replace: true })
    setPage(1)
    setSelected([])
  }
  function pickSaved(next: SavedView) {
    setParams((current) => {
      const now = new URLSearchParams(current)
      if (next) now.set('saved', next); else now.delete('saved')
      now.delete('approval')
      return now
    }, { replace: true })
    setPage(1)
    setSelected([])
  }
  function sortBy(key: string) {
    setOrdering((current) => (current === key ? `-${key}` : key))
    setPage(1)
  }
  function run(campaign: Campaign, action: StatusAction) {
    setNotice('')
    if (CONFIRM[action]) setConfirming({ campaign, action })
    else act.mutate({ campaign, action })
  }
  const rights = { edit: canEdit, publish: canPublish }
  const rowRights = { publish: canPublish, approve: canApprove }
  const pickFor = (row: Campaign) => (item: CampaignMenuItem) => (item.action ? run(row, item.action) : navigate(item.to))
  const rowMenu = (row: Campaign) => <CampaignActionsMenu menus={menus} id={`row-${row.id}`} label={`Actions for ${row.name}`} items={campaignMenuItems(row, rights)} onPick={pickFor(row)} />

  // the pop-up lives in the address, so Back closes it and a link can open it
  const previewId = params.get('preview')
  const pushedPreview = useRef(false)
  useEffect(() => {
    if (!previewId) pushedPreview.current = false
  }, [previewId])
  function openPreview(id: string) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('preview', id)
      return next
    })
    pushedPreview.current = true
  }
  function closePreview() {
    if (pushedPreview.current) {
      pushedPreview.current = false
      navigate(-1)
      return
    }
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('preview')
      return next
    }, { replace: true })
  }
  const openRow = (row: Campaign) => (event: MouseEvent) => {
    if (!ownsClick(event)) openPreview(row.id)
  }
  const previewRow = rows.find((row) => row.id === previewId)
  const previewDetail = useQuery({
    queryKey: ['campaigns', 'detail', previewId],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${previewId}/`, undefined, signal),
    enabled: Boolean(previewId) && !previewRow && (view === 'calendar' || !list.isPending),
  })
  // while the table turns a page under the pop-up, the campaign on show stays until the next one is picked
  const shownPreview = useRef<Campaign | undefined>(undefined)
  const previewCampaign = previewRow ?? (previewDetail.data?.id === previewId ? previewDetail.data : undefined) ?? (shownPreview.current?.id === previewId ? shownPreview.current : undefined)
  useEffect(() => {
    shownPreview.current = previewCampaign
  })

  // previous / next walk the table's current order, filters and pages; moving replaces ?preview, so Back still closes in one step
  const [announcement, setAnnouncement] = useState('')
  const [pageEdge, setPageEdge] = useState<'first' | 'last' | null>(null)
  const previewIndex = rows.findIndex((row) => row.id === previewId)
  function showInPreview(row: Campaign, index: number) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('preview', row.id)
      return next
    }, { replace: true })
    setAnnouncement(`${row.name}, ${formatNumber((page - 1) * pageSize + index + 1)} of ${formatNumber(total)}`)
    document.querySelector(`[data-campaign-name="${row.id}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }
  const previewNav = {
    hasPrevious: previewIndex > 0 || (previewIndex === 0 && page > 1),
    hasNext: previewIndex >= 0 && (previewIndex < rows.length - 1 || page * pageSize < total),
    onPrevious: () => {
      if (previewIndex > 0) showInPreview(rows[previewIndex - 1], previewIndex - 1)
      else if (previewIndex === 0 && page > 1) { setPageEdge('last'); setPage(page - 1) }
    },
    onNext: () => {
      if (previewIndex >= 0 && previewIndex < rows.length - 1) showInPreview(rows[previewIndex + 1], previewIndex + 1)
      else if (previewIndex >= 0 && page * pageSize < total) { setPageEdge('first'); setPage(page + 1) }
    },
    announcement,
  }
  useEffect(() => {
    if (!pageEdge || !list.data || list.isPlaceholderData || rows.length === 0) return
    setPageEdge(null)
    const index = pageEdge === 'first' ? 0 : rows.length - 1
    showInPreview(rows[index], index)
    // showInPreview reads this render's page and rows, which are the ones just loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageEdge, list.data, list.isPlaceholderData])
  useEffect(() => {
    if (!previewId) setAnnouncement('')
  }, [previewId])
  // an action chosen in the pop-up runs once the pop-up is gone, so its confirm dialog keeps the focus
  const [afterPreview, setAfterPreview] = useState<{ campaign: Campaign; action: StatusAction } | null>(null)
  useEffect(() => {
    if (previewId || !afterPreview) return
    setAfterPreview(null)
    run(afterPreview.campaign, afterPreview.action)
    // run reads only setters and the mutation, which are stable enough for a one-off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewId, afterPreview])

  const nameCell = (row: Campaign) => (
    <div className="min-w-0">
      <button type="button" data-campaign-name={row.id} onClick={() => openPreview(row.id)}
        className="block max-w-full truncate text-left text-card-title font-semibold text-ink-900 transition-colors duration-fast ease-standard hover:text-brand-600">
        {row.name}
      </button>
    </div>
  )
  const footer = total > 0 && (
    <Footer page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); setSelected([]) }} divided={wide} />
  )
  // 16px between columns, 24px at the table's outer edges
  const cell = 'px-2 py-3 first:pl-6 last:pr-6'

  return (
    <section>
      <PageHeader
        title="Campaigns"
        help={<PageHelp chapter="campaigns" />}
        actions={canEdit && <button type="button" onClick={() => setCreateOpen(true)} className={buttonPrimary}><Plus size={16} strokeWidth={1.5} aria-hidden />Create Campaign</button>}
      />

      <div className="mb-5 flex border-b border-line">
        <Tabs label="Campaign views" idPrefix="campaign-views" tabs={VIEWS} value={view} onChange={(next) => setParams(next === 'calendar' ? { view: 'calendar' } : {}, { replace: true })} />
      </div>

      <Upcoming workspaceZone={workspaceZone} canEdit={canEdit} />

      {view === 'list' && (
        <div role="group" aria-label="Saved views" className="mb-3 flex flex-wrap gap-2">
          {SAVED_VIEWS.filter((item) => item.key !== 'approval' || canApprove || canPublish).map((item) => (
            <button key={item.key || 'all'} type="button" aria-pressed={saved === item.key} onClick={() => pickSaved(item.key)}
              className={`h-8 rounded-pill border px-3 text-helper font-semibold transition-colors duration-fast ease-standard ${saved === item.key ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-800 hover:bg-surface-subtle'}`}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      <CampaignFilters
        menus={menus}
        filters={filters}
        onChange={change}
        search={search}
        onSearch={(value) => { setSearch(value); setPage(1); setSelected([]) }}
        onClear={clearAll}
        options={options.data}
        zone={workspaceZone}
        showCreated={view === 'list'}
        fetching={view === 'list' && list.isFetching}
      />

      {notice && <p role="status" className="mb-3 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>}
      {act.isError && <div className="mb-3"><ErrorState title="That did not go through" error={act.error} /></div>}
      {bulk.isError && <div className="mb-3"><ErrorState title="The selected campaigns were not changed" error={bulk.error} /></div>}

      {view === 'list' && selected.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-callout-bg px-4 py-2 text-sm text-callout-text">
          <span className="font-medium">{selected.length} selected</span>
          <button type="button" className={buttonSecondary} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'clone', ids: selected })}>Clone</button>
          {canPublish && <button type="button" className={buttonSecondary} disabled={bulk.isPending} onClick={() => setBulkAsked('pause')}>Pause</button>}
          {canPublish && <button type="button" className={buttonSecondary} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'resume', ids: selected })}>Resume</button>}
          <button type="button" className={buttonSecondary} disabled={bulk.isPending} onClick={() => setBulkArchive(true)}>Archive</button>
          <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setSelected([])}>Clear Selection</button>
        </div>
      )}

      {view === 'calendar' ? (
        <div role="tabpanel" id={tabPanelId('campaign-views', 'calendar')} aria-label="Calendar View">
          <CampaignCalendar zone={workspaceZone} canEdit={canEdit}
            filters={Object.fromEntries(Object.entries({ search: search.trim(), status: filters.status, type: filters.type, channel: filters.channel, triggered_by: filters.triggered_by, tag: filters.tag, owner: filters.owner }).filter(([, value]) => value))} />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-6 py-10 text-sm text-ink-800"><Spinner /> Loading campaigns</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface"><EmptyCampaigns filtered={filtered} canEdit={canEdit} onClear={clearAll} onCreate={() => setCreateOpen(true)} /></div>
      ) : wide ? (
        <div className="rounded-lg border border-line bg-surface">
          <div className="relative overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Campaigns</caption>
              <thead>
                <tr className="h-12 border-b border-line">
                  {canEdit && (
                    <th scope="col" className="w-10 pr-2 pl-6">
                      <input type="checkbox" aria-label="Select every campaign on this page" checked={allPicked} className="h-4 w-4 accent-brand-600"
                        onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...pageIds])] : selected.filter((id) => !pageIds.includes(id)))} />
                    </th>
                  )}
                  {COLUMNS.map((column) => {
                    const direction = ordering === column.key ? 'ascending' : ordering === `-${column.key}` ? 'descending' : undefined
                    return (
                      <th key={column.label} scope="col" aria-sort={column.key ? (direction ?? 'none') : undefined}
                        className={`px-2 text-sm font-semibold whitespace-nowrap text-ink-900 first:pl-6 text-left`}>
                        {column.key ? (
                          <button type="button" onClick={() => sortBy(column.key)} className="inline-flex items-center gap-1 hover:text-ink-900">
                            {column.label}
                            {direction === 'ascending' ? <ArrowUp size={14} strokeWidth={1.5} aria-hidden /> : direction === 'descending' ? <ArrowDown size={14} strokeWidth={1.5} aria-hidden /> : <ChevronsUpDown size={14} strokeWidth={1.5} className="text-ink-300" aria-hidden />}
                          </button>
                        ) : column.label}
                      </th>
                    )
                  })}
                  <th scope="col" className="w-14 pr-6 pl-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {rows.map((row) => {
                  const picked = selected.includes(row.id) || previewId === row.id
                  const rest = row.is_journey_generated ? 'bg-surface-subtle' : 'hover:bg-surface-subtle'
                  return (
                    <tr key={row.id} onClick={openRow(row)} className={`h-[72px] cursor-pointer transition-colors duration-fast ease-standard ${picked ? 'bg-callout-bg' : rest}`}>
                      {canEdit && (
                        <td className={cell}>
                          <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} className="h-4 w-4 accent-brand-600"
                            onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
                        </td>
                      )}
                      <td className={`${cell} max-w-[280px] min-w-[180px]`}>{nameCell(row)}</td>
                      <td className={`${cell} whitespace-nowrap text-ink-800`}>{typeShortLabel(row.campaign_type)}</td>
                      <td className={cell}><ChannelCell channel={row.channel} /></td>
                      <td className={`${cell} whitespace-nowrap`}>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={row.display_status} label={row.display_status_label} />
                          {row.approval?.status === 'REQUESTED' && <Tag>Awaiting Approval</Tag>}
                        </span>
                      </td>
                      <td className={cell}><TriggeredCell campaign={row} /></td>
                      <td className={`${cell} cep-num font-medium ${row.audience_size === null ? 'text-ink-300' : 'text-ink-900'}`}>{formatNumber(row.audience_size)}</td>
                      <td className={cell}><NextSendCell campaign={row} zone={workspaceZone} /></td>
                      <td className={`${cell} cep-num whitespace-nowrap text-helper text-ink-800`}>{formatDate(row.created_at)}</td>
                      <td className={`${cell} text-right whitespace-nowrap`}><RowAction campaign={row} rights={rowRights} onAct={(action) => run(row, action)} />{rowMenu(row)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {footer}
        </div>
      ) : (
        <>
          <ul aria-label="Campaigns" className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} onClick={openRow(row)}
                className={`cursor-pointer rounded-lg border border-line p-4 transition-colors duration-fast ease-standard ${row.is_journey_generated ? 'bg-surface-subtle' : 'bg-surface hover:bg-surface-subtle'}`}>
                <div className="flex items-start justify-between gap-3">
                  {nameCell(row)}
                  <span className="flex shrink-0 items-center"><RowAction campaign={row} rights={rowRights} onAct={(action) => run(row, action)} />{rowMenu(row)}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-helper text-ink-800">
                  <StatusBadge status={row.display_status} label={row.display_status_label} />
                  {row.approval?.status === 'REQUESTED' && <Tag>Awaiting Approval</Tag>}
                  <ChannelCell channel={row.channel} />
                  <span>{typeShortLabel(row.campaign_type)}</span>
                  <span className="cep-num">{scheduledText(row)}{row.next_run_at ? ` · ${timeInZone(row.next_run_at, row.send_timezone || workspaceZone)}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
          {footer && <div className="mt-3 rounded-lg border border-line bg-surface">{footer}</div>}
        </>
      )}

      {previewCampaign && (
        <CampaignPreview
          campaign={previewCampaign}
          canEdit={canEdit}
          onClose={closePreview}
          onAction={(action) => { setAfterPreview({ campaign: previewCampaign, action }); closePreview() }}
          nav={previewNav}
          returnFocus={() => document.querySelector<HTMLElement>(`[data-campaign-name="${shownPreview.current?.id}"]`)}
        />
      )}

      {confirming && CONFIRM[confirming.action] && (
        <Modal
          title={CONFIRM[confirming.action]!.title}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setConfirming(null)}>Keep as It Is</button>
              <button type="button" className={buttonPrimary} disabled={act.isPending} onClick={() => act.mutate(confirming)}>{CONFIRM[confirming.action]!.button}</button>
            </>
          }
        >
          <p className="text-sm text-ink-800">{CONFIRM[confirming.action]!.text(confirming.campaign)}</p>
          {act.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-text">{problemText(act.error)}</p>}
        </Modal>
      )}
      {bulkArchive && (
        <Modal
          title={`Archive ${selected.length} campaign${selected.length === 1 ? '' : 's'}?`}
          onClose={() => setBulkArchive(false)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setBulkArchive(false)}>Keep Them</button>
              <button type="button" className={buttonPrimary} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'archive', ids: selected })}>Archive</button>
            </>
          }
        >
          <p className="text-sm text-ink-800">They leave the everyday list. Nothing is deleted: results stay available, and each can be restored. A campaign that cannot be archived now is left as it is and named afterwards.</p>
        </Modal>
      )}
      {bulkAsked && (
        <Modal
          title={`Pause ${selected.length} campaign${selected.length === 1 ? '' : 's'}?`}
          onClose={() => setBulkAsked(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setBulkAsked(null)}>Keep Them Running</button>
              <button type="button" className={buttonPrimary} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: bulkAsked, ids: selected })}>Pause</button>
            </>
          }
        >
          <p className="text-sm text-ink-800">Sending stops for each of them; messages already handed to the provider still go out. A campaign that cannot be paused now is left as it is and named afterwards.</p>
        </Modal>
      )}
      {createOpen && canEdit && <CampaignSetupDialog onClose={closeCreate} />}
    </section>
  )
}
