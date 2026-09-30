/**
 * The calendar's week: seven columns from `start`, each day's sends as blocks in their campaign's status colour, in time
 * order. Below 768px the week is a list, a heading per day.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Image, Mail, MessageSquare, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { CategoryTag } from '@/components/CategoryTag'
import { ErrorState, SkeletonLine } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Tooltip } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { statusColours } from '@/components/statusColours'
import { addDays } from '@/features/reports/period'
import { api } from '@/lib/api'
import { formatClock, zoneAbbreviation } from '@/lib/format'
import type { CalendarSpan, CampaignCalendarData } from '@/lib/types'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

import { CalendarDayModal, CalendarLegend } from './CalendarParts'
import { dayOf } from './calendarMath'
import { barStatus, statusLabel } from './calendarSpans'
import { withJourneys } from './calendarView'
import { campaignHome } from './vocabulary'

const SHOWN = 8
const CHANNEL: Record<string, { icon: LucideIcon; label: string }> = {
  EMAIL: { icon: Mail, label: 'Email' },
  SMS: { icon: MessageSquare, label: 'SMS' },
  MMS: { icon: Image, label: 'MMS' },
}
const channelOf = (channel: string) => CHANNEL[channel] ?? CHANNEL.EMAIL

interface WeekSend {
  key: string
  span: CalendarSpan
  at: string
  time: string
  name: string
  sent: boolean
}

const weekday = (day: string, style: 'short' | 'long') => new Intl.DateTimeFormat('en-GB', { weekday: style, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const dateOf = (day: string, month: 'short' | 'long') => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
  .replace('Sept', 'Sep')

function spoken(send: WeekSend): string {
  const { label } = channelOf(send.span.channel)
  return `${send.name}: ${statusLabel(barStatus(send.span))}, ${send.time}, ${label}${send.span.is_journey_generated ? ', journey run' : ''}${send.sent ? ', sent' : ''}`
}

function SendBlock({ send, canEdit }: { send: WeekSend; canEdit: boolean }) {
  const { icon: Icon } = channelOf(send.span.channel)
  return (
    <Tooltip content={send.name} className="flex w-full">
      <Link to={campaignHome({ ...send.span, id: send.span.campaign }, canEdit)} aria-label={spoken(send)} data-send={send.span.campaign}
        className={`flex w-full min-w-0 flex-col gap-0.5 rounded-sm px-2 py-1.5 text-xs transition-colors duration-fast ${statusColours(barStatus(send.span))}`}>
        <span className="flex items-center gap-1.5">
          <span className="font-semibold cep-num">{send.time}</span>
          <Icon size={12} strokeWidth={1.5} aria-hidden />
          {send.sent && <span data-sent className="ml-auto">Sent</span>}
        </span>
        <span className="line-clamp-2 break-words">{send.name}</span>
        {send.span.is_journey_generated && <span className="mt-0.5"><CategoryTag category="journey" /></span>}
      </Link>
    </Tooltip>
  )
}

interface CampaignWeekProps {
  filters: Record<string, string>
  zone: string
  canEdit: boolean
  start: string
  journeys: boolean
  today: string
}

export function CampaignWeek({ filters, zone, canEdit, start, journeys, today }: CampaignWeekProps) {
  const wide = useMinWidth(BREAKPOINT.md)
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const days = Array.from({ length: 7 }, (_, offset) => addDays(start, offset))
  const window = { date_from: days[0], date_to: days[6] }
  const calendar = useQuery({
    queryKey: ['campaigns', 'calendar', window, filters],
    queryFn: ({ signal }) => api.get<CampaignCalendarData>('/campaigns/calendar/', { ...filters, ...window }, signal),
    placeholderData: keepPreviousData,
  })

  const spans = withJourneys(calendar.data?.spans ?? [], journeys)
  const sends = new Map<string, WeekSend[]>(days.map((day) => [day, []]))
  for (const span of spans) {
    span.sends.forEach((send, index) => {
      const bucket = sends.get(dayOf(send.at, zone))
      if (!bucket) return
      bucket.push({
        key: `${span.campaign}-${index}`, span, at: send.at, time: formatClock(send.at, zone), name: send.label ? `${span.name}, ${send.label}` : span.name,
        sent: send.state === 'SENT' || send.state === 'SENDING' || new Date(send.at).getTime() < calendar.dataUpdatedAt,
      })
    })
  }
  for (const bucket of sends.values()) bucket.sort((a, b) => a.at.localeCompare(b.at))
  const total = [...sends.values()].reduce((count, bucket) => count + bucket.length, 0)
  const spansOn = (day: string) => [...new Map((sends.get(day) ?? []).map((send) => [send.span.campaign, send.span])).values()]

  return (
    <div data-calendar-week>
      <p className="mb-3 text-xs text-ink-800">Times in {zoneAbbreviation(zone, new Date(`${start}T12:00:00Z`))}</p>
      {calendar.data && total === 0 && <p className="mb-3 text-sm font-medium text-ink-900">No campaign runs in this week with these filters.</p>}

      {calendar.isError ? (
        <ErrorState title="The calendar could not be loaded" error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : !wide ? (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <section key={day} aria-label={`${weekday(day, 'long')} ${dateOf(day, 'long')}`}>
              <h3 className={`text-helper font-semibold ${day === today ? 'text-brand-800' : 'text-ink-900'}`}>{weekday(day, 'short')} {dateOf(day, 'short')}</h3>
              {calendar.isPending ? <SkeletonLine width="70%" /> : (sends.get(day) ?? []).length === 0 ? <p className="py-2 text-xs text-ink-800">No sends</p> : (
                <ul className="divide-y divide-line-subtle">
                  {(sends.get(day) ?? []).map((send) => {
                    const { icon: Icon, label } = channelOf(send.span.channel)
                    return (
                      <li key={send.key} className="flex items-center gap-2 py-2 text-sm">
                        <span className="w-12 shrink-0 text-ink-900 cep-num">{send.time}</span>
                        <Icon size={16} strokeWidth={1.5} role="img" aria-label={label} className="shrink-0 text-ink-800" />
                        <Link to={campaignHome({ ...send.span, id: send.span.campaign }, canEdit)} aria-label={spoken(send)} className="min-w-0 flex-1 truncate text-ink-900 hover:underline">{send.name}</Link>
                        {send.span.is_journey_generated && <CategoryTag category="journey" />}
                        <StatusBadge status={barStatus(send.span)} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-line">
          {days.map((day) => {
            const list = sends.get(day) ?? []
            return (
              <section key={day} aria-label={`${weekday(day, 'long')} ${dateOf(day, 'long')}`} data-day={day} className="flex min-w-0 flex-col border-l border-line-subtle first:border-l-0">
                <header className={`border-b border-line-subtle px-2 py-1.5 ${day === today ? 'bg-brand-100' : 'bg-surface-subtle'}`}>
                  <span className={`block text-helper font-semibold ${day === today ? 'text-brand-800' : 'text-ink-900'}`}>{weekday(day, 'short')}</span>
                  <span className={`block text-helper ${day === today ? 'text-brand-800' : 'text-ink-800'}`}>{dateOf(day, 'short')}</span>
                </header>
                <div className="flex min-h-80 flex-col gap-1 p-2">
                  {calendar.isPending ? (
                    <div data-week-loading className="flex flex-col gap-1"><SkeletonLine width="100%" height={40} /><SkeletonLine width="100%" height={40} /></div>
                  ) : list.length === 0 ? (
                    <p className="text-xs text-ink-800">No sends</p>
                  ) : (
                    <>
                      {list.slice(0, SHOWN).map((send) => <SendBlock key={send.key} send={send} canEdit={canEdit} />)}
                      {list.length > SHOWN && (
                        <button type="button" onClick={() => setDayOpen(day)} className={`${buttonClass({ variant: 'link', size: 'sm' })} -mx-1 self-start`}>+{list.length - SHOWN} More</button>
                      )}
                    </>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {wide && !calendar.isError && <CalendarLegend journeys={journeys} />}
      {dayOpen && <CalendarDayModal day={dayOpen} spans={spansOn(dayOpen)} canEdit={canEdit} onClose={() => setDayOpen(null)} />}
    </div>
  )
}
