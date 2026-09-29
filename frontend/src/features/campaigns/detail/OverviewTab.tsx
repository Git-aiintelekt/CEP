/**
 * Overview: the numbers once it has sent, how the campaign is set up (with its schedule and record), who it reaches and
 * what it says. Its targets and runs sit here until there are results; then the Performance tab has them.
 */
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { SkeletonLine } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { ReceiptApiDetails } from '@/features/delivery/RunResults'
import { formatMoney, formatNumber, titleize } from '@/lib/format'
import type { Campaign } from '@/lib/types'

import { audienceSummary, useCampaignAudience } from '../audienceNumbers'
import { CampaignThumbnail } from '../CampaignThumbnail'
import { Detail } from '../CampaignPreviewDetails'
import { useMessageDetails, type DetailState } from '../messageDetails'
import { CardError, CardLink, CardSubheading, DetailCard, Fact, FACTS_GRID, Metric } from '../parts'
import { setupHref } from '../setupFlow'
import { useCampaignMessage } from '../useCampaignPreview'
import { hasAction, hasResults, isText, sendTypeLabel, whenText } from '../vocabulary'
import { dateTimeInZone } from '../zone'
import { AudienceSummary } from './AudienceSummary'
import { useCampaignMetrics, resultsStamp } from './campaignMetrics'
import { ChecksLine } from './ChecksLine'
import { RunsCard } from './RunsCard'

const plural = (count: number, word: string) => `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`

function MetricsCard({ campaign, zone, live }: { campaign: Campaign; zone: string; live: boolean }) {
  const metrics = useCampaignMetrics(campaign, live)
  const data = metrics.data
  const counts = data?.counts
  const rates = data?.rates
  const texts = isText(campaign)
  const conversionTarget = campaign.targets?.target_conversions
  const conversionNote = conversionTarget ? `${formatNumber(conversionTarget)} targeted`
    : data && !data.conversions && !data.revenue ? 'Arrives with the attribution feed'
    : 'No target set'
  const stamp = resultsStamp(campaign, zone, data ? metrics.dataUpdatedAt : null)

  return (
    <DetailCard title="Metrics" actions={<>{stamp && <span className="text-ink-500">{stamp}</span>}<CardLink to="?tab=performance">See All</CardLink></>}>
      {metrics.isError ? <CardError what="the results" error={metrics.error} onRetry={() => void metrics.refetch()} /> : (
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy={metrics.isPending || undefined}>
          {campaign.campaign_type !== 'E_RECEIPT' && <Metric label="Audience" value={formatNumber(campaign.audience_size)} note="In the last frozen Campaign List" />}
          <Metric label="Sent" value={counts ? formatNumber(counts.sent) : '–'} note={counts?.queued ? `${formatNumber(counts.queued)} still queued` : undefined} />
          <Metric label="Delivery Rate" value={rates ? `${rates.delivery}%` : '–'} note={counts ? `${formatNumber(counts.delivered)} of ${formatNumber(counts.sent)} delivered` : undefined} />
          {texts ? (
            <>
              <Metric label="Replies" value={counts ? formatNumber(counts.replied) : '–'} note={counts ? `from ${formatNumber(counts.delivered)} delivered` : undefined} />
              <Metric label="Opted Out (STOP)" value={counts ? formatNumber(counts.unsubscribed) : '–'} note={rates ? `${rates.unsubscribe}% of delivered` : undefined} />
            </>
          ) : (
            <>
              <Metric label="Opens" value={counts ? formatNumber(counts.opened) : '–'} note={rates ? `${rates.open}% open rate` : undefined} />
              <Metric label="Clicks" value={counts ? formatNumber(counts.clicked) : '–'} note={rates ? `${rates.click}% click rate` : undefined} />
            </>
          )}
          <Metric label="Conversions" value={data ? formatNumber(data.conversions) : '–'} note={data ? conversionNote : undefined} />
        </dl>
      )}
    </DetailCard>
  )
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="border-line-subtle not-first:mt-6 not-first:border-t not-first:pt-6">
      {title && <CardSubheading className="mb-4">{title}</CardSubheading>}
      {children}
    </div>
  )
}

function SetupCard({ campaign, zone, editable }: { campaign: Campaign; zone: string; editable: boolean }) {
  const at = (iso: string | null) => dateTimeInZone(iso, zone)
  const drip = campaign.send_type === 'DRIP' ? campaign.drip_config?.steps ?? [] : []
  return (
    <DetailCard title="Setup" actions={editable && <CardLink to="?edit=details">Edit Setup</CardLink>}>
      <Group>
        <dl className={FACTS_GRID}>
          <Fact label="Message Purpose">{titleize(campaign.solicitation_type)}</Fact>
          <Fact label="Owner">{campaign.owner_name ?? 'No owner'}</Fact>
          <Fact label="Template">{campaign.template_name ?? 'Not chosen yet'}</Fact>
          <Fact label="Sender">{campaign.sender_profile_name ?? 'Not chosen yet'}</Fact>
          <Fact label="Tags" className="col-span-full">{campaign.tags.length ? <span className="flex flex-wrap gap-1">{campaign.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</span> : 'None'}</Fact>
        </dl>
      </Group>
      <Group title="Scheduling & Delivery">
        <dl className={FACTS_GRID}>
          <Fact label="When" secondary={editable && <CardLink to={setupHref(campaign.id, { step: 'publish', section: 'schedule' })}>Edit</CardLink>}>{whenText(campaign, zone, dateTimeInZone)}</Fact>
          <Fact label="Send Type">{campaign.campaign_type === 'E_RECEIPT' ? 'Triggered by a purchase' : sendTypeLabel(campaign.send_type)}</Fact>
          <Fact label="Next Send">{campaign.next_run_at ? at(campaign.next_run_at) : 'None waiting'}</Fact>
          <Fact label="Time Zone">{zone}</Fact>
          <Fact label="Corporate Frequency Limits">{campaign.respect_governance ? 'Applied' : 'Switched off for this campaign'}</Fact>
          <Fact label="Messages per Hour">{campaign.rate_limit_per_hour ? `At most ${formatNumber(campaign.rate_limit_per_hour)}` : 'No limit of its own'}</Fact>
          <Fact label="Recipient's Local Time">{campaign.timezone_optimization ? "Each recipient's own time zone" : 'Not used'}</Fact>
          {drip.length > 0 && (
            <Fact label="Series Steps" className="col-span-full">
              <ol className="flex flex-wrap gap-2" aria-label="Series Steps">
                {drip.map((step) => <li key={step.day}><Tag>{`Day ${step.day}${step.label ? ` · ${step.label}` : ''}`}</Tag></li>)}
              </ol>
            </Fact>
          )}
        </dl>
        {campaign.rate_limit_per_hour && <p className="mt-6 text-helper text-ink-500">The hourly limit takes effect when the delivery engine integration is switched on.</p>}
      </Group>
      <Group title="Record">
        <dl className={FACTS_GRID}>
          <Fact label="Created">{at(campaign.created_at)}</Fact>
          <Fact label="Last Edited">{at(campaign.updated_at)}</Fact>
          <Fact label="Published">{at(campaign.published_at)}</Fact>
          <Fact label="Completed">{at(campaign.completed_at)}</Fact>
          {campaign.archived_at && <Fact label="Archived">{at(campaign.archived_at)}</Fact>}
        </dl>
      </Group>
      {!editable && (
        <p className="mt-6 flex items-center gap-2 text-helper text-ink-500">
          <Lock size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-300" />
          {campaign.is_journey_generated ? 'These settings come from the journey that generated this campaign.' : 'Settings are fixed once a campaign is published. Clone the campaign to start again from them.'}
        </p>
      )}
    </DetailCard>
  )
}

function TargetsCard({ campaign, editable }: { campaign: Campaign; editable: boolean }) {
  const targets = campaign.targets
  const money = (value: string | null | undefined) => (value ? formatMoney(value) : 'Not set')
  const count = (value: number | null | undefined) => (value === null || value === undefined ? 'Not set' : formatNumber(value))
  return (
    <DetailCard title="Targets" actions={editable && <CardLink to={setupHref(campaign.id, { step: 'targets' })}>Edit Targets</CardLink>}>
      {!targets ? <p className="text-sm text-ink-500">No targets were set.</p> : (
        <>
          <dl className={FACTS_GRID}>
            <Fact label="Revenue">{money(targets.target_revenue)}</Fact>
            <Fact label="Conversions">{count(targets.target_conversions)}</Fact>
            <Fact label="Opens">{count(targets.target_opens)}</Fact>
            <Fact label="Clicks">{count(targets.target_clicks)}</Fact>
            <Fact label="Offer Redemptions">{count(targets.target_redemptions)}</Fact>
            <Fact label="Planned Campaign Cost">{money(targets.planned_cost)}</Fact>
            <Fact label="Planned Offer Cost">{money(targets.planned_offer_cost)}</Fact>
          </dl>
          {targets.notes && <p className="mt-6 text-sm whitespace-pre-wrap text-ink-700">{targets.notes}</p>}
        </>
      )}
    </DetailCard>
  )
}

function AudienceCard({ campaign, editable }: { campaign: Campaign; editable: boolean }) {
  const audience = useCampaignAudience(campaign)
  const actions = (
    <>
      <CardLink to="?tab=audience">See All</CardLink>
      {editable && <CardLink to={setupHref(campaign.id, { step: 'audience' })}>Edit Audience</CardLink>}
    </>
  )

  let body: ReactNode
  if (audience.isPending) body = <div className="flex flex-col gap-3" aria-busy><SkeletonLine width="40%" /><SkeletonLine width="100%" /><SkeletonLine width="64%" /></div>
  else if (audience.isError) body = <CardError what="the audience" error={audience.error} onRetry={() => void audience.refetch()} />
  else {
    const lists = audience.data.lists.filter((list) => list.role !== 'EXCLUDE')
    const numbers = audienceSummary(campaign, audience.data)
    body = (
      <div className="flex flex-col gap-4">
        <AudienceSummary numbers={numbers} />
        <p className="text-sm text-ink-700">
          {lists.length === 0 ? (numbers.sent ? 'No lists attached now.' : 'No contact list is attached yet.') : `${plural(lists.length, 'contact list')} · ${lists[0].name}${lists.length > 1 ? ` and ${lists.length - 1} more` : ''}`}
        </p>
      </div>
    )
  }
  return <DetailCard title="Audience" actions={actions}>{body}</DetailCard>
}

function ContentCard({ campaign, editable }: { campaign: Campaign; editable: boolean }) {
  const message = useCampaignMessage(campaign)
  const { channel, content } = message
  const details = useMessageDetails({ campaign, channel, content, tags: content.tags })
  const email = channel === 'EMAIL'
  const receipt = channel === 'E_RECEIPT'
  const template: DetailState = campaign.template_name ? { state: 'ready', value: `Based on ${campaign.template_name}` } : { state: 'missing', text: 'Not chosen yet' }

  return (
    <DetailCard title="Content" actions={<>
      <CardLink to="?tab=content">See All</CardLink>
      {editable && <CardLink to={setupHref(campaign.id, { step: 'content' })}>Edit Content</CardLink>}
    </>}>
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex min-w-0 flex-col gap-5 md:w-[52%]" aria-busy={details.loading || undefined}>
          <Detail label="Template" {...template} />
          {campaign.template && (email || receipt) && <Detail label="Subject Line" {...details.subject(receipt)} />}
          {campaign.template && email && <Detail label="Preheader" {...details.preheader()} />}
          <Detail label="Sender" {...(campaign.sender_profile ? details.sender() : { state: 'missing', text: 'Not chosen yet' } as DetailState)} />
          <ChecksLine campaign={campaign} />
        </div>
        <div tabIndex={0} role="region" aria-label="Message preview" data-content-thumbnail className="flex max-h-[360px] min-w-0 flex-1 justify-center overflow-y-auto rounded-lg bg-surface-sunken p-4">
          <CampaignThumbnail campaign={campaign} message={message} />
        </div>
      </div>
    </DetailCard>
  )
}

export function OverviewTab({ campaign, zone, live }: { campaign: Campaign; zone: string; live: boolean }) {
  const { can } = useAuth()
  const editable = can('campaign.edit') && hasAction(campaign, 'edit') && !campaign.is_journey_generated
  const receipt = campaign.campaign_type === 'E_RECEIPT'
  const sent = hasResults(campaign)
  return (
    <div className="flex flex-col gap-6">
      {sent && <MetricsCard campaign={campaign} zone={zone} live={live} />}
      <SetupCard campaign={campaign} zone={zone} editable={editable} />
      {!receipt && <AudienceCard campaign={campaign} editable={editable} />}
      <ContentCard campaign={campaign} editable={editable} />
      {receipt && (
        <DetailCard title="Sending Receipts">
          <ReceiptApiDetails campaignRef={campaign.code ?? campaign.id} published={['PRODUCTION_PUBLISHED', 'ACTIVE'].includes(campaign.status)} />
        </DetailCard>
      )}
      {/* once there are results, the Performance tab's Economics and Runs cards show these */}
      {!sent && <TargetsCard campaign={campaign} editable={editable} />}
      {!sent && <RunsCard campaign={campaign} zone={zone} live={live} />}
    </div>
  )
}
