/**
 * Calendar view of the campaigns: a month, Monday first, each campaign a bar over the days it runs, coloured by its
 * status. A one-time send is a bar of one day; a drip series, a recurrence or an e-receipt campaign spans its days, and
 * one that goes on runs to the edge of the month. Below 768px there is no room for a grid: the month is a list.
 * Week mode (CampaignWeek) and the Journey Runs switch live in the address, so Back steps back through them.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Route } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button, IconButton } from '@/components/Button'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { statusColours } from '@/components/statusColours'
import { buttonClass } from '@/components/buttonStyles'
import { addDays } from '@/features/reports/period'
import { api } from '@/lib/api'
import type { CampaignCalendarData } from '@/lib/types'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

import { CalendarDayModal, CalendarLegend } from './CalendarParts'
import { CampaignWeek } from './CampaignWeek'
import { dayOf, monthOf, monthWeeks, placeSpans, shiftMonth, type Month, type PlacedSpan } from './calendarMath'
import { barStatus, dayTitle, describe } from './calendarSpans'
import { calendarViewOf, weekTitle, withCalendarView, withJourneys, type CalendarMode, type CalendarView } from './calendarView'
import { campaignHome } from './vocabulary'

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LANES = 3
/** a day with more campaigns than lanes keeps the first two and says how many more in the third */
const SHOWN_WHEN_FULL = LANES - 1
const MODES: { value: CalendarMode; label: string }[] = [{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]

export function CampaignCalendar({ filters, zone, canEdit }: { filters: Record<string, string>; zone: string; canEdit: boolean }) {
  const today = dayOf(new Date().toISOString(), zone)
  const [month, setMonth] = useState<Month>(() => monthOf(today))
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const wide = useMinWidth(BREAKPOINT.md)
  const [params, setParams] = useSearchParams()
  const view = calendarViewOf(params, today)
  const setView = (patch: Partial<CalendarView>) => setParams((current) => withCalendarView(current, patch, today))
  const week = view.mode === 'week'
  const weekEnd = addDays(view.start, 6)

  const weeks = monthWeeks(month)
  const window = { date_from: weeks[0][0], date_to: weeks[weeks.length - 1][6] }
  const calendar = useQuery({
    queryKey: ['campaigns', 'calendar', window, filters],
    queryFn: ({ signal }) => api.get<CampaignCalendarData>('/campaigns/calendar/', { ...filters, ...window }, signal),
    placeholderData: keepPreviousData,
    enabled: !week,
  })

  const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(month.year, month.month, 1)))
  const title = week ? weekTitle(view.start, weekEnd) : monthTitle
  const inMonth = (key: string) => monthOf(key).month === month.month
  const placed = placeSpans(withJourneys(calendar.data?.spans ?? [], view.journeys), weeks, zone)
  const onDay = (key: string) => placed.filter((item) => item.from <= key && key <= item.to)

  const full = (key: string) => onDay(key).length > LANES
  /** the stretches of a bar in the week; in the last lane a bar stops at a full day and goes on after it */
  const segments = (item: PlacedSpan, week: string[]): [string, string][] => {
    const days = week.filter((key) => key >= item.from && key <= item.to && (item.lane < SHOWN_WHEN_FULL || !full(key)))
    const runs: [string, string][] = []
    for (const key of days) {
      const last = runs.at(-1)
      if (last && week.indexOf(key) === week.indexOf(last[1]) + 1) last[1] = key
      else runs.push([key, key])
    }
    return runs
  }
  const bar = (item: PlacedSpan, week: string[], from: string, to: string) => {
    const startsHere = from === item.from
    const endsHere = to === item.to && !(item.span.ongoing && to === weeks[weeks.length - 1][6])
    return (
      <Link key={`${item.span.campaign}-${from}`} to={campaignHome({ ...item.span, id: item.span.campaign }, canEdit)} title={describe(item.span, zone)} aria-label={describe(item.span, zone)}
        style={{ gridColumn: `${week.indexOf(from) + 1} / ${week.indexOf(to) + 2}`, gridRow: item.lane + 1 }}
        className={`mx-1 block h-5 truncate px-1.5 text-xs font-semibold leading-5 hover:underline ${statusColours(barStatus(item.span))} ${startsHere ? 'rounded-l-sm' : '-ml-px'} ${endsHere ? 'rounded-r-sm' : '-mr-px'} ${inMonth(from) || inMonth(to) ? '' : 'opacity-60'}`}>
        {item.span.is_journey_generated && <Route size={12} strokeWidth={1.5} aria-hidden data-journey-mark className="mr-1 inline-block align-[-2px] text-plum-700" />}
        {item.span.name}
      </Link>
    )
  }

  return (
    <section aria-label="Campaign calendar" className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IconButton variant="outline" icon={ChevronLeft} label={week ? 'Previous Week' : 'Previous Month'}
          onClick={() => (week ? setView({ start: addDays(view.start, -7) }) : setMonth(shiftMonth(month, -1)))} />
        <h2 aria-live="polite" className="min-w-40 text-center font-display text-lg font-semibold text-ink-900">{title}</h2>
        <IconButton variant="outline" icon={ChevronRight} label={week ? 'Next Week' : 'Next Month'}
          onClick={() => (week ? setView({ start: addDays(view.start, 7) }) : setMonth(shiftMonth(month, 1)))} />
        {week
          ? <Button size="sm" onClick={() => setView({ start: today })} disabled={view.start === today}>Today</Button>
          : <Button size="sm" onClick={() => setMonth(monthOf(today))} disabled={monthOf(today).year === month.year && monthOf(today).month === month.month}>Today</Button>}
        {calendar.isFetching && <Spinner size="sm" />}
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <SegmentedControl label="Calendar View" variant="outline" options={MODES} value={view.mode} onChange={(mode) => setView({ mode })} />
          <Switch label="Journey Runs" checked={view.journeys} onChange={(journeys) => setView({ journeys })} />
        </div>
      </div>
      {!week && <p className="-mt-2 mb-3 text-xs text-ink-800">Days are in the workspace's time zone, {zone}.</p>}

      {week ? (
        <CampaignWeek filters={filters} zone={zone} canEdit={canEdit} start={view.start} journeys={view.journeys} today={today} />
      ) : calendar.isError ? (
        <ErrorState title="The calendar could not be loaded" error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : !wide ? (
        placed.length === 0 ? <p className="text-sm text-ink-800">{calendar.isPending ? 'Loading the month' : 'No campaign runs in this month with these filters.'}</p> : (
          <ul aria-label={`Campaigns in ${title}`} className="divide-y divide-line">
            {placed.map((item) => (
              <li key={item.span.campaign} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <Link to={campaignHome({ ...item.span, id: item.span.campaign }, canEdit)} className="min-w-0 truncate font-medium text-brand-800 hover:underline">{item.span.name}</Link>
                <span className="flex items-center gap-2 text-xs text-ink-800">
                  {item.from === item.to ? dayTitle(item.from) : `${item.from} to ${item.span.ongoing ? 'ongoing' : item.to}`}
                  <StatusBadge status={barStatus(item.span)} />
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div role="grid" aria-label={title} className="overflow-hidden rounded-sm border border-line">
          <div role="row" className="grid grid-cols-7 border-b border-line bg-surface-subtle">
            {WEEKDAY.map((day) => <div key={day} role="columnheader" className="border-l border-line px-3 py-2 text-xs font-semibold uppercase text-ink-900 first:border-l-0">{day}</div>)}
          </div>
          {weeks.map((week) => {
            const bars = placed.filter((item) => item.from <= week[6] && item.to >= week[0])
            return (
              <div key={week[0]} role="row" className="relative border-b border-line last:border-b-0">
                <div className="grid grid-cols-7">
                  {week.map((key) => {
                    return (
                      <div key={key} role="gridcell" aria-label={`${dayTitle(key)}: ${onDay(key).length} campaign${onDay(key).length === 1 ? '' : 's'}`}
                        className={`flex min-h-28 flex-col justify-between border-l border-line px-2 pb-1 pt-1.5 first:border-l-0 ${inMonth(key) ? '' : 'bg-surface-subtle'}`}>
                        <span className={`cep-num inline-flex h-6 w-6 items-center justify-center text-sm font-medium ${key === today ? 'rounded-full bg-brand-600 text-white' : inMonth(key) ? 'text-ink-900' : 'text-ink-300'}`}>
                          {Number(key.slice(8))}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-9 grid grid-cols-7 gap-y-0.5 [&>*]:pointer-events-auto">
                  {bars.filter((item) => item.lane < LANES).flatMap((item) => segments(item, week).map(([from, to]) => bar(item, week, from, to)))}
                  {week.filter(full).map((key) => (
                    <button key={`more-${key}`} type="button" onClick={() => setDayOpen(key)} style={{ gridColumn: week.indexOf(key) + 1, gridRow: LANES }}
                      className={`${buttonClass({ variant: 'link', size: 'sm' })} mx-1 h-5 justify-start px-1.5 text-xs`}>
                      +{onDay(key).length - SHOWN_WHEN_FULL} More
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!week && wide && !calendar.isError && (
        <CalendarLegend journeys={view.journeys} note={calendar.data && placed.length === 0 ? 'No campaign runs in this month with these filters.' : undefined} />
      )}

      {!week && dayOpen && <CalendarDayModal day={dayOpen} spans={onDay(dayOpen).map((item) => item.span)} canEdit={canEdit} onClose={() => setDayOpen(null)} />}
    </section>
  )
}
