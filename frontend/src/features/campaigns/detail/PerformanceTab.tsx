/** Performance: production runs only (a test publish never counts). Numbers, rates, progress against the targets, the curve over time, and each run. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { SegmentedControl } from '@/components/SegmentedControl'
import { RunResults, TextReplies } from '@/features/delivery/RunResults'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignMetrics, CampaignTimeseries } from '@/lib/types'

import { Meter, Panel, StatTile } from '../parts'
import { isText } from '../vocabulary'
import { TimeseriesChart } from './TimeseriesChart'

export function PerformanceTab({ campaign, live }: { campaign: Campaign; live: boolean }) {
  const [bucket, setBucket] = useState<'hour' | 'day'>('hour')
  const texts = isText(campaign)
  const production = campaign.runs.filter((run) => !run.test_mode)

  const metrics = useQuery({
    queryKey: ['campaigns', 'metrics', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignMetrics>(`/campaigns/${campaign.id}/metrics/`, undefined, signal),
    refetchInterval: live ? 5000 : false,
  })
  const series = useQuery({
    queryKey: ['campaigns', 'timeseries', campaign.id, bucket],
    queryFn: ({ signal }) => api.get<CampaignTimeseries>(`/campaigns/${campaign.id}/metrics/timeseries/`, { bucket }, signal),
    refetchInterval: live ? 15000 : false,
  })

  if (production.length === 0) {
    return <EmptyState title="No results yet" hint="Results appear once the campaign is published to production and its first run starts. A test publish is never counted." />
  }
  if (metrics.isPending) return <p className="flex items-center gap-3 text-sm text-ink-500"><Spinner /> Loading results</p>
  if (metrics.isError) return <ErrorState title="The results could not be loaded" error={metrics.error} onRetry={() => void metrics.refetch()} />

  const { counts, rates, targets, breakdown, conversions, revenue } = metrics.data
  const rate = (value: number) => `${value}%`

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Sent" value={formatNumber(counts.sent)} note={counts.queued ? `${formatNumber(counts.queued)} still queued` : counts.failed ? `${formatNumber(counts.failed)} failed` : undefined} />
        <StatTile label="Delivered" value={formatNumber(counts.delivered)} note={`${rate(rates.delivery)} of sent`} />
        {texts ? (
          <>
            <StatTile label="Replies" value={formatNumber(counts.replied)} />
            <StatTile label="Opted out (STOP)" value={formatNumber(counts.unsubscribed)} note={`${rate(rates.unsubscribe)} of delivered`} />
          </>
        ) : (
          <>
            <StatTile label="Opened" value={formatNumber(counts.opened)} note={`${rate(rates.open)} of delivered`} />
            <StatTile label="Clicked" value={formatNumber(counts.clicked)} note={`${rate(rates.click)} of delivered`} />
            <StatTile label="Bounced" value={formatNumber(counts.bounced)} note={`${rate(rates.bounce)} of sent`} />
            <StatTile label="Unsubscribed" value={formatNumber(counts.unsubscribed)} note={`${rate(rates.unsubscribe)} of delivered`} />
            <StatTile label="Spam complaints" value={formatNumber(counts.complained)} />
          </>
        )}
        <StatTile label="Conversions" value={formatNumber(conversions)} note={revenue ? `${Number(revenue).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} attributed` : 'Arrives with the attribution feed'} />
      </dl>

      <Panel title="Over time" actions={
        <SegmentedControl label="Chart detail" value={bucket} onChange={setBucket} options={[{ value: 'hour', label: 'By hour' }, { value: 'day', label: 'By day' }]} />
      }>
        {series.isError ? <ErrorState title="The chart could not be loaded" error={series.error} onRetry={() => void series.refetch()} />
          : !series.data ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading the chart</p>
          : <TimeseriesChart data={series.data} texts={texts} />}
      </Panel>

      <Panel title="Against the targets">
        {targets.length === 0 ? <p className="text-sm text-ink-500">No targets were set for this campaign.</p> : (
          <div className="grid gap-5 sm:grid-cols-2">{targets.map((item) => <Meter key={item.measure} label={item.measure} actual={item.actual} target={item.target} percent={item.percent} money={item.measure === 'Revenue'} />)}</div>
        )}
      </Panel>

      {!texts && breakdown.rows.length > 0 && (
        <Panel title="By mailbox provider" description="The recipients' domains, largest first.">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-surface-subtle"><tr>
                {['Domain', 'Sent', 'Delivered', 'Opened', 'Bounced'].map((header, index) => <th key={header} scope="col" className={`h-10 px-3 text-xs font-semibold text-ink-700 ${index ? 'text-right' : 'text-left'}`}>{header}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {breakdown.rows.map((row) => (
                  <tr key={row.key}><th scope="row" className="px-3 py-2 text-left font-medium text-ink-900">{row.key}</th>
                    {[row.sent, row.delivered, row.opened, row.bounced].map((value, index) => <td key={index} className="cep-num px-3 py-2 text-right text-ink-700">{formatNumber(value)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {texts && breakdown.note && <p className="text-xs text-ink-500">{breakdown.note}</p>}

      <section>
        <h2 className="mb-3 font-display text-section-title font-semibold text-ink-900">Run by run</h2>
        <div className="space-y-4">
          {[...production].sort((a, b) => b.run_number - a.run_number).slice(0, 5).map((run) => <RunResults key={run.id} run={run} />)}
          {texts && <TextReplies campaignId={campaign.id} />}
        </div>
      </section>
    </div>
  )
}
