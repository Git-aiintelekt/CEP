/** Journeys landing (phase 6c): the blue Journey Templates panel (Start from Scratch + C360 starters, View More), then
 * Your Journeys — every journey, with search + Status / Triggered By / Channel filters and a grid or list view (the
 * choice is remembered per viewer). Create Journey opens the Setup modal (phase 6e); a starter's preview opens it
 * pre-filled. A row or card opens the preview popover, whose View Details opens the Journey Details page (6d). */
import { AlertTriangle, LayoutGrid, List, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

import { FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { PageHelp } from '@/help/HelpPanel'
import { DataTable, type Column } from '@/components/DataTable'
import { SegmentedControl } from '@/components/SegmentedControl'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { formatDate } from '@/lib/format'
import type { Journey, JourneyStarter, JourneyTriggerFamily } from '@/lib/types'
import { useCursorList } from '@/lib/useCursorList'

import { CHANNEL_META } from './channelMeta'
import { JourneyPreviewPopover } from './JourneyPreviewPopover'
import { JourneySetupModal } from './JourneySetupModal'
import { JourneyTemplatePreviewModal } from './templates/JourneyTemplatePreviewModal'
import { JourneyTemplatesPanel } from './templates/JourneyTemplatesPanel'
import { prefillFor, prefillNamed, type SetupPrefill } from './templates/prefill'
import { StarterGalleryModal } from './templates/StarterGalleryModal'
import { JourneyCard } from './templates/TemplateCards'
import { FAMILY_META, FAMILY_OPTIONS } from './triggerFamily'

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' }, { value: 'TEST', label: 'Test' }, { value: 'APPROVED', label: 'Approved' },
  { value: 'ACTIVE', label: 'Active' }, { value: 'PAUSED', label: 'Paused' }, { value: 'ARCHIVED', label: 'Archived' },
]
const NEEDS_ATTENTION = 'NEEDS_ATTENTION'
const CHANNEL_OPTIONS = [{ value: 'EMAIL', label: 'Email' }, { value: 'SMS', label: 'SMS' }]

type View = 'grid' | 'list'

const VIEW_KEY = 'cep.journeys.view'
const VIEW_OPTIONS = [
  { value: 'grid' as const, label: 'Grid View', icon: LayoutGrid },
  { value: 'list' as const, label: 'List View', icon: List },
]

/** List until the viewer picks otherwise: the table is what the page has always shown. */
function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function JourneyCell({ journey }: { journey: Journey }) {
  const family = journey.trigger_family ? FAMILY_META[journey.trigger_family] : null
  const Icon = family?.icon
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${family?.tile ?? 'bg-fill-subtle text-ink-800'}`}>
        {Icon && <Icon size={16} strokeWidth={1.5} />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-card-title font-semibold text-ink-900">{journey.name}</p>
        <p className="truncate text-helper text-ink-800">{family?.label ?? 'No trigger set'}</p>
      </div>
      {journey.needs_attention && (
        <span title="Needs attention: a recent campaign run failed">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-danger-text" />
        </span>
      )}
    </div>
  )
}

export function JourneysPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const canEdit = can('journey.edit')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [previewing, setPreviewing] = useState<JourneyStarter | null>(null)
  const [prefill, setPrefill] = useState<SetupPrefill | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [needsAttention, setNeedsAttention] = useState(false)
  const [triggerFamily, setTriggerFamily] = useState<JourneyTriggerFamily | ''>('')
  const [channel, setChannel] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<HTMLElement | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [view, setViewState] = useState<View>(readView)
  const setView = (next: View) => {
    setPreviewId(null)
    setViewState(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // the choice just is not remembered
    }
  }
  const openSetup = (from?: SetupPrefill) => {
    setPrefill(from)
    setSetupOpen(true)
  }
  // Create a Journey Instead (the Create Campaign pop-up on the Campaigns list) arrives with the name and description typed there
  const location = useLocation()
  const handedOver = (location.state as { journeyFrom?: { name: string; description: string } } | null)?.journeyFrom
  useEffect(() => {
    if (!handedOver || !canEdit) return
    openSetup(prefillNamed(handedOver.name, handedOver.description))
    navigate(location.pathname + location.search, { replace: true, state: null })    // once: a reload or Back doesn't open it again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOver])
  const startFromTemplate = (starter: JourneyStarter) => {
    setPreviewing(null)
    setGalleryOpen(false)
    openSetup(prefillFor(starter))
  }
  const resultsWrap = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (previewId === null) {
      setPreviewAnchor(null)
      return
    }
    const row = resultsWrap.current?.querySelector(`[data-row-key="${previewId}"]`)
    setPreviewAnchor(row instanceof HTMLElement ? row : null)
  }, [previewId])

  const list = useCursorList<Journey>('journeys', {
    search: search.trim() || undefined,
    status: needsAttention ? undefined : status || undefined,
    needs_attention: needsAttention ? 'true' : undefined,
    trigger_family: triggerFamily || undefined,
    channel: channel || undefined,
  })
  const total = list.data?.total
  const filtered = search.trim() !== '' || status !== '' || needsAttention || triggerFamily !== '' || channel !== ''

  const statusLabel = needsAttention ? 'Needs Attention' : STATUS_OPTIONS.find((item) => item.value === status)?.label ?? 'Status'
  const familyLabel = FAMILY_OPTIONS.find((item) => item.value === triggerFamily)?.label ?? 'Triggered By'
  const channelLabel = CHANNEL_OPTIONS.find((item) => item.value === channel)?.label ?? 'Channel'

  const previewJourney = previewId ? list.rows.find((row) => row.id === previewId) : undefined

  const columns: Column<Journey>[] = [
    { key: 'journey', header: 'Journey', render: (row) => <JourneyCell journey={row} /> },
    {
      key: 'channel', header: 'Channel',
      render: (row) => (
        <div className="flex flex-col gap-1">
          {row.channels.length === 0
            ? <span className="text-ink-300">—</span>
            : row.channels.map((item) => {
                const meta = CHANNEL_META[item]
                return (
                  <span key={item} className="inline-flex items-center gap-1.5 text-xs text-ink-800">
                    {meta?.icon && <meta.icon size={14} strokeWidth={1.5} aria-hidden />}
                    {meta?.label ?? item}
                  </span>
                )
              })}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'triggered_by', header: 'Triggered by', render: (row) => (row.trigger_family_label ? <Tag>{row.trigger_family_label}</Tag> : <span className="text-ink-300">—</span>) },
    { key: 'created', header: 'Date created', render: (row) => formatDate(row.created_at) },
  ]

  return (
    <section>
      <PageHeader
        title="Journeys"
        help={<PageHelp chapter="journeys" />}
        actions={canEdit && (
          <button type="button" className={buttonPrimary} onClick={() => openSetup()}>
            <Plus size={16} strokeWidth={2} aria-hidden /> Create Journey
          </button>
        )}
      />

      <div className="mb-10">
        <JourneyTemplatesPanel
          onScratch={canEdit ? () => openSetup() : undefined}
          onPreview={setPreviewing}
          onViewMore={() => setGalleryOpen(true)}
        />
      </div>

      <section aria-labelledby="your-journeys-title">
        <h2 id="your-journeys-title" className="mb-4 flex items-center gap-2 font-display text-section-title font-semibold text-ink-900">
          Your Journeys
          {total !== undefined && <span className="cep-num inline-flex h-[22px] items-center rounded-sm bg-fill-subtle px-2 font-body text-xs font-semibold text-ink-800">{total}</span>}
        </h2>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search journeys" aria-label="Search journeys"
            className="h-10 w-full rounded-control-lg border border-line-control bg-surface px-3 text-sm sm:w-64" />

          <FilterChip label={statusLabel} active={status !== '' || needsAttention} menuLabel="Filter by status">
            {({ close }) => (
              <SingleSelectMenu
                label="Status"
                value={needsAttention ? NEEDS_ATTENTION : status}
                options={[{ value: '', label: 'All Statuses' }, ...STATUS_OPTIONS, { value: NEEDS_ATTENTION, label: 'Needs Attention' }]}
                onChange={(value) => {
                  setNeedsAttention(value === NEEDS_ATTENTION)
                  setStatus(value === NEEDS_ATTENTION ? '' : value)
                  close()
                }}
              />
            )}
          </FilterChip>

          <FilterChip label={familyLabel} active={triggerFamily !== ''} menuLabel="Filter by triggered by">
            {({ close }) => (
              <SingleSelectMenu
                label="Triggered by"
                value={triggerFamily}
                options={[{ value: '', label: 'All' }, ...FAMILY_OPTIONS]}
                onChange={(value) => {
                  setTriggerFamily(value as JourneyTriggerFamily | '')
                  close()
                }}
              />
            )}
          </FilterChip>

          <FilterChip label={channelLabel} active={channel !== ''} menuLabel="Filter by channel">
            {({ close }) => (
              <SingleSelectMenu label="Channel" value={channel} options={[{ value: '', label: 'All' }, ...CHANNEL_OPTIONS]} onChange={(value) => { setChannel(value); close() }} />
            )}
          </FilterChip>

          {list.isFetching && <Spinner className="h-4 w-4" />}

          <div className="ml-auto">
            <SegmentedControl label="View" options={VIEW_OPTIONS} value={view} onChange={setView} iconOnly />
          </div>
        </div>

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-10 text-sm text-ink-800"><Spinner /> Loading journeys</div>
        ) : list.rows.length === 0 ? (
          filtered && total !== 0 ? (
            <div className="rounded-lg border border-line px-5 py-10 text-center">
              <p className="text-base font-semibold text-ink-900">No matching journeys</p>
              <p className="mt-1 text-helper text-ink-800">Try another status, trigger or channel, or clear the search.</p>
            </div>
          ) : (
            <EmptyState title="No journeys yet." hint="Start from a template above or from a blank canvas." />
          )
        ) : (
          <>
            <div ref={resultsWrap}>
              {view === 'grid' ? (
                <ul aria-label="Journeys" className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                  {list.rows.map((row) => <li key={row.id} className="min-w-0"><JourneyCard journey={row} onClick={() => setPreviewId(row.id)} /></li>)}
                </ul>
              ) : (
                <DataTable columns={columns} rows={list.rows} rowKey={(row) => row.id} onRowClick={(row) => setPreviewId(row.id)} caption="Journeys" />
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-sm text-ink-800">
              <span>{list.rows.length} journey{list.rows.length === 1 ? '' : 's'} shown</span>
              {(list.hasNext || list.hasPrevious) && (
                <span className="flex gap-2">
                  <button type="button" className={buttonSecondary} disabled={!list.hasPrevious} onClick={list.goPrevious}>Previous</button>
                  <button type="button" className={buttonSecondary} disabled={!list.hasNext} onClick={list.goNext}>Next</button>
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {previewJourney && previewAnchor && (
        <JourneyPreviewPopover
          journey={previewJourney}
          anchor={previewAnchor}
          onClose={() => setPreviewId(null)}
          onViewDetails={() => { setPreviewId(null); navigate(`/journeys/${previewJourney.id}`) }}
        />
      )}

      {galleryOpen && <StarterGalleryModal onClose={() => setGalleryOpen(false)} onPreview={setPreviewing} />}
      {previewing && <JourneyTemplatePreviewModal starter={previewing} canEdit={canEdit} onClose={() => setPreviewing(null)} onUse={startFromTemplate} />}
      {setupOpen && <JourneySetupModal prefill={prefill} onClose={() => setSetupOpen(false)} />}
    </section>
  )
}
