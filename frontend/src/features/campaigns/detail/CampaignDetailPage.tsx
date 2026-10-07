/**
 * One campaign: a header with its main action, Clone and a ⋮ menu, the banners its state calls for, and five tabs
 * (Overview, Performance once there are results (as Overview's Metrics card), Audience except for e-receipts, Content, Activity log).
 * The API says what is allowed (campaign.actions); permissions decide who may ask.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Clock, Copy, EllipsisVertical, ExternalLink, Hand, Workflow } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Button, IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { Popover } from '@/components/Popover'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { Tabs, type TabItem } from '@/components/Tabs'
import { tabId, tabPanelId } from '@/components/tabIds'
import { useToast } from '@/components/Toast'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import type { Campaign, DripStep } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { campaignPageActions, type CampaignMainAction, type CampaignPageMenuItem } from '../campaignMenu'
import { channelIconOf } from '../channelIcons'
import { CopyId } from '../CopyId'
import { DripCloneDialog } from '../DripCloneDialog'
import { isDripSeries } from '../dripLines'
import { CONFIRM, useCampaignAction, type StatusAction } from '../useCampaignAction'
import { CampaignSetupDialog } from '../setup/CampaignSetupDialog'
import { setupHref, setupProgressText, stepsFor } from '../setupFlow'
import { campaignHome, channelLabel, EDIT_PLACE_OF_TAB, hasAction, hasResults, latestFailedRun, typeLabel } from '../vocabulary'
import { dateTimeInZone } from '../zone'
import { dripStepsQuery } from '../dripSteps'
import { pausedLine } from './dripDetail'
import { AudienceTab } from './AudienceTab'
import { ContentTab } from './ContentTab'
import { DripBanners } from './DripBanners'
import { ResumeDialog, RetryDialog, StopDialog } from './DripDialogs'
import { FailedRunBanner } from './FailedRunBanner'
import { ActivityTab } from './MoreTabs'
import { OverviewTab } from './OverviewTab'
import { PerformanceTab } from './PerformanceTab'
import { RecipientsTab } from './RecipientsTab'
import { SkippedDrawer } from './SkippedDrawer'

import { PageHelp } from '@/help/HelpPanel'

type TabKey = 'overview' | 'performance' | 'recipients' | 'audience' | 'content' | 'activity'
const TABS: TabItem<TabKey>[] = [
  { id: 'overview', label: 'Overview' }, { id: 'performance', label: 'Performance' }, { id: 'recipients', label: 'Recipients' }, { id: 'audience', label: 'Audience' },
  { id: 'content', label: 'Content' }, { id: 'activity', label: 'Activity Log' },
]

const tabsFor = (campaign: Campaign) => TABS.filter((item) =>
  (item.id !== 'performance' && item.id !== 'recipients' || hasResults(campaign)) && (item.id !== 'audience' || campaign.campaign_type !== 'E_RECEIPT'))
const LIVE_RUN = ['SCHEDULED', 'PREPARING', 'SENDING']

function MainButton({ main, disabled, onAction }: { main: CampaignMainAction; disabled: boolean; onAction: (action: StatusAction) => void }) {
  const Icon = main.icon
  const content = main.iconAfter ? <>{main.label}<Icon size={16} strokeWidth={1.5} aria-hidden /></> : <><Icon size={16} strokeWidth={1.5} aria-hidden />{main.label}</>
  const button = main.action ? <button type="button" data-main-action className={main.secondary ? buttonSecondary : buttonPrimary} disabled={disabled} onClick={() => onAction(main.action!)}>{content}</button>
    : main.external ? (
      <a href={main.to} target="_blank" rel="noreferrer" data-main-action className={buttonPrimary} aria-label={`${main.label} (opens in a new tab)`}>
        {content}<ExternalLink size={16} strokeWidth={1.5} aria-hidden />
      </a>
    )
    : <Link to={main.to!} data-main-action className={buttonPrimary}>{content}</Link>
  if (!main.hint) return button
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      {button}
      <span className="text-xs text-ink-800">{main.hint}</span>
    </div>
  )
}

export function CampaignDetailPage() {
  const { id = '' } = useParams()
  const { can, me } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [notice, setNotice] = useState<ReactNode>('')
  const [confirming, setConfirming] = useState<StatusAction | null>(null)
  const [cloning, setCloning] = useState(false)
  const menus = useSingleDropdown<'more'>()
  const [focusTest, setFocusTest] = useState(0)
  /** a published drip's own pop-ups and drawer */
  const [dripDialog, setDripDialog] = useState<'resume' | 'stop' | null>(null)
  const [retrying, setRetrying] = useState<DripStep | null>(null)
  const [skipped, setSkipped] = useState<DripStep | null>(null)

  const campaign = useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${id}/`, undefined, signal),
    // a run is started by the send engine after publishing: keep the page fresh while a send is due or going out
    refetchInterval: (query) => (query.state.data?.runs.some((run) => LIVE_RUN.includes(run.status) && (run.status !== 'SCHEDULED' || !run.scheduled_at || new Date(run.scheduled_at).getTime() < Date.now() + 60_000)) ? 5000 : false),
  })
  const publishedDrip = Boolean(campaign.data && campaign.data.campaign_type === 'DRIP' && !['DRAFT', 'TEST_PUBLISHED'].includes(campaign.data.status))
  const dripSteps = useQuery({ ...dripStepsQuery(id), enabled: publishedDrip, refetchInterval: campaign.data?.runs.some((run) => ['PREPARING', 'SENDING'].includes(run.status)) ? 5000 : false })
  const act = useCampaignAction((message, after, action) => {
    setConfirming(null)
    if (action === 'clone') navigate(setupHref(after.id, { step: stepsFor(after.campaign_type)[0].key, details: true })) // the copy opens with its details, to rename it
    else setNotice(message)
  })

  const requested = params.get('tab')
  const tabs = campaign.data ? tabsFor(campaign.data) : TABS
  const tab: TabKey = tabs.find((item) => item.id === requested)?.id ?? 'overview'
  // a hidden or unknown tab (an old ?tab=settings bookmark, Performance before a send) opens Overview
  const misplaced = Boolean(campaign.data && requested && requested !== tab && campaignHome(campaign.data, can('campaign.edit')) === `/campaigns/${campaign.data.id}`)
  useEffect(() => {
    if (misplaced) setParams((current) => { current.delete('tab'); return current }, { replace: true })
  }, [misplaced, setParams])

  if (campaign.isPending) return <p className="flex items-center gap-3 text-sm text-ink-800"><Spinner /> Loading campaign</p>
  if (campaign.isError) return <ErrorState error={campaign.error} onRetry={() => void campaign.refetch()} />

  const data = campaign.data
  // an unfinished setup has no campaign page yet: whoever may edit it continues where it stopped
  const home = campaignHome(data, can('campaign.edit'))
  if (home !== `/campaigns/${data.id}`) return <Navigate to={home} replace />
  const zone = data.send_timezone || me?.tenant.timezone || 'UTC'
  const live = data.runs.some((run) => ['PREPARING', 'SENDING'].includes(run.status))
  const journey = data.is_journey_generated
  const rights = { edit: can('campaign.edit'), publish: can('campaign.publish') }
  const { main, clone, menu } = campaignPageActions(data, rights, EDIT_PLACE_OF_TAB[tab])
  const editable = rights.edit && !journey && hasAction(data, 'edit')
  const editingDetails = editable && params.get('edit') === 'details'
  const setEditingDetails = (open: boolean) => setParams((current) => { if (open) current.set('edit', 'details'); else current.delete('edit'); return current }, { replace: true })
  // the Content tab's Send a test card shows under the same rule
  const canTest = rights.edit && hasAction(data, 'test_publish')
  const canCancelSchedule = rights.publish && !journey && hasAction(data, 'cancel_schedule')
  const failedRun = latestFailedRun(data)

  function run(action: StatusAction) {
    setNotice('')
    if (action === 'clone' && isDripSeries(data)) setCloning(true)
    else if (publishedDrip && (action === 'resume' || action === 'stop')) setDripDialog(action)
    else if (publishedDrip && action === 'pause') act.mutate({ campaign: data, action })
    else if (CONFIRM[action]) setConfirming(action)
    else act.mutate({ campaign: data, action })
  }

  function pick(item: CampaignPageMenuItem) {
    menus.close()
    if ('command' in item && item.command === 'edit-details') setEditingDetails(true)
    else if ('command' in item && item.command === 'copy-id') {
      void navigator.clipboard?.writeText(data.code ?? '').then(() => toast.success('Campaign ID copied'))
    } else if (item.key === 'test-publish' && canTest) {
      setParams({ tab: 'content' }, { replace: true })
      setFocusTest((count) => count + 1)
    } else if (item.action) run(item.action)
    else if (item.to) navigate(item.to)
  }

  const moreOpen = menus.isOpen('more')

  return (
    <section>
      <Link to="/campaigns" className="mb-3 inline-flex items-center gap-1 text-helper text-brand-800 hover:underline">
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden /> Campaigns
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
          <span className="flex min-w-0 items-start gap-1.5"><h1 className="font-display text-page-title font-semibold break-words text-ink-900">{data.name}</h1><PageHelp chapter="campaigns" /></span>
          <div className="flex flex-wrap items-center gap-2" data-testid="campaign-chips">
            <StatusBadge status={data.display_status} label={data.display_status_label} />
            <Tag icon={channelIconOf(data.channel)}>{channelLabel(data.channel)}</Tag>
            <Tag>{typeLabel(data.campaign_type)}</Tag>
            {journey ? <Tag icon={Workflow}>Journey</Tag> : <Tag icon={Hand}>Manual</Tag>}
            {data.code && <CopyId code={data.code} look="chip" />}
          </div>
          {data.description && <p className="max-w-2xl text-sm text-ink-800">{data.description}</p>}
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {main && <MainButton main={main} disabled={act.isPending} onAction={run} />}
          {clone && (
            <Button iconStart={Copy} disabled={act.isPending} onClick={() => run('clone')}>Clone</Button>
          )}
          {menu.length > 0 && (
            <span className="relative inline-block">
              <IconButton {...menus.triggerProps('more')} label="More Actions" icon={EllipsisVertical} variant="outline" size="md" />
              {moreOpen && (
                <Popover label="More Actions" width={220} placement="bottom-end" {...menus.panelProps('more')}>
                  {menu.map((item) => (
                    <MenuRow key={item.key} divider={false} title={item.label} tone={item.danger ? 'error' : 'default'} leading={<item.icon size={16} strokeWidth={1.5} aria-hidden className={item.danger ? 'text-danger-text' : 'text-ink-800'} />} onClick={() => pick(item)} />
                  ))}
                </Popover>
              )}
            </span>
          )}
        </div>
      </header>

      <div className="mt-5 flex flex-col gap-3 empty:hidden">
        {publishedDrip && dripSteps.data && (
          <DripBanners campaign={data} steps={dripSteps.data} zone={zone} canPublish={rights.publish} canCancel={canCancelSchedule} busy={act.isPending}
            onCancelSchedule={() => run('cancel-schedule')} onRetry={setRetrying}
            onView={tabs.some((item) => item.id === 'performance') ? (runId) => setParams({ tab: 'performance', run: runId }, { replace: true }) : undefined} />
        )}
        {!publishedDrip && data.display_status === 'SCHEDULED' && data.next_run_at && (
          <Notice tone="warning" layout="banner" icon={Clock} iconTile title={`Scheduled for ${dateTimeInZone(data.next_run_at, zone)}`}
            action={canCancelSchedule && <Button size="sm" disabled={act.isPending} onClick={() => run('cancel-schedule')}>Cancel Schedule</Button>}>
            <p>Cancelling returns this campaign to a draft.</p>
          </Notice>
        )}
        {failedRun && !publishedDrip && (
          <FailedRunBanner campaign={data} run={failedRun}
            onView={tabs.some((item) => item.id === 'performance') ? () => setParams({ tab: 'performance', run: failedRun.id }, { replace: true }) : undefined} />
        )}
        {journey && (
          <Notice tone="info" layout="banner" title="This campaign is generated by a journey">
            <p>
              It’s managed in the journey and read-only here.{' '}
              <a href="/journeys" target="_blank" rel="noreferrer" aria-label="View Journey (opens in a new tab)" className="font-semibold text-callout-link underline underline-offset-2">View Journey</a>
            </p>
          </Notice>
        )}
        {!data.setup_complete && (
          <Notice tone="warning" layout="banner">
            <p>The setup of this campaign is not finished: it stopped at {setupProgressText(data)}. Someone with the campaign.edit permission can continue it.</p>
          </Notice>
        )}
        {data.status === 'PAUSED' && !publishedDrip && (
          <Notice tone="warning" layout="banner">
            <p>{pausedLine(data.paused, zone)}This campaign is paused. Nothing more goes out, and sends that come due wait, until it is resumed.</p>
          </Notice>
        )}
        {notice && <p role="status" className="rounded-lg border border-line bg-surface-subtle px-4 py-3 text-sm text-ink-900">{notice}</p>}
        {act.isError && !confirming && <ErrorState title="That did not go through" error={act.error} />}
      </div>

      <div className="mt-6 mb-6 flex overflow-x-auto border-b border-line">
        <Tabs label="Campaign sections" idPrefix="campaign" tabs={tabs} value={tab} onChange={(next) => setParams({ tab: next }, { replace: true })} />
      </div>

      <div role="tabpanel" id={tabPanelId('campaign', tab)} aria-labelledby={tabId('campaign', tab)}>
        {tab === 'overview' && <OverviewTab campaign={data} zone={zone} live={live} onSkipped={setSkipped} onRetry={setRetrying} />}
        {tab === 'performance' && <PerformanceTab campaign={data} zone={zone} live={live} focusRun={params.get('run') ?? undefined} onSkipped={setSkipped} />}
        {tab === 'recipients' && <RecipientsTab campaign={data} zone={zone} live={live} />}
        {tab === 'audience' && <AudienceTab campaign={data} zone={zone} />}
        {tab === 'content' && <ContentTab campaign={data} focusTest={focusTest} zone={zone} />}
        {tab === 'activity' && <ActivityTab campaign={data} zone={zone} live={live} />}
      </div>

      {editingDetails && (
        <CampaignSetupDialog campaign={data} onClose={() => setEditingDetails(false)} onReload={() => void campaign.refetch()} />
      )}

      {dripDialog === 'resume' && <ResumeDialog campaign={data} zone={zone} onClose={() => setDripDialog(null)} onDone={(message) => { setDripDialog(null); setNotice(message) }} />}
      {dripDialog === 'stop' && <StopDialog campaign={data} steps={dripSteps.data ?? []} onClose={() => setDripDialog(null)} onDone={(message) => { setDripDialog(null); setNotice(message) }} />}
      {retrying && <RetryDialog campaign={data} step={retrying} onClose={() => setRetrying(null)} onDone={(message) => { setRetrying(null); setNotice(message) }} />}
      {skipped && <SkippedDrawer step={skipped} channel={data.channel} onClose={() => setSkipped(null)} />}
      {cloning && <DripCloneDialog campaign={data} workspaceZone={me?.tenant.timezone || 'UTC'} onClose={() => setCloning(false)} />}

      {confirming && CONFIRM[confirming] && (
        <Modal
          title={publishedDrip && confirming === 'cancel-schedule' ? "Cancel the drip's schedule?" : CONFIRM[confirming]!.title}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setConfirming(null)}>Keep as It Is</button>
              <button type="button" className={buttonPrimary} disabled={act.isPending} onClick={() => act.mutate({ campaign: data, action: confirming })}>{CONFIRM[confirming]!.button}</button>
            </>
          }
        >
          <p className="text-sm text-ink-800">{publishedDrip && confirming === 'cancel-schedule' ? 'Nothing has been sent. It goes back to a draft so you can edit it.' : CONFIRM[confirming]!.text(data)}</p>
          {act.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-text">{problemText(act.error)}</p>}
        </Modal>
      )}
    </section>
  )
}
