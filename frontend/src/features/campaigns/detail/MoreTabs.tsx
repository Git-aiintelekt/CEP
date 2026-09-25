/** The Activity log tab: who did what, and what the send engine did, as a timeline grouped by day in the campaign's zone. */
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import { SkeletonLine } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { titleize } from '@/lib/format'
import type { Campaign, CampaignActivity } from '@/lib/types'

import { CardError, DetailCard } from '../parts'
import { dateTimeInZone, isKnownZone } from '../zone'

type Show = 'ALL' | 'WARNING' | 'ERROR'
const DAY = 86_400_000

function Marker({ severity }: { severity: CampaignActivity['severity'] }) {
  if (severity === 'ERROR') return <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="text-danger" data-marker="error" />
  if (severity === 'WARNING') return <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="text-warning" data-marker="warning" />
  return <span aria-hidden className="h-2 w-2 rounded-full bg-ink-300" data-marker="info" />
}

/** entries by day in the campaign's zone, newest first: "Today", "Yesterday", "18 Sept 2026" */
function byDay(entries: CampaignActivity[], zone: string) {
  const safe = isKnownZone(zone) ? zone : 'UTC'
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: safe, year: 'numeric', month: '2-digit', day: '2-digit' })
  const heading = new Intl.DateTimeFormat(undefined, { timeZone: safe, dateStyle: 'medium' })
  const today = key.format(Date.now())
  const yesterday = key.format(Date.now() - DAY)
  const groups = new Map<string, { title: string; entries: CampaignActivity[] }>()
  for (const entry of [...entries].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))) {
    const day = key.format(new Date(entry.occurred_at))
    const title = day === today ? 'Today' : day === yesterday ? 'Yesterday' : heading.format(new Date(entry.occurred_at))
    if (!groups.has(day)) groups.set(day, { title, entries: [] })
    groups.get(day)!.entries.push(entry)
  }
  return [...groups.entries()]
}

function Entry({ entry, zone, last }: { entry: CampaignActivity; zone: string; last: boolean }) {
  return (
    <li className="relative flex gap-4 pb-5 last:pb-0" data-severity={entry.severity}>
      {!last && <span aria-hidden className="absolute top-5 bottom-0 left-2 w-px -translate-x-1/2 bg-line-subtle" />}
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        <Marker severity={entry.severity} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-900">{titleize(entry.event_type)}</span>
            {entry.severity === 'WARNING' && <Tag tone="warning">Warning</Tag>}
            {entry.severity === 'ERROR' && <Tag tone="error">Error</Tag>}
          </p>
          <p className="text-sm break-words text-ink-700">{entry.message}</p>
        </div>
        <p className="cep-num shrink-0 text-helper text-ink-500 sm:text-right">{entry.actor_name ?? 'System'} · {dateTimeInZone(entry.occurred_at, zone)}</p>
      </div>
    </li>
  )
}

export function ActivityTab({ campaign, zone, live }: { campaign: Campaign; zone: string; live: boolean }) {
  const [show, setShow] = useState<Show>('ALL')
  const activity = useQuery({
    queryKey: ['campaigns', 'activity', campaign.id],
    queryFn: ({ signal }) => api.get<CampaignActivity[]>(`/campaigns/${campaign.id}/activity/`, undefined, signal),
    refetchInterval: live ? 10000 : false,
  })

  let body
  if (activity.isPending) {
    body = (
      <div aria-busy className="flex flex-col gap-5">
        {['62%', '48%', '56%'].map((width) => <div key={width} className="flex flex-col gap-1"><SkeletonLine width="28%" /><SkeletonLine width={width} /></div>)}
      </div>
    )
  } else if (activity.isError) {
    body = <CardError what="the activity log" error={activity.error} onRetry={() => void activity.refetch()} />
  } else {
    const entries = activity.data.filter((entry) => show === 'ALL' || entry.severity === show)
    body = entries.length === 0 ? <p className="text-sm text-ink-500">{show === 'ALL' ? 'Nothing recorded yet' : 'Nothing of that kind'}</p> : (
      <div className="flex flex-col gap-6" data-activity-log>
        {byDay(entries, zone).map(([day, group]) => (
          <section key={day} className="flex flex-col gap-3">
            <h3 className="text-helper font-semibold text-ink-500">{group.title}</h3>
            <ol aria-label={`Activity on ${group.title}`} className="flex flex-col">
              {group.entries.map((entry, index) => <Entry key={entry.id} entry={entry} zone={zone} last={index === group.entries.length - 1} />)}
            </ol>
          </section>
        ))}
      </div>
    )
  }

  return (
    <DetailCard title="Activity Log" description="Who did what, and what the send engine did, newest first. Entries are never changed or removed."
      actions={<SegmentedControl label="Show" value={show} onChange={setShow} options={[{ value: 'ALL', label: 'Everything' }, { value: 'WARNING', label: 'Warnings' }, { value: 'ERROR', label: 'Errors' }]} />}>
      {body}
    </DetailCard>
  )
}
