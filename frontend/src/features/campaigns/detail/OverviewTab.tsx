/** Overview: what the campaign is, where it stands, its runs, and the latest entries of its log. */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { ReceiptApiPanel } from '@/features/delivery/RunResults'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber, humanize } from '@/lib/format'
import type { Campaign, CampaignActivity, CampaignMetrics, CampaignRun } from '@/lib/types'

import { Definition, Panel, StatTile } from '../parts'
import { channelLabel, hasAction, isText, typeLabel, whenText } from '../vocabulary'
import { formatInZone } from '../zone'

const runColumns: Column<CampaignRun>[] = [
  { key: 'number', header: 'Run', render: (run) => <span className="font-medium text-ink-900">#{run.run_number}{run.sequence_label ? ` · ${run.sequence_label}` : ''}</span> },
  { key: 'type', header: 'Type', render: (run) => humanize(run.run_type) },
  { key: 'status', header: 'Status', render: (run) => <StatusBadge status={run.status} /> },
  { key: 'mode', header: 'Mode', render: (run) => <Tag>{run.test_mode ? 'TEST' : 'PRODUCTION'}</Tag> },
  { key: 'scheduled', header: 'Scheduled', render: (run) => formatDateTime(run.scheduled_at) },
  { key: 'started', header: 'Started', render: (run) => formatDateTime(run.started_at) },
  { key: 'completed', header: 'Completed', render: (run) => formatDateTime(run.completed_at) },
]

export function OverviewTab({ campaign, zone, live }: { campaign: Campaign; zone: string; live: boolean }) {
  const sent = hasAction(campaign, 'results')
  const metrics = useQuery({
    queryKey: ['campaigns', 'metrics', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignMetrics>(`/campaigns/${campaign.id}/metrics/`, undefined, signal),
    enabled: sent,
    refetchInterval: live ? 5000 : false,
  })
  const activity = useQuery({
    queryKey: ['campaigns', 'activity', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignActivity[]>(`/campaigns/${campaign.id}/activity/`, undefined, signal),
  })
  const counts = metrics.data?.counts
  const rates = metrics.data?.rates
  const runs = [...campaign.runs].sort((a, b) => b.run_number - a.run_number)

  return (
    <div className="space-y-6">
      {sent && (
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Audience" value={formatNumber(campaign.audience_size)} note="In the last frozen Campaign List" />
          <StatTile label="Sent" value={counts ? formatNumber(counts.sent) : '–'} note={counts?.queued ? `${formatNumber(counts.queued)} still queued` : undefined} />
          <StatTile label="Delivery rate" value={rates ? `${rates.delivery}%` : '–'} />
          {isText(campaign) ? <StatTile label="Replies" value={counts ? formatNumber(counts.replied) : '–'} /> : <StatTile label="Open rate" value={rates ? `${rates.open}%` : '–'} />}
        </dl>
      )}

      <Panel title="About this campaign">
        <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Definition label="Code">{campaign.code ?? '—'}</Definition>
          <Definition label="Type">{typeLabel(campaign.campaign_type)}</Definition>
          <Definition label="Channel"><Tag>{channelLabel(campaign.channel)}</Tag></Definition>
          <Definition label="Message purpose">{humanize(campaign.solicitation_type)}</Definition>
          <Definition label="Owner">{campaign.owner_name ?? 'No owner'}</Definition>
          <Definition label="Triggered by">{campaign.is_journey_generated ? 'A journey' : 'Created directly'}</Definition>
          <Definition label="When">{whenText(campaign, zone)}</Definition>
          <Definition label="Next send">{campaign.next_run_at ? formatInZone(campaign.next_run_at, zone) : 'None waiting'}</Definition>
          <Definition label="Template">{campaign.template_name ?? 'Not chosen yet'}</Definition>
          <Definition label="Sender">{campaign.sender_profile_name ?? 'Not chosen yet'}</Definition>
          <Definition label="Created">{formatDateTime(campaign.created_at)}</Definition>
          <Definition label={campaign.completed_at ? 'Completed' : campaign.published_at ? 'Published' : 'Updated'}>{formatDateTime(campaign.completed_at ?? campaign.published_at ?? campaign.updated_at)}</Definition>
          <div className="sm:col-span-2 xl:col-span-4">
            <Definition label="Tags">{campaign.tags.length ? <span className="flex flex-wrap gap-1">{campaign.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</span> : 'None'}</Definition>
          </div>
        </dl>
      </Panel>

      {campaign.campaign_type === 'E_RECEIPT' && <ReceiptApiPanel campaignRef={campaign.code ?? campaign.id} published={['PRODUCTION_PUBLISHED', 'ACTIVE'].includes(campaign.status)} />}

      <section>
        <h2 className="mb-3 font-display text-section-title font-semibold text-ink-900">Runs{live && <span className="ml-2 text-xs font-normal text-ink-500">updating every few seconds</span>}</h2>
        {runs.length === 0
          ? <EmptyState title="No runs yet" hint="Publishing the campaign creates run #1 and the send engine starts it. Recurring and drip campaigns add a run per send." />
          : <DataTable columns={runColumns} rows={runs} rowKey={(run) => run.id} caption="Campaign runs" />}
      </section>

      <Panel title="Latest activity" actions={<Link to="?tab=activity" className="text-sm font-medium text-brand-800 hover:underline">See the whole log</Link>}>
        {(activity.data ?? []).length === 0 ? <p className="text-sm text-ink-500">Nothing recorded yet.</p> : (
          <ul className="divide-y divide-line-subtle">
            {activity.data?.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
                <span className="min-w-0 text-ink-900">{entry.message}</span>
                <span className="shrink-0 text-xs text-ink-500">{entry.actor_name ?? 'System'} · {formatDateTime(entry.occurred_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
