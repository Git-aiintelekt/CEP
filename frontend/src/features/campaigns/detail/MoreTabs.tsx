/** The three quieter tabs of the campaign page: Content, Settings, Activity Log. */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber, humanize } from '@/lib/format'
import type { Campaign, CampaignActivity, CampaignFormOptions } from '@/lib/types'

import { MessagePreview } from '../MessagePreview'
import { Definition, Panel } from '../parts'
import { TestPublishBox } from '../TestPublishBox'
import { hasAction, sendTypeLabel, whenText } from '../vocabulary'

export function ContentTab({ campaign }: { campaign: Campaign }) {
  const { can, me } = useAuth()
  const canTest = can('campaign.edit') && hasAction(campaign, 'test_publish')
  const people = useQuery({
    queryKey: ['campaigns', 'form-options'],
    queryFn: ({ signal }) => api.get<CampaignFormOptions>('/campaigns/form-options/', undefined, signal),
    staleTime: 5 * 60_000,
    enabled: canTest,
  })
  if (!campaign.template) {
    return <EmptyState title="No template chosen yet" hint="Choose the message on the Template step of the campaign setup."
      action={can('campaign.edit') && hasAction(campaign, 'edit') ? <Link to={`/campaigns/${campaign.id}/edit?step=3`} className="font-medium text-brand-800 underline underline-offset-2">Choose a template</Link> : undefined} />
  }
  const email = !['SMS', 'MMS'].includes(campaign.channel)
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="The message" description="With the catalogue's sample values, or as one customer of the audience would get it.">
        <MessagePreview campaignId={campaign.id} withCustomers={campaign.campaign_type !== 'E_RECEIPT'} />
      </Panel>
      <div className="space-y-5 self-start">
        <Panel title="Template and sender">
          <dl className="space-y-4">
            <Definition label="Template">{campaign.template_name}</Definition>
            <Definition label="Sender">{campaign.sender_profile_name ?? 'Not chosen yet'}</Definition>
          </dl>
          {can('template.edit') && (
            <Link to={`/templates/${campaign.template}/${email ? 'design' : 'message'}`} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">
              Open in the {email ? 'designer' : 'message editor'} <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            </Link>
          )}
          {!hasAction(campaign, 'edit') && <p className="mt-3 text-xs text-ink-500">A send uses the template version that is current when the run starts.</p>}
        </Panel>
        {canTest && <Panel title="Send a test"><TestPublishBox campaign={campaign} people={people.data?.owners ?? []} defaultTo={me?.principal.email ?? ''} /></Panel>}
      </div>
    </div>
  )
}

export function SettingsTab({ campaign, zone }: { campaign: Campaign; zone: string }) {
  const { can } = useAuth()
  const editable = can('campaign.edit') && hasAction(campaign, 'edit') && !campaign.is_journey_generated
  const edit = (step: number) => editable && <Link to={`/campaigns/${campaign.id}/edit?step=${step}`} className="text-sm font-medium text-brand-800 hover:underline">Edit</Link>
  const targets = campaign.targets
  const money = (value: string | null | undefined) => (value ? Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : 'Not set')
  const count = (value: number | null | undefined) => (value === null || value === undefined ? 'Not set' : formatNumber(value))
  return (
    <div className="space-y-5">
      {!editable && <p className="rounded-lg border border-line bg-surface-subtle px-4 py-3 text-sm text-ink-700">{campaign.is_journey_generated ? 'These settings come from the journey that generated this campaign.' : 'Settings are fixed once a campaign is published. Clone the campaign to start again from them.'}</p>}
      <Panel title="Scheduling & Delivery" actions={edit(4)}>
        <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <Definition label="Send type">{campaign.campaign_type === 'E_RECEIPT' ? 'Triggered by a purchase' : sendTypeLabel(campaign.send_type)}</Definition>
          <Definition label="When">{whenText(campaign, zone)}</Definition>
          <Definition label="Time zone">{zone}</Definition>
          <Definition label="Corporate frequency limits">{campaign.respect_governance ? 'Applied' : 'Switched off for this campaign'}</Definition>
          <Definition label="Messages per hour">{campaign.rate_limit_per_hour ? `At most ${formatNumber(campaign.rate_limit_per_hour)}` : 'No limit of its own'}</Definition>
          <Definition label="Recipient's local time">{campaign.timezone_optimization ? 'Requested' : 'Not used'}</Definition>
        </dl>
        {(campaign.rate_limit_per_hour || campaign.timezone_optimization) && <p className="mt-4 text-xs text-ink-500">The hourly limit and local-time sending take effect when the delivery engine integration is switched on.</p>}
        {campaign.send_type === 'DRIP' && (campaign.drip_config?.steps.length ?? 0) > 0 && (
          <ol className="mt-4 flex flex-wrap gap-2" aria-label="Series steps">
            {campaign.drip_config?.steps.map((step) => <li key={step.day}><Tag>{`Day ${step.day}${step.label ? ` · ${step.label}` : ''}`}</Tag></li>)}
          </ol>
        )}
      </Panel>
      <Panel title="Targets & Economics" actions={edit(5)}>
        {!targets ? <p className="text-sm text-ink-500">No targets were set.</p> : (
          <>
            <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <Definition label="Revenue">{money(targets.target_revenue)}</Definition>
              <Definition label="Conversions">{count(targets.target_conversions)}</Definition>
              <Definition label="Opens">{count(targets.target_opens)}</Definition>
              <Definition label="Clicks">{count(targets.target_clicks)}</Definition>
              <Definition label="Offer redemptions">{count(targets.target_redemptions)}</Definition>
              <Definition label="Planned campaign cost">{money(targets.planned_cost)}</Definition>
              <Definition label="Planned offer cost">{money(targets.planned_offer_cost)}</Definition>
            </dl>
            {targets.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-ink-700">{targets.notes}</p>}
          </>
        )}
      </Panel>
      <Panel title="Record">
        <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Definition label="Code">{campaign.code ?? '—'}</Definition>
          <Definition label="Created">{formatDateTime(campaign.created_at)}</Definition>
          <Definition label="Published">{formatDateTime(campaign.published_at)}</Definition>
          <Definition label="Completed">{formatDateTime(campaign.completed_at)}</Definition>
          {campaign.archived_at && <Definition label="Archived">{formatDateTime(campaign.archived_at)}</Definition>}
        </dl>
      </Panel>
    </div>
  )
}

const SEVERITY: Record<string, string> = { INFO: 'COMPLETED', WARNING: 'PAUSED', ERROR: 'FAILED' }

export function ActivityTab({ campaign, live }: { campaign: Campaign; live: boolean }) {
  const [only, setOnly] = useState('')
  const activity = useQuery({
    queryKey: ['campaigns', 'activity', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignActivity[]>(`/campaigns/${campaign.id}/activity/`, undefined, signal),
    refetchInterval: live ? 10000 : false,
  })
  if (activity.isPending) return <p className="flex items-center gap-3 text-sm text-ink-500"><Spinner /> Loading the log</p>
  if (activity.isError) return <ErrorState title="The activity log could not be loaded" error={activity.error} onRetry={() => void activity.refetch()} />
  const entries = activity.data.filter((entry) => only === '' || entry.severity === only)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Who did what, and what the send engine did, newest first. Entries are never changed or removed.</p>
        <select aria-label="Show" value={only} onChange={(event) => setOnly(event.target.value)} className="h-10 rounded-control-lg border border-line bg-surface px-2.5 text-sm text-ink-900">
          <option value="">Everything</option><option value="WARNING">Warnings</option><option value="ERROR">Errors</option>
        </select>
      </div>
      {entries.length === 0 ? <EmptyState title={only ? 'Nothing of that kind' : 'Nothing recorded yet'} /> : (
        <ol className="divide-y divide-line rounded-lg border border-line bg-surface" aria-label="Activity log">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-900">{humanize(entry.event_type)}</span>
                  {entry.severity !== 'INFO' && <StatusBadge status={SEVERITY[entry.severity]} label={humanize(entry.severity)} />}
                </p>
                <p className="mt-0.5 text-ink-700">{entry.message}</p>
              </div>
              <p className="shrink-0 text-xs text-ink-500">{entry.actor_name ?? 'System'} · {formatDateTime(entry.occurred_at)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
