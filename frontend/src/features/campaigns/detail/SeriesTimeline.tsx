/**
 * Overview's Series Timeline for a published drip: the Sequence step's timeline, read-only. The start marker, a gap pill
 * before each message, a Today marker between what went and what is to come, and per message its state from its latest
 * run (sent with its figures and skips, sending, next up, scheduled, on hold, cancelled, failed). The calendar sits beside it.
 */
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { SkeletonLine } from '@/components/States'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignActivity, DripStep } from '@/lib/types'

import { calendarOf, gapBefore, longDay, messageTitle, seriesOf, sendOf, shortDay, whenInZone, type Series } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { SeriesCalendar } from '../sequence/SeriesCalendar'
import { GapPill, StartMarker, Thumbnail } from '../sequence/Timeline'
import { isoToZoned } from '../zone'
import { CardError, DetailCard } from '../parts'
import { hasStarted, retryState, skippedLine, stepState } from './dripDetail'
import { StepTag } from './StepTag'

const DAY = 86_400_000


/** when the message went or goes: its run's time once planned (a resume can move it), else the timetable's */
function whenOf(step: DripStep, series: Series): { day: string; time: string } | null {
  const at = step.run?.started_at ?? step.run?.scheduled_at
  const fromRun = whenInZone(at, series.zone)
  if (fromRun) return { day: fromRun.day, time: fromRun.time }
  const { date, time } = sendOf(step, series)
  return date ? { day: shortDay(date), time } : null
}

function Figure({ label, value }: { label: string; value: string }) {
  return <span className="flex items-baseline gap-1.5"><dt className="text-helper text-ink-800">{label}</dt><dd className="cep-num text-sm font-semibold text-ink-900">{value}</dd></span>
}

function SentBody({ campaign, step, texts, onSkipped }: { campaign: Campaign; step: DripStep; texts: boolean; onSkipped: (step: DripStep) => void }) {
  const run = step.run!
  const skipped = skippedLine(step, campaign.channel)
  const winner = run.ab?.variants.find((variant) => variant.is_winner)
  const metric = winner?.winner_metric === 'CLICK_RATE' ? 'click rate' : 'open rate'
  const metricValue = winner?.winner_metric === 'CLICK_RATE' ? winner.click_rate : winner?.open_rate
  return (
    <div className="flex flex-col gap-1.5">
      <dl className="flex flex-wrap gap-x-5 gap-y-1" data-step-figures>
        <Figure label="Sent" value={formatNumber(run.sent)} />
        {texts ? <Figure label="Delivered" value={formatNumber(run.delivered)} /> : <Figure label="Opened" value={`${run.open_rate}%`} />}
        <Figure label="Clicked" value={`${run.click_rate}%`} />
        {texts && <Figure label="Replies" value={formatNumber(run.replied ?? 0)} />}
        <Figure label={texts ? 'Opted Out' : 'Unsubscribed'} value={formatNumber(texts ? run.opted_out ?? run.unsubscribed : run.unsubscribed)} />
        {Boolean(run.not_sent) && <Figure label="Not Sent" value={formatNumber(run.not_sent ?? 0)} />}
      </dl>
      {skipped && (
        <p className="text-helper text-ink-800" data-step-skipped>
          <button type="button" onClick={() => onSkipped(step)} className="font-semibold text-brand-600 hover:underline">Skipped {formatNumber(run.skipped.total)}</button>: {skipped}
        </p>
      )}
      {winner && <p className="text-helper text-ink-800">A/B winner: Subject {winner.variant_key}{metricValue !== undefined ? `, ${metricValue}% ${metric}` : ''}.</p>}
    </div>
  )
}

function StepCard({ campaign, step, total, series, texts, reason, canPublish, now, onSkipped, onRetry }: {
  campaign: Campaign; step: DripStep; total: number; series: Series; texts: boolean; reason: string | null; canPublish: boolean; now: number
  onSkipped: (step: DripStep) => void; onRetry: (step: DripStep) => void
}) {
  const state = stepState(campaign, step)
  const when = whenOf(step, series)
  const line = texts ? step.text_excerpt?.trim() || 'No message text yet' : step.subject_line?.trim() || 'Uses the template’s subject line'
  const retry = retryState(campaign, step, canPublish)
  const scheduledAt = step.run?.scheduled_at
  const days = scheduledAt ? Math.max(0, Math.ceil((new Date(scheduledAt).getTime() - now) / DAY)) : null
  const people = campaign.audience_size

  let body: ReactNode = null
  if (state === 'sent' && step.run) body = <SentBody campaign={campaign} step={step} texts={texts} onSkipped={onSkipped} />
  if (state === 'sending' && step.run) {
    const sent = step.run.sent
    body = (
      <div className="flex flex-col gap-1.5">
        <ProgressBar value={people ? Math.min(100, (sent / people) * 100) : 0} label={`Message ${step.position} sending`} />
        <span className="cep-num text-helper text-ink-800">{formatNumber(sent)}{people ? ` of ${formatNumber(people)}` : ''} sent</span>
      </div>
    )
  }
  if (state === 'next') {
    const inDays = days === null ? '' : days === 0 ? ' today' : days === 1 ? ' tomorrow' : ` in ${days} days`
    body = <p className="text-helper text-ink-800">Sends{inDays}{people ? ` to about ${formatNumber(people)} contacts` : ''}. Consent and limits are checked at send time.</p>
  }
  if (state === 'on-hold') body = <p className="text-helper text-ink-800">Waiting. Sends when the drip is resumed.</p>
  if (state === 'cancelled') {
    const at = whenInZone(step.run?.completed_at, series.zone)
    body = <p className="text-helper text-ink-800">Cancelled{at ? ` ${at.day}` : ''}. Not sent.</p>
  }
  if (state === 'failed') {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-helper text-danger-text">{reason ?? 'The send stopped before anyone got it.'}</p>
        {retry === 'allowed' ? <Button size="sm" variant="secondary" onClick={() => onRetry(step)}>Retry Message</Button>
          : retry && <p className="text-helper text-ink-800">{retry}</p>}
      </div>
    )
  }

  return (
    <article aria-label={`Message ${step.position}, ${messageTitle(step)}`} data-step-state={state} data-timeline-card={step.position}
      className={`grid grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border p-4 md:grid-cols-[56px_minmax(0,1fr)] ${state === 'cancelled' ? 'border-dashed border-ink-300 bg-surface-subtle' : 'border-line bg-surface'}`}>
      <span className="hidden md:block"><Thumbnail step={step} email={!texts} /></span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="cep-num text-xs text-ink-800">Message {step.position} of {total} · Day {step.day}{when ? ` · ${when.day}, ${when.time} ${series.zoneShort}` : ''}</span>
            <span className="text-card-title font-semibold text-pretty break-words text-ink-900">{messageTitle(step)}</span>
            <span className="truncate text-sm text-ink-800">{line}</span>
          </span>
          <StepTag state={state} />
        </div>
        {body}
      </div>
    </article>
  )
}

function TodayMarker({ zone, now }: { zone: string; now: number }) {
  const today = whenInZone(new Date(now).toISOString(), zone)
  return (
    <div className="flex min-h-6 items-center gap-2" data-today-marker>
      <span className="inline-flex h-6 items-center gap-1.5 rounded-sm bg-ink-900 px-2 text-xs font-semibold text-white"><Clock size={12} strokeWidth={1.5} aria-hidden />Today · {today?.day}</span>
    </div>
  )
}

export function SeriesTimelineCard({ campaign, zone, canPublish, onSkipped, onRetry }: {
  campaign: Campaign; zone: string; canPublish: boolean; onSkipped: (step: DripStep) => void; onRetry: (step: DripStep) => void
}) {
  const steps = useQuery(dripStepsQuery(campaign.id))
  const activity = useQuery({
    queryKey: ['campaigns', 'activity', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignActivity[]>(`/campaigns/${campaign.id}/activity/`, undefined, signal),
    enabled: Boolean(steps.data?.some((step) => step.run?.status === 'FAILED')),
  })
  const series = seriesOf(campaign, zone)
  const texts = campaign.channel === 'SMS' || campaign.channel === 'MMS'
  // the moment the card opened: "today" and "sends in 2 days" are read against it
  const [now] = useState(() => Date.now())

  let body: ReactNode
  if (steps.isPending) body = <div aria-busy className="flex flex-col gap-3"><SkeletonLine width="50%" /><SkeletonLine width="100%" /><SkeletonLine width="80%" /></div>
  else if (steps.isError) body = <CardError what="the messages" error={steps.error} onRetry={() => void steps.refetch()} />
  else {
    const list = steps.data
    const started = hasStarted(list)
    const finished = ['COMPLETED', 'ARCHIVED'].includes(campaign.status)
    const states = list.map((step) => stepState(campaign, step))
    const todayAt = started && !finished ? states.findIndex((state) => ['next', 'scheduled', 'on-hold'].includes(state)) : -1
    const start = series.start ? longDay(new Date(`${series.start}T12:00:00Z`)) : null
    const people = campaign.audience_size
    const reasonOf = (step: DripStep) => activity.data?.filter((entry) => entry.campaign_run_id === step.run?.id && entry.severity === 'ERROR')
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0]?.message ?? null
    const calendar = calendarOf(list, series)
    const sentPositions = new Set(list.filter((_, index) => states[index] === 'sent').map((step) => step.position))
    const sentDays = new Set((calendar?.cells ?? []).filter((cell) => cell.messages.length > 0 && cell.messages.every((position) => sentPositions.has(position))).map((cell) => cell.key))
    const today = finished ? undefined : isoToZoned(new Date(now).toISOString(), series.zone).slice(0, 10)

    body = (
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <ol aria-label="Series Timeline" className="relative flex min-w-0 flex-col gap-3">
          <span aria-hidden className="absolute top-3 bottom-3 left-3 w-px bg-ink-300" />
          <li><StartMarker label={started ? 'Started' : 'Starts'} text={`${start ?? 'No start date'}${people ? ` · ${formatNumber(people)} contacts` : ''}`} /></li>
          {list.map((step, index) => (
            <li key={step.id} className="relative flex flex-col gap-3">
              {index === todayAt && <TodayMarker zone={series.zone} now={now} />}
              <GapPill gap={gapBefore(list, index)} />
              <div className="pl-8">
                <StepCard campaign={campaign} step={step} total={list.length} series={series} texts={texts} reason={reasonOf(step)} canPublish={canPublish} now={now} onSkipped={onSkipped} onRetry={onRetry} />
              </div>
            </li>
          ))}
        </ol>
        {calendar && <div className="min-w-0 rounded-lg border border-line-subtle p-4"><SeriesCalendar calendar={calendar} sentDays={sentDays} today={today} /></div>}
      </div>
    )
  }
  return <DetailCard title="Series Timeline">{body}</DetailCard>
}
