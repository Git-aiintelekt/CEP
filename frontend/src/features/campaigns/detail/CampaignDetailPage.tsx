/**
 * One campaign: header with the actions its status allows, and six tabs (Overview, Performance, Audience, Content,
 * Settings, Activity Log). The API says what is allowed (campaign.actions); permissions decide who may ask.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import type { Campaign } from '@/lib/types'

import { CONFIRM, useCampaignAction, type StatusAction } from '../useCampaignAction'
import { campaignHome, channelLabel, hasAction, SETUP_STEPS, STEP_OF_TAB, typeLabel } from '../vocabulary'
import { AudienceTab } from './AudienceTab'
import { ActivityTab, ContentTab, SettingsTab } from './MoreTabs'
import { OverviewTab } from './OverviewTab'
import { PerformanceTab } from './PerformanceTab'

const TABS = [
  { key: 'overview', label: 'Overview' }, { key: 'performance', label: 'Performance' }, { key: 'audience', label: 'Audience' },
  { key: 'content', label: 'Content' }, { key: 'settings', label: 'Settings' }, { key: 'activity', label: 'Activity Log' },
] as const
type TabKey = (typeof TABS)[number]['key']
const LIVE_RUN = ['SCHEDULED', 'PREPARING', 'SENDING']

export function CampaignDetailPage() {
  const { id = '' } = useParams()
  const { can, me } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: TabKey = TABS.some((item) => item.key === params.get('tab')) ? (params.get('tab') as TabKey) : 'overview'
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [notice, setNotice] = useState<ReactNode>('')
  const [confirming, setConfirming] = useState<StatusAction | null>(null)

  const campaign = useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${id}/`, undefined, signal),
    // a run is started by the send engine after publishing: keep the page fresh while a send is due or going out
    refetchInterval: (query) => (query.state.data?.runs.some((run) => LIVE_RUN.includes(run.status) && (run.status !== 'SCHEDULED' || !run.scheduled_at || new Date(run.scheduled_at).getTime() < Date.now() + 60_000)) ? 5000 : false),
  })
  const act = useCampaignAction((message, after, action) => {
    setConfirming(null)
    if (action === 'clone') navigate(`/campaigns/${after.id}/edit`)
    else setNotice(message)
  })

  if (campaign.isPending) return <p className="flex items-center gap-3 text-sm text-ink-500"><Spinner /> Loading campaign</p>
  if (campaign.isError) return <ErrorState error={campaign.error} onRetry={() => void campaign.refetch()} />

  const data = campaign.data
  // an unfinished setup has no campaign page yet: whoever may edit it continues where it stopped
  const home = campaignHome(data, can('campaign.edit'))
  if (home !== `/campaigns/${data.id}`) return <Navigate to={home} replace />
  const zone = data.send_timezone || me?.tenant.timezone || 'UTC'
  const live = data.runs.some((run) => ['PREPARING', 'SENDING'].includes(run.status))
  const canEdit = can('campaign.edit') && !data.is_journey_generated
  const canPublish = can('campaign.publish') && !data.is_journey_generated

  function run(action: StatusAction) {
    setNotice('')
    if (CONFIRM[action]) setConfirming(action)
    else act.mutate({ campaign: data, action })
  }
  function onTabKey(event: KeyboardEvent) {
    const index = TABS.findIndex((item) => item.key === tab)
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    setParams({ tab: TABS[next].key }, { replace: true })
    tabRefs.current[TABS[next].key]?.focus()
  }

  const button = (action: StatusAction, label: string, primary = false) => (
    <button key={action} type="button" className={primary ? buttonPrimary : buttonSecondary} disabled={act.isPending} onClick={() => run(action)}>{label}</button>
  )

  return (
    <section>
      <Link to="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Campaigns
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink-900">{data.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            <StatusBadge status={data.display_status} label={data.display_status_label} />
            <Tag>{channelLabel(data.channel)}</Tag>
            <span>{typeLabel(data.campaign_type)}</span>
            {data.code && <span>· {data.code}</span>}
            {data.is_journey_generated && <span>· Journey-generated, not editable</span>}
          </p>
          {data.description && <p className="mt-2 max-w-2xl text-sm text-ink-500">{data.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && hasAction(data, 'unarchive') && button('unarchive', 'Unarchive')}
          {canEdit && hasAction(data, 'archive') && button('archive', 'Archive')}
          {canEdit && hasAction(data, 'clone') && button('clone', 'Clone')}
          {canPublish && hasAction(data, 'cancel_schedule') && button('cancel-schedule', 'Cancel schedule')}
          {canPublish && hasAction(data, 'pause') && button('pause', 'Pause')}
          {canPublish && hasAction(data, 'resume') && button('resume', 'Resume', true)}
          {canEdit && hasAction(data, 'edit') && <Link to={`/campaigns/${data.id}/edit?step=${STEP_OF_TAB[tab]}`} className={buttonSecondary}>Edit</Link>}
          {canEdit && hasAction(data, 'test_publish') && <Link to={`/campaigns/${data.id}/edit?step=6`} className={buttonSecondary}>Test Publish</Link>}
          {canPublish && hasAction(data, 'publish') && <Link to={`/campaigns/${data.id}/edit?step=7`} className={buttonPrimary}>Production Publish</Link>}
        </div>
      </div>

      {notice && <p role="status" className="mb-4 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>}
      {act.isError && !confirming && <div className="mb-4"><ErrorState title="That did not go through" error={act.error} /></div>}
      {!data.setup_complete && (
        <p className="mb-4 rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning-text">
          The setup of this campaign is not finished: {data.setup_step} of {SETUP_STEPS} steps are done. Someone with the campaign.edit permission can continue it.
        </p>
      )}
      {data.status === 'PAUSED' && <p className="mb-4 rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning-text">This campaign is paused. Nothing more goes out, and sends that come due wait, until it is resumed.</p>}

      <div role="tablist" aria-label="Campaign sections" onKeyDown={onTabKey} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((item) => (
          <button key={item.key} ref={(node) => { tabRefs.current[item.key] = node }} type="button" role="tab" id={`tab-${item.key}`} aria-selected={tab === item.key} aria-controls={`panel-${item.key}`}
            tabIndex={tab === item.key ? 0 : -1} onClick={() => setParams({ tab: item.key }, { replace: true })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? 'border-brand-600 text-ink-900' : 'border-transparent text-ink-700 hover:text-ink-900'}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <OverviewTab campaign={data} zone={zone} live={live} />}
        {tab === 'performance' && <PerformanceTab campaign={data} live={live} />}
        {tab === 'audience' && <AudienceTab campaign={data} />}
        {tab === 'content' && <ContentTab campaign={data} />}
        {tab === 'settings' && <SettingsTab campaign={data} zone={zone} />}
        {tab === 'activity' && <ActivityTab campaign={data} live={live} />}
      </div>

      {confirming && CONFIRM[confirming] && (
        <Modal
          title={CONFIRM[confirming]!.title}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setConfirming(null)}>Keep as it is</button>
              <button type="button" className={buttonPrimary} disabled={act.isPending} onClick={() => act.mutate({ campaign: data, action: confirming })}>{CONFIRM[confirming]!.button}</button>
            </>
          }
        >
          <p className="text-sm text-ink-700">{CONFIRM[confirming]!.text(data)}</p>
          {act.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-text">{problemText(act.error)}</p>}
        </Modal>
      )}
    </section>
  )
}
