/**
 * Calendar view of the campaigns: a month, Monday first, each campaign a bar over the days it runs, coloured by its
 * status. A one-time send is a bar of one day; a drip series, a recurrence or an e-receipt campaign spans its days, and
 * one that goes on runs to the edge of the month. Below 768px there is no room for a grid: the month is a list.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, IconButton } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { api } from '@/lib/api'
import type { CalendarSpan, CampaignCalendarData } from '@/lib/types'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

import { dayOf, monthOf, monthWeeks, placeSpans, shiftMonth, type Month, type PlacedSpan } from './calendarMath'
import { campaignHome } from './vocabulary'

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LANES = 3
const LABEL: Record<string, string> = {
  DRAFT: 'Draft', TEST_PUBLISHED: 'Test Published', PRODUCTION_PUBLISHED: 'Production Published', SCHEDULED: 'Scheduled', ACTIVE: 'Active', PAUSED: 'Paused', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

/** going out or gone out: green; held or only tested: amber; failed or cancelled: red; a draft that plans a date: grey */
function tone(span: CalendarSpan): string {
  if (span.failed || span.display_status === 'CANCELLED') return 'bg-danger-bg text-danger-text'
  if (span.display_status === 'PAUSED' || span.display_status === 'TEST_PUBLISHED') return 'bg-warning-bg text-warning-text'
  if (span.display_status === 'DRAFT') return 'bg-line-subtle text-ink-700'
  return 'bg-success-bg text-success-text'
}
const LEGEND = [
  ['bg-success-bg', 'Scheduled, sending or sent'], ['bg-warning-bg', 'Paused or test published'], ['bg-danger-bg', 'Failed or cancelled'], ['bg-line-subtle', 'Draft with a planned date'],
] as const

function describe(span: CalendarSpan, zone: string): string {
  const next = span.sends.find((send) => send.state === 'WAITING' || send.state === 'PROJECTED' || send.state === 'PLANNED')
  const when = next ? `, next send ${new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(next.at))}` : ''
  return `${span.name}: ${LABEL[span.display_status] ?? span.display_status}${span.failed ? ', failed' : ''}${span.ongoing ? ', ongoing' : ''}${when}`
}

export function CampaignCalendar({ filters, zone, canEdit }: { filters: Record<string, string>; zone: string; canEdit: boolean }) {
  const today = dayOf(new Date().toISOString(), zone)
  const [month, setMonth] = useState<Month>(() => monthOf(today))
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const wide = useMinWidth(BREAKPOINT.md)

  const weeks = monthWeeks(month)
  const window = { date_from: weeks[0][0], date_to: weeks[weeks.length - 1][6] }
  const calendar = useQuery({
    queryKey: ['campaigns', 'calendar', window, filters],
    queryFn: ({ signal }) => api.get<CampaignCalendarData>('/campaigns/calendar/', { ...filters, ...window }, signal),
    placeholderData: keepPreviousData,
  })

  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(month.year, month.month, 1)))
  const inMonth = (key: string) => monthOf(key).month === month.month
  const placed = placeSpans(calendar.data?.spans ?? [], weeks, zone)
  const onDay = (key: string) => placed.filter((item) => item.from <= key && key <= item.to)
  const dayTitle = (key: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))

  const bar = (item: PlacedSpan, week: string[]) => {
    const from = item.from < week[0] ? week[0] : item.from
    const to = item.to > week[6] ? week[6] : item.to
    const startsHere = from === item.from
    const endsHere = to === item.to && !(item.span.ongoing && to === weeks[weeks.length - 1][6])
    return (
      <Link key={`${item.span.campaign}-${week[0]}`} to={campaignHome({ ...item.span, id: item.span.campaign }, canEdit)} title={describe(item.span, zone)} aria-label={describe(item.span, zone)}
        style={{ gridColumn: `${week.indexOf(from) + 1} / ${week.indexOf(to) + 2}`, gridRow: item.lane + 1 }}
        className={`mx-1 block h-5 truncate px-1.5 text-xs font-semibold leading-5 hover:underline ${tone(item.span)} ${startsHere ? 'rounded-l-sm' : '-ml-px'} ${endsHere ? 'rounded-r-sm' : '-mr-px'} ${inMonth(from) || inMonth(to) ? '' : 'opacity-60'}`}>
        {item.span.name}
      </Link>
    )
  }

  return (
    <section aria-label="Campaign calendar" className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IconButton variant="outline" icon={ChevronLeft} label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
        <h2 aria-live="polite" className="min-w-40 text-center font-display text-lg font-semibold text-ink-900">{title}</h2>
        <IconButton variant="outline" icon={ChevronRight} label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} />
        <Button size="sm" onClick={() => setMonth(monthOf(today))} disabled={monthOf(today).year === month.year && monthOf(today).month === month.month}>Today</Button>
        {calendar.isFetching && <Spinner size="sm" />}
        <span className="ml-auto text-xs text-ink-500">Days are in the workspace's time zone, {zone}.</span>
      </div>

      {calendar.isError ? (
        <ErrorState title="The calendar could not be loaded" error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : !wide ? (
        placed.length === 0 ? <p className="text-sm text-ink-500">{calendar.isPending ? 'Loading the month' : 'No campaign runs in this month with these filters.'}</p> : (
          <ul aria-label={`Campaigns in ${title}`} className="divide-y divide-line">
            {placed.map((item) => (
              <li key={item.span.campaign} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <Link to={campaignHome({ ...item.span, id: item.span.campaign }, canEdit)} className="min-w-0 truncate font-medium text-brand-800 hover:underline">{item.span.name}</Link>
                <span className="flex items-center gap-2 text-xs text-ink-500">
                  {item.from === item.to ? dayTitle(item.from) : `${item.from} to ${item.span.ongoing ? 'ongoing' : item.to}`}
                  <StatusBadge status={item.span.failed ? 'FAILED' : item.span.display_status} />
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div role="grid" aria-label={title} className="overflow-hidden rounded-sm border border-line">
          <div role="row" className="grid grid-cols-7 border-b border-line bg-surface-subtle">
            {WEEKDAY.map((day) => <div key={day} role="columnheader" className="border-l border-line px-3 py-2 text-xs font-semibold uppercase text-ink-700 first:border-l-0">{day}</div>)}
          </div>
          {weeks.map((week) => {
            const bars = placed.filter((item) => item.from <= week[6] && item.to >= week[0])
            return (
              <div key={week[0]} role="row" className="relative border-b border-line last:border-b-0">
                <div className="grid grid-cols-7">
                  {week.map((key) => {
                    const hidden = onDay(key).filter((item) => item.lane >= LANES)
                    return (
                      <div key={key} role="gridcell" aria-label={`${dayTitle(key)}: ${onDay(key).length} campaign${onDay(key).length === 1 ? '' : 's'}`}
                        className={`flex min-h-28 flex-col justify-between border-l border-line px-2 pb-1 pt-1.5 first:border-l-0 ${inMonth(key) ? '' : 'bg-surface-subtle'}`}>
                        <span className={`cep-num inline-flex h-6 w-6 items-center justify-center text-sm font-medium ${key === today ? 'rounded-full bg-brand-600 text-white' : inMonth(key) ? 'text-ink-900' : 'text-ink-300'}`}>
                          {Number(key.slice(8))}
                        </span>
                        {hidden.length > 0 && (
                          <button type="button" onClick={() => setDayOpen(key)} className={`${buttonClass({ variant: 'link', size: 'sm' })} relative z-10 -mx-1 self-start`}>
                            +{hidden.length} more
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-9 grid grid-cols-7 gap-y-0.5 [&>*]:pointer-events-auto">
                  {bars.filter((item) => item.lane < LANES).map((item) => bar(item, week))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {wide && !calendar.isError && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-700">
          {calendar.data && placed.length === 0 && <span className="font-medium text-ink-900">No campaign runs in this month with these filters.</span>}
          {LEGEND.map(([fill, text]) => <span key={text} className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-3 w-5 rounded-sm ${fill}`} />{text}</span>)}
        </div>
      )}

      {dayOpen && (
        <Modal title={dayTitle(dayOpen)} onClose={() => setDayOpen(null)}>
          <ul className="divide-y divide-line">
            {onDay(dayOpen).map((item) => (
              <li key={item.span.campaign} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link to={campaignHome({ ...item.span, id: item.span.campaign }, canEdit)} className="min-w-0 truncate font-medium text-brand-800 hover:underline">{item.span.name}</Link>
                <StatusBadge status={item.span.failed ? 'FAILED' : item.span.display_status} />
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  )
}
