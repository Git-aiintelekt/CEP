/**
 * Campaigns landing (BRD 6.3): what is coming up, then two views of the same filtered campaigns. List view: search,
 * filters, sorting, pages of 50, row actions by status and bulk clone / archive. Calendar view: the month, a bar per campaign. Archived campaigns stay out unless the Status filter asks for them.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronsUpDown, Image, Mail, MessageSquare, MoreVertical, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { Tabs } from '@/components/Tabs'
import { tabPanelId } from '@/components/tabIds'
import { buttonClass, iconButtonClass } from '@/components/buttonStyles'
import { MenuRow } from '@/components/MenuRow'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { Campaign, CampaignFormOptions, CountedPage } from '@/lib/types'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

import { CampaignCalendar } from './CampaignCalendar'
import { CONFIRM, useBulkAction, useCampaignAction, type StatusAction } from './useCampaignAction'
import { CAMPAIGN_TYPES, campaignHome, channelLabel, hasAction, STATUS_FILTERS, typeLabel } from './vocabulary'

const PAGE_SIZE = 50
const EMPTY_FILTERS = { status: '', type: '', channel: '', triggered_by: '', tag: '', owner: '', date_from: '', date_to: '' }
type Filters = typeof EMPTY_FILTERS

const SORTABLE: { key: string; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Campaign name' }, { key: 'campaign_type', label: 'Topic' }, { key: 'channel', label: 'Channel' }, { key: 'status', label: 'Status' },
  { key: '', label: 'Triggered by' }, { key: '', label: 'Audience', align: 'right' }, { key: 'next_run', label: 'Scheduled' }, { key: 'created_at', label: 'Created' },
]

/** the one thing most people want to do with a campaign in this state (the prototype's Edit / View / Continue setup) */
function primaryAction(campaign: Campaign, canEdit: boolean): { label: string; to: string } {
  if (canEdit && hasAction(campaign, 'edit') && !campaign.is_journey_generated) {
    return campaign.setup_complete ? { label: 'Edit', to: `/campaigns/${campaign.id}/edit` } : { label: 'Continue setup', to: campaignHome(campaign, canEdit) }
  }
  return hasAction(campaign, 'results') ? { label: 'View results', to: `/campaigns/${campaign.id}?tab=performance` } : { label: 'View', to: `/campaigns/${campaign.id}` }
}

function scheduledText(campaign: Campaign): string {
  if (campaign.next_run_at) return formatDate(campaign.next_run_at)
  if (campaign.campaign_type === 'E_RECEIPT' && ['PRODUCTION_PUBLISHED', 'ACTIVE'].includes(campaign.status)) return 'Ongoing'
  return formatDate(campaign.scheduled_at ?? campaign.published_at)
}

function RowMenu({ campaign, canEdit, canPublish, onAction }: { campaign: Campaign; canEdit: boolean; canPublish: boolean; onAction: (action: StatusAction) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const entries: { label: string; run: () => void }[] = [{ label: 'Open', run: () => navigate(campaignHome(campaign, canEdit)) }]
  if (hasAction(campaign, 'results')) entries.push({ label: 'View results', run: () => navigate(`/campaigns/${campaign.id}?tab=performance`) })
  if (canEdit && hasAction(campaign, 'clone')) entries.push({ label: 'Clone', run: () => onAction('clone') })
  if (canPublish && hasAction(campaign, 'pause')) entries.push({ label: 'Pause', run: () => onAction('pause') })
  if (canPublish && hasAction(campaign, 'resume')) entries.push({ label: 'Resume', run: () => onAction('resume') })
  if (canPublish && hasAction(campaign, 'cancel_schedule')) entries.push({ label: 'Cancel schedule', run: () => onAction('cancel-schedule') })
  if (canEdit && hasAction(campaign, 'archive')) entries.push({ label: 'Archive', run: () => onAction('archive') })
  if (canEdit && hasAction(campaign, 'unarchive')) entries.push({ label: 'Unarchive', run: () => onAction('unarchive') })

  return (
    <div ref={box} className="relative inline-block">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${campaign.name}`} onClick={() => setOpen((value) => !value)}
        className={iconButtonClass({ pressed: open })}>
        <MoreVertical size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-line bg-surface shadow-menu">
          {entries.map((entry) => (
            <MenuRow key={entry.label} role="menuitem" divider={false} title={entry.label} onClick={() => { setOpen(false); entry.run() }} />
          ))}
        </div>
      )}
    </div>
  )
}

const CHANNEL_ICON: Record<string, LucideIcon> = { EMAIL: Mail, SMS: MessageSquare, MMS: Image }
const VIEWS = [{ id: 'list' as const, label: 'List view' }, { id: 'calendar' as const, label: 'Calendar view' }]

/** "Aug 20" and "09:00 CDT": a send is announced in the campaign's own time zone, the one it was scheduled in */
function sendDay(iso: string, zone: string) {
  const at = new Date(iso)
  const safe = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone }).format(at)
    } catch {
      return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(at)
    }
  }
  return { day: safe({ month: 'short', day: 'numeric' }), time: safe({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }) }
}

function Upcoming({ workspaceZone, canEdit }: { workspaceZone: string; canEdit: boolean }) {
  const upcoming = useQuery({
    queryKey: ['campaigns', 'upcoming'],
    queryFn: ({ signal }) => api.get<CountedPage<Campaign>>('/campaigns/', { status: 'SCHEDULED', ordering: 'next_run', page_size: 4 }, signal),
  })
  const rows = (upcoming.data?.results ?? []).filter((campaign) => campaign.next_run_at)
  return (
    <section aria-labelledby="upcoming-title" className="mb-6">
      <h2 id="upcoming-title" className="mb-2 font-display text-section-title font-semibold text-ink-900">Upcoming campaigns</h2>
      {upcoming.isError ? (
        <ErrorState title="The upcoming campaigns could not be loaded" error={upcoming.error} onRetry={() => void upcoming.refetch()} />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-4 text-sm text-ink-500">
          {upcoming.isPending ? 'Loading' : `Nothing is scheduled. A campaign appears here once it is published with a send time ahead${canEdit ? ': choose “Schedule for later” or “Recurring” on the Scheduling step.' : '.'}`}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((campaign) => {
            const Icon = CHANNEL_ICON[campaign.channel] ?? Mail
            const when = sendDay(campaign.next_run_at as string, campaign.send_timezone || workspaceZone)
            return (
              <li key={campaign.id} className="min-w-0">
                <Link to={`/campaigns/${campaign.id}`} className="block rounded-lg border border-line bg-surface p-4 transition-colors duration-fast hover:bg-surface-subtle">
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-700">
                    <Icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden />
                    <span className="truncate">{campaign.name}</span>
                  </p>
                  <p className="cep-num font-display text-3xl font-semibold text-ink-900">{when.day}</p>
                  <p className="mt-1 truncate text-xs text-ink-500">
                    {when.time}{campaign.audience_size ? ` · ${formatNumber(campaign.audience_size)} recipients` : ''}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function CampaignListPage() {
  const navigate = useNavigate()
  const { can, me } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list'
  const workspaceZone = me?.tenant.timezone || 'UTC'
  const canEdit = can('campaign.edit')
  const canPublish = can('campaign.publish')
  const wide = useMinWidth(BREAKPOINT.md)

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [ordering, setOrdering] = useState('-created_at')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState<ReactNode>('')
  const [confirming, setConfirming] = useState<{ campaign: Campaign; action: StatusAction } | null>(null)
  const [bulkArchive, setBulkArchive] = useState(false)

  const query = { search: search.trim(), ...filters, ordering, page, page_size: PAGE_SIZE }
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
    setNotice(action === 'clone' ? <>{message} <Link to={`/campaigns/${after.id}/edit`} className="font-medium underline underline-offset-2">Open the copy</Link></> : message)
  })
  const bulk = useBulkAction((result) => {
    setBulkArchive(false)
    setSelected([])
    const verb = result.action === 'clone' ? 'cloned' : 'archived'
    setNotice(`${result.done.length} campaign${result.done.length === 1 ? '' : 's'} ${verb}.` + (result.skipped.length ? ` Left as they were: ${result.skipped.map((item) => `${item.name} (${item.reason})`).join('; ')}` : ''))
  })

  const rows = list.data?.results ?? []
  const total = list.data?.count ?? 0
  const filtered = search.trim() !== '' || Object.values(filters).some(Boolean)
  const pageIds = rows.map((row) => row.id)
  const allPicked = pageIds.length > 0 && pageIds.every((id) => selected.includes(id))

  function change<K extends keyof Filters>(key: K, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
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

  const control = 'h-10 rounded-control-lg border border-line bg-surface px-2.5 text-sm text-ink-900'
  const dropdown = (label: string, key: keyof Filters, choices: { value: string; label: string }[]) => (
    <select aria-label={label} value={filters[key]} onChange={(event) => change(key, event.target.value)} className={control}>
      <option value="">{label}</option>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  )

  const nameCell = (row: Campaign) => (
    <div className="min-w-0">
      <Link to={campaignHome(row, canEdit)} className="block truncate font-medium text-ink-900 hover:underline">{row.name}</Link>
      <p className="truncate text-xs text-ink-500">
        {row.is_journey_generated ? 'Journey-generated · not editable' : row.setup_complete ? row.code : `Setup not finished: step ${row.setup_step + 1} of 7`}
      </p>
    </div>
  )

  return (
    <section>
      <PageHeader
        title="Campaigns"
        description="One-time, recurring, drip and e-receipt campaigns. Every send is a run of its campaign, against a Campaign List frozen when the run starts."
        actions={canEdit && <Link to="/campaigns/new" className={`${buttonPrimary} px-5`}>Create Campaign</Link>}
      />

      <div className="mb-5 flex border-b border-line">
        <Tabs label="Campaign views" idPrefix="campaign-views" tabs={VIEWS} value={view} onChange={(next) => setParams(next === 'calendar' ? { view: 'calendar' } : {}, { replace: true })} />
      </div>

      <Upcoming workspaceZone={workspaceZone} canEdit={canEdit} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search by name or code" aria-label="Search campaigns" className={`${control} w-full sm:w-64`} />
        {dropdown('Status', 'status', STATUS_FILTERS)}
        {dropdown('Topic', 'type', CAMPAIGN_TYPES.map((item) => ({ value: item.value, label: item.label })))}
        {dropdown('Channel', 'channel', ['EMAIL', 'SMS', 'MMS'].map((value) => ({ value, label: channelLabel(value) })))}
        {dropdown('Triggered by', 'triggered_by', [{ value: 'manual', label: 'Manual' }, { value: 'journey', label: 'Journey' }])}
        {(options.data?.tags.length ?? 0) > 0 && dropdown('Tag', 'tag', (options.data?.tags ?? []).map((tag) => ({ value: tag, label: tag })))}
        {(options.data?.owners.length ?? 0) > 1 && dropdown('Owner', 'owner', (options.data?.owners ?? []).map((owner) => ({ value: owner.id, label: owner.name })))}
        {view === 'list' && <label className="flex items-center gap-2 text-sm text-ink-500">Created from
          <input type="date" value={filters.date_from} max={filters.date_to || undefined} onChange={(event) => change('date_from', event.target.value)} className={control} />
        </label>}
        {view === 'list' && <label className="flex items-center gap-2 text-sm text-ink-500">to
          <input type="date" value={filters.date_to} min={filters.date_from || undefined} onChange={(event) => change('date_to', event.target.value)} className={control} />
        </label>}
        {filtered && <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => { setSearch(''); setFilters(EMPTY_FILTERS); setPage(1) }}>Clear filters</button>}
        {view === 'list' && list.isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {notice && <p role="status" className="mb-3 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>}
      {act.isError && <div className="mb-3"><ErrorState title="That did not go through" error={act.error} /></div>}
      {bulk.isError && <div className="mb-3"><ErrorState title="The selected campaigns were not changed" error={bulk.error} /></div>}

      {view === 'list' && selected.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-callout-bg px-4 py-2 text-sm text-callout-text">
          <span className="font-medium">{selected.length} selected</span>
          <button type="button" className={buttonSecondary} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'clone', ids: selected })}>Clone</button>
          <button type="button" className={buttonSecondary} disabled={bulk.isPending} onClick={() => setBulkArchive(true)}>Archive</button>
          <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setSelected([])}>Clear selection</button>
        </div>
      )}

      {view === 'calendar' ? (
        <div role="tabpanel" id={tabPanelId('campaign-views', 'calendar')} aria-label="Calendar view">
          <CampaignCalendar zone={workspaceZone} canEdit={canEdit}
            filters={Object.fromEntries(Object.entries({ search: search.trim(), status: filters.status, type: filters.type, channel: filters.channel, triggered_by: filters.triggered_by, tag: filters.tag, owner: filters.owner }).filter(([, value]) => value))} />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-10 text-sm text-ink-500"><Spinner /> Loading campaigns</div>
      ) : rows.length === 0 ? (
        <EmptyState title={filtered ? 'Nothing matches these filters' : 'No campaigns yet'} hint={filtered ? undefined : 'Create the first campaign with the Create Campaign button.'} />
      ) : wide ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="min-w-full divide-y divide-line text-sm">
            <caption className="sr-only">Campaigns</caption>
            <thead className="bg-surface-subtle">
              <tr>
                {canEdit && (
                  <th scope="col" className="w-10 px-3">
                    <input type="checkbox" aria-label="Select every campaign on this page" checked={allPicked} className="h-4 w-4 accent-brand-600"
                      onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...pageIds])] : selected.filter((id) => !pageIds.includes(id)))} />
                  </th>
                )}
                {SORTABLE.map((column) => {
                  const direction = ordering === column.key ? 'ascending' : ordering === `-${column.key}` ? 'descending' : undefined
                  return (
                    <th key={column.label} scope="col" aria-sort={column.key ? (direction ?? 'none') : undefined} className={`h-10 whitespace-nowrap px-3 text-xs font-semibold text-ink-700 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {column.key ? (
                        <button type="button" onClick={() => sortBy(column.key)} className="inline-flex items-center gap-1 hover:text-ink-900">
                          {column.label}
                          {direction === 'ascending' ? <ArrowUp size={14} strokeWidth={1.5} aria-hidden /> : direction === 'descending' ? <ArrowDown size={14} strokeWidth={1.5} aria-hidden /> : <ChevronsUpDown size={14} strokeWidth={1.5} className="text-ink-300" aria-hidden />}
                        </button>
                      ) : column.label}
                    </th>
                  )
                })}
                <th scope="col" className="h-10 px-3 text-right text-xs font-semibold text-ink-700"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const main = primaryAction(row, canEdit)
                return (
                  <tr key={row.id} className={`h-12 ${selected.includes(row.id) ? 'bg-callout-bg' : 'hover:bg-surface-subtle'}`}>
                    {canEdit && (
                      <td className="px-3">
                        <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} className="h-4 w-4 accent-brand-600"
                          onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
                      </td>
                    )}
                    <td className="max-w-xs px-3">{nameCell(row)}</td>
                    <td className="whitespace-nowrap px-3 text-ink-700">{typeLabel(row.campaign_type)}</td>
                    <td className="px-3"><Tag>{channelLabel(row.channel)}</Tag></td>
                    <td className="whitespace-nowrap px-3"><StatusBadge status={row.display_status} label={row.display_status_label} /></td>
                    <td className="px-3 text-ink-700">{row.triggered_by === 'JOURNEY' ? 'Journey' : 'Manual'}</td>
                    <td className="cep-num px-3 text-right text-ink-700">{formatNumber(row.audience_size)}</td>
                    <td className="whitespace-nowrap px-3 text-ink-700">{scheduledText(row)}</td>
                    <td className="whitespace-nowrap px-3 text-ink-700">{formatDate(row.created_at)}</td>
                    <td className="whitespace-nowrap px-3 text-right">
                      <Link to={main.to} className="mr-1 font-medium text-brand-800 hover:underline">{main.label}</Link>
                      <RowMenu campaign={row} canEdit={canEdit} canPublish={canPublish} onAction={(action) => run(row, action)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label="Campaigns" className="space-y-3">
          {rows.map((row) => {
            const main = primaryAction(row, canEdit)
            return (
              <li key={row.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  {nameCell(row)}
                  <RowMenu campaign={row} canEdit={canEdit} canPublish={canPublish} onAction={(action) => run(row, action)} />
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <StatusBadge status={row.display_status} label={row.display_status_label} /><Tag>{channelLabel(row.channel)}</Tag>
                  <span>{typeLabel(row.campaign_type)}</span><span>{scheduledText(row)}</span>
                </p>
                <button type="button" className={`${buttonClass({ variant: 'link', size: 'sm' })} mt-3`} onClick={() => navigate(main.to)}>{main.label}</button>
              </li>
            )
          })}
        </ul>
      )}

      {view === 'list' && total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500">
          <p aria-live="polite">{formatNumber((page - 1) * PAGE_SIZE + 1)} to {formatNumber(Math.min(page * PAGE_SIZE, total))} of {formatNumber(total)}</p>
          {total > PAGE_SIZE && (
            <div className="flex gap-2">
              <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {confirming && CONFIRM[confirming.action] && (
        <Modal
          title={CONFIRM[confirming.action]!.title}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setConfirming(null)}>Keep as it is</button>
              <button type="button" className={buttonPrimary} disabled={act.isPending} onClick={() => act.mutate(confirming)}>{CONFIRM[confirming.action]!.button}</button>
            </>
          }
        >
          <p className="text-sm text-ink-700">{CONFIRM[confirming.action]!.text(confirming.campaign)}</p>
          {act.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-text">{problemText(act.error)}</p>}
        </Modal>
      )}
      {bulkArchive && (
        <Modal
          title={`Archive ${selected.length} campaign${selected.length === 1 ? '' : 's'}?`}
          onClose={() => setBulkArchive(false)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setBulkArchive(false)}>Keep them</button>
              <button type="button" className={buttonPrimary} disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'archive', ids: selected })}>Archive</button>
            </>
          }
        >
          <p className="text-sm text-ink-700">They leave the everyday list. Nothing is deleted: results stay available, and each can be restored. A campaign that cannot be archived now is left as it is and named afterwards.</p>
        </Modal>
      )}
    </section>
  )
}
