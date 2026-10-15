/**
 * Performance's Message Comparison for a drip: a row per message from its latest production run (GET steps/, `run`),
 * each opening to today's per-run detail, and the open and click rate per message as grouped bars (texts: delivery and
 * click rate). Conversions and revenue are attributed to the campaign, not to a message, so they aren't here.
 */
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { Chart } from '@/components/charts/Chart'
import { DataTable, type Column } from '@/components/DataTable'
import { SkeletonLine } from '@/components/States'
import { RunResults } from '@/apps/cep/features/delivery/RunResults'
import { formatNumber } from '@/lib/format'
import type { Campaign, DripStep } from '@/lib/types'

import { messageTitle, whenInZone, zoneShort } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { CardError, DetailCard } from '../parts'
import { stepState } from './dripDetail'
import { SubjectTestResults } from './SubjectTestResults'

const SENT_STATES = new Set(['sent', 'sending', 'failed'])
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

export function MessageComparison({ campaign, zone, onSkipped }: { campaign: Campaign; zone: string; onSkipped: (step: DripStep) => void }) {
  const steps = useQuery(dripStepsQuery(campaign.id))
  const texts = campaign.channel === 'SMS' || campaign.channel === 'MMS'
  const short = zoneShort(zone)

  if (steps.isPending) return <DetailCard title="Message Comparison"><div aria-busy className="flex flex-col gap-3"><SkeletonLine width="60%" /><SkeletonLine width="100%" /></div></DetailCard>
  if (steps.isError) return <DetailCard title="Message Comparison"><CardError what="the messages" error={steps.error} onRetry={() => void steps.refetch()} /></DetailCard>

  const list = steps.data
  const stateOf = (step: DripStep) => stepState(campaign, step)
  const went = (step: DripStep) => Boolean(step.run) && SENT_STATES.has(stateOf(step))
  const figure = (step: DripStep, value: (run: NonNullable<DripStep['run']>) => ReactNode) => {
    if (went(step)) return value(step.run!)
    return <span className="text-ink-800">{stateOf(step) === 'cancelled' ? 'Cancelled' : 'Not sent yet'}</span>
  }
  const columns: Column<DripStep>[] = [
    { key: 'message', header: 'Message', render: (step) => <span className="font-semibold text-ink-900">{step.position}. {messageTitle(step)}</span> },
    { key: 'sent-on', header: 'Sent On', render: (step) => {
      const when = whenInZone(step.run?.started_at, zone)
      return <span className="cep-num whitespace-nowrap">{when ? `${when.day}, ${when.time} ${short}` : <span className="text-ink-800">{`Day ${step.day}`}</span>}</span>
    } },
    { key: 'sent', header: 'Sent', align: 'right', render: (step) => figure(step, (run) => formatNumber(run.sent)) },
    { key: 'delivered', header: 'Delivered', align: 'right', render: (step) => figure(step, (run) => formatNumber(run.delivered)) },
    ...(texts ? [] : [{ key: 'opened', header: 'Opened', align: 'right' as const, render: (step: DripStep) => figure(step, (run) => `${formatNumber(run.opened)} · ${run.open_rate}%`) }]),
    { key: 'clicked', header: 'Clicked', align: 'right', render: (step) => figure(step, (run) => `${formatNumber(run.clicked)} · ${run.click_rate}%`) },
    ...(texts ? [{ key: 'replied', header: 'Replies', align: 'right' as const, render: (step: DripStep) => figure(step, (run) => formatNumber(run.replied ?? 0)) }] : []),
    { key: 'unsubscribed', header: texts ? 'Opted Out' : 'Unsubscribed', align: 'right', render: (step) => figure(step, (run) => formatNumber(texts ? run.opted_out ?? run.unsubscribed : run.unsubscribed)) },
    // queued but never sent (stopped early): its own column, never inside a failure
    ...(list.some((step) => step.run?.not_sent) ? [{ key: 'not-sent', header: 'Not Sent', align: 'right' as const, render: (step: DripStep) => figure(step, (run) => formatNumber(run.not_sent ?? 0)) }] : []),
    { key: 'skipped', header: 'Skipped', align: 'right', render: (step) => figure(step, (run) => (run.skipped.total > 0
      ? <button type="button" onClick={() => onSkipped(step)} className="cep-num font-semibold text-link hover:underline">{formatNumber(run.skipped.total)}</button>
      : '0')) },
  ]

  const categories = list.map((step) => ({ key: step.id, label: went(step) ? `Message ${step.position}` : `Day ${step.day}`, detail: `Message ${step.position} · ${messageTitle(step)}` }))
  const series = texts
    ? [{ key: 'delivery', label: 'Delivery Rate', values: list.map((step) => (went(step) ? percent(step.run!.delivered, step.run!.sent) : 0)) },
       { key: 'click', label: 'Click Rate', values: list.map((step) => (went(step) ? step.run!.click_rate : 0)) }]
    : [{ key: 'open', label: 'Open Rate', values: list.map((step) => (went(step) ? step.run!.open_rate : 0)) },
       { key: 'click', label: 'Click Rate', values: list.map((step) => (went(step) ? step.run!.click_rate : 0)) }]

  return (
    <DetailCard title="Message Comparison" description="Each message's latest send. Conversions and revenue are counted for the whole drip, under Results." flush>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <DataTable caption="Message Comparison" columns={columns} rows={list} rowKey={(step) => step.id} framed={false} inset="card" phone="table"
            expand={{
              canExpand: (step) => went(step),
              label: (step) => `Results of message ${step.position}`,
              render: (step) => {
                const run = campaign.runs.find((item) => item.id === step.run?.id)
                if (!run) return <p className="text-sm text-ink-800">This send isn't in the campaign's runs yet.</p>
                return (
                  <>
                    {!texts && step.ab_config?.enabled && <SubjectTestResults campaignId={campaign.id} run={run} zone={zone} />}
                    <RunResults run={run} zone={zone} channel={campaign.channel} />
                  </>
                )
              },
            }} />
        </div>
      </div>
      <div className="border-t border-line-subtle p-6" data-message-chart>
        <Chart title={texts ? 'Delivery and click rate per message' : 'Open and click rate per message'} categoryHeader="Message" categories={categories} series={series}
          type="bar" height={240} formatValue={(value) => `${value}%`} />
      </div>
    </DetailCard>
  )
}
