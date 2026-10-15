/**
 * The Sequence step's right column. Series at a Glance: the start date, the series time and zone, what the series adds
 * up to, and a calendar of it. Sender & Topic: set once for every message. Each control saves as it changes, patching
 * only its own campaign fields (useSeriesPatch): the messages are never sent from here, so nothing here can reshape them.
 *
 * The series time is saved on its own, as drip_config {time}: the API never reshapes the messages for it. The start date
 * is scheduled_at in the drip's zone, at the series time.
 */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DatePicker } from '@/components/DatePicker'
import { Field } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { SaveTick } from '@/components/SaveTick'
import { SelectMenu } from '@/components/SelectMenu'
import { api, ApiError } from '@/lib/api'
import { HALF_HOURS } from '@/lib/dateValue'
import { formatNumber } from '@/lib/format'
import type { Campaign, DripStep, SenderProfile, SubscriptionTopicList } from '@/lib/types'

import { useAudienceEstimate } from '../audienceNumbers'
import { calendarOf, summaryOf, type Series } from '../dripSequence'
import { channelLabel, SENDER_FIT } from '../vocabulary'
import { zonedToIso } from '../zone'
import { SeriesCalendar } from './SeriesCalendar'
import { isConflict, useSeriesPatch, type SeriesFields } from './useSequence'

const CARD = 'rounded-lg border border-line bg-surface'
const TIMES = HALF_HOURS.map((slot) => ({ value: slot.value, label: slot.value }))

type Control = 'start' | 'time' | 'zone' | 'sender' | 'topic'

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className={CARD} aria-label={title}>
      <div className="flex flex-col gap-0.5 border-b border-line px-4 py-4">
        <h2 className="text-card-title font-semibold text-ink-900">{title}</h2>
        {sub && <p className="text-helper text-ink-800">{sub}</p>}
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  )
}

/** what went wrong with the last save of the series, said once under the card */
function saveProblem(error: unknown): string | null {
  if (!error) return null
  if (isConflict(error)) return 'This campaign changed somewhere else. The latest version is shown.'
  if (error instanceof ApiError && error.status === 400) return Object.values(error.fieldErrors)[0] ?? error.message
  return error instanceof Error ? error.message : 'The change was not saved.'
}

export function SeriesCard({ campaign, steps, series, options }: {
  campaign: Campaign
  steps: DripStep[]
  series: Series
  /** the zones the schedule offers (GET /campaigns/form-options/) */
  options: string[]
}) {
  const patch = useSeriesPatch(campaign)
  const [last, setLast] = useState<Control | null>(null)
  const estimate = useAudienceEstimate(campaign.contact_lists, campaign.excluded_lists, campaign.channel, campaign.solicitation_type)
  const save = (control: Control, fields: SeriesFields) => {
    setLast(control)
    patch.mutate(fields)
  }
  const at = (day: string, time: string, zone: string) => zonedToIso(`${day}T${time}`, zone)

  const summary = summaryOf(steps, series)
  const calendar = calendarOf(steps, series)
  const zones = [...new Set([series.zone, ...options])].map((zone) => ({ value: zone, label: zone }))
  const people = estimate.data?.estimated_recipients
  const problem = saveProblem(patch.error)

  return (
    <Card title="Series at a Glance">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink-800" id="series-start-label">Start Date</span>
          <SaveTick mutation={patch} of={last === 'start' || last === 'time'} />
        </div>
        <DatePicker label="Start Date" value={series.start} placeholder="Choose a Start Date"
          onChange={(day) => { if (day) save('start', { scheduled_at: at(day, series.time, series.zone) }) }} />
        <p className="cep-num text-helper text-ink-800">
          {series.start ? 'Every message moves with it.' : 'Day 0 is the start date. Choose it to see when each message goes.'}
        </p>
      </div>
      <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
        <Field label="Send Time" strong>
          {(ids) => (
            <SelectMenu {...ids} label="Send Time" value={series.time} options={TIMES}
              onChange={(time) => save('time', { drip_config: { time } })} />
          )}
        </Field>
        <Field label="Time Zone" strong labelEnd={<SaveTick mutation={patch} of={last === 'zone'} />}>
          {(ids) => (
            <SelectMenu {...ids} label="Time Zone" value={series.zone} options={zones}
              onChange={(zone) => save('zone', { send_timezone: zone, ...(series.start ? { scheduled_at: at(series.start, series.time, zone) } : {}) })} />
          )}
        </Field>
      </div>
      {problem && <Notice tone={isConflict(patch.error) ? 'warning' : 'error'} layout="box">{problem}</Notice>}

      <div className="h-px bg-line-subtle" />
      <div className="flex flex-col gap-0.5" data-series-summary>
        <span className="cep-num text-base font-semibold text-ink-900">{summary.title}</span>
        {summary.detail && <span className="cep-num text-helper text-ink-800">{summary.detail}</span>}
      </div>

      {calendar && <SeriesCalendar calendar={calendar} />}

      <div className="h-px bg-line-subtle" />
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-ink-800">Channel</dt><dd className="font-medium text-ink-900">{channelLabel(campaign.channel)}</dd></div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-800">Campaign List</dt>
          <dd className="cep-num text-right font-medium text-ink-900">{campaign.contact_lists.length === 0 ? 'No lists yet' : people === undefined ? '—' : `${formatNumber(people)} contacts`}</dd>
        </div>
        <div className="flex justify-between gap-3"><dt className="text-ink-800">Frequency Limits</dt><dd className="font-medium text-ink-900">{campaign.respect_governance ? 'On' : 'Off'}</dd></div>
      </dl>
    </Card>
  )
}

export function SenderTopicCard({ campaign }: { campaign: Campaign }) {
  const { can } = useAuth()
  const patch = useSeriesPatch(campaign)
  const [last, setLast] = useState<'sender' | 'topic' | null>(null)
  const channel = campaign.channel
  const marketing = campaign.solicitation_type === 'MARKETING'
  const senders = useQuery({
    queryKey: ['sender-profiles', 'options'],
    queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal),
    refetchOnWindowFocus: true,                         // a sender added in the other tab (New Sender) is here on return
  })
  const topics = useQuery({
    queryKey: ['subscription-topics'],
    queryFn: ({ signal }) => api.get<SubscriptionTopicList>('/subscription-topics/', undefined, signal),
    enabled: marketing,
  })
  const fitting = (senders.data ?? []).filter((item) => (SENDER_FIT[channel] ?? []).includes(item.channel))
  const shown = fitting.filter((item) => item.verification_status === 'VERIFIED' || item.id === campaign.sender_profile)
  const senderOptions = shown.map((item) => ({
    value: item.id,
    label: `${item.display_name} · ${item.from_address ?? item.sender_id ?? item.channel}${item.verification_status === 'VERIFIED' ? '' : ' (not verified)'}`,
  }))
  const senderChannel = channel === 'EMAIL' ? 'EMAIL' : 'SMS'
  const topicChannel = channel === 'EMAIL' ? 'EMAIL' : 'SMS'
  const topicOptions = (topics.data?.enabled ? topics.data.results : []).filter((item) => item.channels.includes(topicChannel)).map((item) => ({ value: item.id, label: item.name }))
  const askTopic = marketing && topicOptions.length > 0
  const problem = saveProblem(patch.error)
  const save = (control: 'sender' | 'topic', fields: SeriesFields) => {
    setLast(control)
    patch.mutate(fields)
  }

  return (
    <Card title={askTopic ? 'Sender & Topic' : 'Sender'} sub="Set once for every message.">
      <Field label="Send From" strong labelEnd={<SaveTick mutation={patch} of={last === 'sender'} />}
        hint={senders.isPending ? 'Loading senders'
          : shown.length === 0 ? `No verified ${channelLabel(channel)} sender is set up yet. ${can('provider.edit') ? 'Add one with New Sender; it appears here when you come back.' : 'An administrator adds one under Settings, Sending Engines.'}`
          : 'Verified senders only.'}>
        {(ids) => (
          <SelectMenu {...ids} label="Send From" value={campaign.sender_profile ?? ''} options={senderOptions} placeholder="Choose a Sender" disabled={shown.length === 0}
            onChange={(id) => save('sender', { sender_profile: id })} />
        )}
      </Field>
      {can('provider.edit') && (
        <Link to={`/settings/delivery?add=sender&channel=${senderChannel}`} target="_blank" rel="noreferrer" className="-mt-2 inline-flex w-fit items-center gap-1 text-helper font-semibold text-brand-800 hover:underline">
          New Sender <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
        </Link>
      )}
      {askTopic && (
        <Field label="Filed Under" strong labelEnd={<SaveTick mutation={patch} of={last === 'topic'} />} hint="People who unticked this topic are left out.">
          {(ids) => (
            <SelectMenu {...ids} label="Filed Under" value={campaign.topic ?? ''} options={topicOptions} placeholder="Choose a Topic"
              onChange={(id) => save('topic', { topic: id })} />
          )}
        </Field>
      )}
      {problem && <Notice tone={isConflict(patch.error) ? 'warning' : 'error'} layout="box">{problem}</Notice>}
    </Card>
  )
}
