/**
 * Performance: production runs only (a test publish never counts). The results, engagement over time, the economics
 * against the targets, every run (each opens to what happened in it), and the mailbox providers or the text replies.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState, SkeletonLine } from '@/components/States'
import { SegmentedControl } from '@/components/SegmentedControl'
import { TextReplies } from '@/features/delivery/RunResults'
import { api } from '@/lib/api'
import { formatMoney, formatNumber } from '@/lib/format'
import type { Campaign, CampaignMetrics, CampaignTimeseries } from '@/lib/types'

import { CardError, CardLink, DetailCard, Meter, Metric } from '../parts'
import { setupHref } from '../setupFlow'
import { hasAction, isText } from '../vocabulary'
import { resultsStamp, useCampaignMetrics } from './campaignMetrics'
import { economicsHeadline, economicsRows, economicsSubline, hasTargets, type ActualCosts, type EconomicsRow, type Tone } from './economics'
import { RunsCard } from './RunsCard'
import { TimeseriesChart } from './TimeseriesChart'

/** the API doesn't report what a campaign really cost yet */
const NO_COSTS: ActualCosts = { campaign: null, offer: null }

const rate = (value: number) => `${value}%`

function ResultsCard({ campaign, zone, metrics }: { campaign: Campaign; zone: string; metrics: ReturnType<typeof useCampaignMetrics> }) {
  const data = metrics.data
  const texts = isText(campaign)
  const stamp = resultsStamp(campaign, zone, data ? metrics.dataUpdatedAt : null)
  let body
  if (metrics.isError) body = <CardError what="the results" error={metrics.error} onRetry={() => void metrics.refetch()} />
  else if (!data) {
    body = (
      <div aria-busy className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {['40%', '52%', '36%'].map((width) => <div key={width} className="flex flex-col gap-2"><SkeletonLine width="50%" /><SkeletonLine width={width} /></div>)}
      </div>
    )
  } else {
    const { counts, rates, conversions, revenue, breakdown } = data
    body = (
      <>
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label="Sent" value={formatNumber(counts.sent)} note={counts.queued ? `${formatNumber(counts.queued)} still queued` : counts.failed ? `${formatNumber(counts.failed)} failed` : undefined} />
          <Metric label="Delivered" value={formatNumber(counts.delivered)} note={`${rate(rates.delivery)} of sent`} />
          {texts ? (
            <>
              <Metric label="Replies" value={formatNumber(counts.replied)} />
              <Metric label="Opted Out (STOP)" value={formatNumber(counts.unsubscribed)} note={`${rate(rates.unsubscribe)} of delivered`} />
            </>
          ) : (
            <>
              <Metric label="Opened" value={formatNumber(counts.opened)} note={`${rate(rates.open)} of delivered`} />
              <Metric label="Clicked" value={formatNumber(counts.clicked)} note={`${rate(rates.click)} of delivered`} />
              <Metric label="Bounced" value={formatNumber(counts.bounced)} note={`${rate(rates.bounce)} of sent`} />
              <Metric label="Unsubscribed" value={formatNumber(counts.unsubscribed)} note={`${rate(rates.unsubscribe)} of delivered`} />
              <Metric label="Spam Complaints" value={formatNumber(counts.complained)} />
            </>
          )}
          <Metric label="Conversions" value={formatNumber(conversions)} note={revenue ? `${formatMoney(revenue, { whole: true })} attributed` : 'Arrives with the attribution feed'} />
        </dl>
        {texts && breakdown.note && <p className="mt-6 border-t border-line-subtle pt-4 text-helper text-ink-800">{breakdown.note}</p>}
      </>
    )
  }
  return <DetailCard title="Results" actions={stamp && <span className="cep-num text-ink-800">{stamp}</span>}>{body}</DetailCard>
}

function EngagementCard({ campaign, zone, live }: { campaign: Campaign; zone: string; live: boolean }) {
  const [bucket, setBucket] = useState<'hour' | 'day'>('hour')
  const series = useQuery({
    queryKey: ['campaigns', 'timeseries', campaign.id, bucket],
    queryFn: ({ signal }) => api.get<CampaignTimeseries>(`/campaigns/${campaign.id}/metrics/timeseries/`, { bucket }, signal),
    refetchInterval: live ? 15000 : false,
  })
  return (
    <DetailCard title="Engagement over Time" actions={
      <SegmentedControl label="Chart Detail" value={bucket} onChange={setBucket} options={[{ value: 'hour', label: 'By Hour' }, { value: 'day', label: 'By Day' }]} />
    }>
      <TimeseriesChart data={series.data} texts={isText(campaign)} zone={zone} loading={series.isPending} error={series.isError ? series.error : undefined} onRetry={() => void series.refetch()} />
    </DetailCard>
  )
}

const TONE: Record<Tone, string> = { better: 'font-semibold text-success-text', worse: 'font-semibold text-warning-text', none: 'text-ink-800' }

const economicsColumns: Column<EconomicsRow>[] = [
  { key: 'measure', header: 'Measure', render: (row) => <span className="text-ink-900">{row.measure}</span> },
  { key: 'target', header: 'Target', align: 'right', render: (row) => row.target },
  { key: 'actual', header: 'Actual', align: 'right', render: (row) => row.actual },
  { key: 'difference', header: 'Difference', align: 'right', render: (row) => <span data-tone={row.tone} className={TONE[row.tone]}>{row.difference}</span> },
]

function EconomicsCard({ campaign, metrics }: { campaign: Campaign; metrics: CampaignMetrics }) {
  const { can } = useAuth()
  const editable = can('campaign.edit') && hasAction(campaign, 'edit') && !campaign.is_journey_generated
  const targets = campaign.targets
  const edit = editable && <CardLink to={setupHref(campaign.id, { step: 'targets' })}>Edit Targets</CardLink>
  if (!hasTargets(targets)) {
    return <DetailCard title="Economics" actions={edit}><p className="text-sm text-ink-800">No targets were set for this campaign.</p></DetailCard>
  }
  const subline = economicsSubline(targets)
  return (
    <DetailCard title="Economics" actions={edit} flush>
      <div className="flex flex-col gap-1.5 pb-5 md:px-6 md:pt-6">
        <p className="cep-num font-display text-xl font-semibold tracking-tight text-ink-900" data-testid="economics-headline">{economicsHeadline(metrics, NO_COSTS)}</p>
        {subline && <p className="cep-num text-sm text-ink-800">{subline}</p>}
      </div>
      <div className="md:border-t md:border-line-subtle">
        <DataTable columns={economicsColumns} rows={economicsRows(targets, metrics, { texts: isText(campaign), costs: NO_COSTS })} rowKey={(row) => row.measure}
          caption="Targets against results" framed={false} inset="card" phone="table" />
      </div>
      <div className="flex flex-col gap-6 pt-6 md:border-t md:border-line-subtle md:p-6">
        {metrics.targets.length > 0 && (
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {metrics.targets.map((item) => <Meter key={item.measure} label={item.measure} actual={item.actual} target={item.target} percent={item.percent} money={item.measure === 'Revenue'} />)}
          </div>
        )}
        {targets.notes && <p className="text-sm whitespace-pre-wrap text-ink-800">{targets.notes}</p>}
        <p className="text-helper text-ink-800">Planning estimates come from your own inputs. They aren’t guaranteed outcomes.</p>
      </div>
    </DetailCard>
  )
}

const mailboxColumns: Column<CampaignMetrics['breakdown']['rows'][number]>[] = [
  { key: 'domain', header: 'Domain', render: (row) => <span className="font-medium text-ink-900">{row.key}</span> },
  { key: 'sent', header: 'Sent', align: 'right', render: (row) => formatNumber(row.sent) },
  { key: 'delivered', header: 'Delivered', align: 'right', render: (row) => formatNumber(row.delivered) },
  { key: 'opened', header: 'Opened', align: 'right', phoneOptional: true, render: (row) => formatNumber(row.opened) },
  { key: 'bounced', header: 'Bounced', align: 'right', render: (row) => formatNumber(row.bounced) },
]

/** `focusRun`: a run to open and bring into view (the failed-run banner's "View run") */
export function PerformanceTab({ campaign, zone, live, focusRun }: { campaign: Campaign; zone: string; live: boolean; focusRun?: string }) {
  const texts = isText(campaign)
  const metrics = useCampaignMetrics(campaign, live)

  if (!campaign.runs.some((run) => !run.test_mode)) {
    return <EmptyState title="No results yet" hint="Results appear once the campaign is published to production and its first run starts. A test publish is never counted." />
  }
  const data = metrics.data
  return (
    <div className="flex flex-col gap-6">
      <ResultsCard campaign={campaign} zone={zone} metrics={metrics} />
      <EngagementCard campaign={campaign} zone={zone} live={live} />
      {data && <EconomicsCard campaign={campaign} metrics={data} />}
      <RunsCard campaign={campaign} zone={zone} live={live} expandable focusRun={focusRun} />
      {!texts && data && data.breakdown.rows.length > 0 && (
        <DetailCard title="By Mailbox Provider" description="The recipients' domains, largest first." flush>
          <DataTable columns={mailboxColumns} rows={data.breakdown.rows} rowKey={(row) => row.key} caption="By Mailbox Provider" framed={false} inset="card" phone="table" />
        </DetailCard>
      )}
      {texts && <TextReplies campaignId={campaign.id} zone={zone} />}
    </div>
  )
}
