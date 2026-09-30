import { CalendarDays, Image, Mail, MessageSquare, type LucideIcon } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { CategoryTag } from '@/components/CategoryTag'
import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatClock, formatShortDay, zoneAbbreviation } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, MessageChannel, Schedule, ScheduleDay } from '../data/types'
import { scheduleHref } from '../scheduleHref'

const MAX_ROWS = 8
const CHANNEL: Record<MessageChannel, { icon: LucideIcon; label: string }> = {
  EMAIL: { icon: Mail, label: 'Email' },
  SMS: { icon: MessageSquare, label: 'SMS' },
  MMS: { icon: Image, label: 'MMS' },
}
const weekday = (day: string, style: 'short' | 'long') => new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const longDate = (day: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const sends = (count: number) => `${count} send${count === 1 ? '' : 's'}`

/** "Friday 2 October, 4 sends: 2 campaign, 2 journey": the split the bar shows, for screen readers */
function dayLabel(day: ScheduleDay, index: number, journeysShown: boolean) {
  const count = day.runs.length
  const split = `${day.campaignRuns} campaign${journeysShown ? `, ${day.journeyRuns} journey` : ''}`
  return `${index === 0 ? 'Today' : weekday(day.day, 'long')} ${longDate(day.day)}, ${count ? `${sends(count)}: ${split}` : 'No sends'}`
}

function SplitBar({ day }: { day: ScheduleDay }) {
  const total = day.campaignRuns + day.journeyRuns
  return (
    <span aria-hidden data-split className="mt-auto flex h-1 w-full overflow-hidden rounded-xs bg-fill-subtle">
      {total > 0 && <span data-share="campaign" className="h-full bg-chart-1" style={{ width: `${(day.campaignRuns / total) * 100}%` }} />}
      {total > 0 && <span data-share="journey" className="h-full bg-plum-500" style={{ width: `${(day.journeyRuns / total) * 100}%` }} />}
    </span>
  )
}

/** Seven days as radio tiles: one tab stop, the arrow keys move and pick, Home and End jump to the ends. journeysShown: false under a campaign filter. */
function DayStrip({ days, picked, onPick, journeysShown }: { days: ScheduleDay[]; picked: number; onPick: (index: number) => void; journeysShown: boolean }) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const move = (event: KeyboardEvent) => {
    const next = { ArrowRight: picked + 1, ArrowLeft: picked - 1, Home: 0, End: days.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const index = Math.min(days.length - 1, Math.max(0, next))
    onPick(index)
    tiles.current[index]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Pick a day" onKeyDown={move}
      className="grid snap-x auto-cols-[minmax(72px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 min-[640px]:grid-cols-7 min-[640px]:overflow-visible min-[640px]:pb-0">
      {days.map((day, index) => {
        const selected = index === picked
        const count = day.runs.length
        return (
          <button key={day.day} ref={(node) => { tiles.current[index] = node }} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
            aria-label={dayLabel(day, index, journeysShown)} onClick={() => onPick(index)}
            className={`flex min-h-[84px] snap-start flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors duration-fast ease-standard ${selected ? 'border-brand-600 bg-brand-100' : 'border-line bg-surface hover:bg-surface-subtle'}`}>
            <span className={`text-helper font-semibold ${selected ? 'text-brand-800' : 'text-ink-900'}`}>{index === 0 ? 'Today' : weekday(day.day, 'short')}</span>
            <span className={`text-helper ${selected ? 'text-brand-800' : 'text-ink-800'}`}>{formatShortDay(day.day)}</span>
            <span className={`mb-1.5 font-display text-[22px] leading-tight font-semibold cep-num ${count ? 'text-ink-900' : 'text-ink-300'}`}>{count || '—'}</span>
            <SplitBar day={day} />
          </button>
        )
      })}
    </div>
  )
}

function DayList({ schedule, index, moreHref }: { schedule: Schedule; index: number; moreHref: string }) {
  const day = schedule.days[index]
  const zone = schedule.timezone
  const runs = [...day.runs].sort((a, b) => a.at.localeCompare(b.at))
  const extra = runs.length - MAX_ROWS
  const name = index === 0 ? 'Today' : weekday(day.day, 'long')
  return (
    <div className="border-t border-line-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-2">
        <p data-day-heading className="text-helper font-semibold text-ink-900">
          {name}, {formatShortDay(day.day)} · {sends(runs.length)} · {zoneAbbreviation(zone, new Date(`${day.day}T12:00:00Z`))}
        </p>
        <span className="flex items-center gap-3 text-helper text-ink-800">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-xs bg-chart-1" />Campaign</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-xs bg-plum-500" />Journey</span>
        </span>
      </div>
      <ul aria-label={`Sends on ${name}`} className="divide-y divide-line-subtle">
        {runs.length === 0 && <li className="flex h-10 items-center text-helper text-ink-800">No sends scheduled</li>}
        {runs.slice(0, MAX_ROWS).map((run) => {
          const { icon: Icon, label } = CHANNEL[run.channel]
          const time = formatClock(run.at, zone)
          return (
            <li key={run.id} data-run={run.source} data-sent={run.sent || undefined} aria-label={`${time}, ${run.name}, ${label}, ${run.sent ? 'sent' : run.source}`}
              className="flex h-10 items-center gap-3">
              <span className={`w-14 shrink-0 text-sm cep-num ${run.sent ? 'text-ink-300' : 'text-ink-900'}`}>{time}</span>
              <Icon size={16} strokeWidth={1.5} role="img" aria-label={label} className={`shrink-0 ${run.sent ? 'text-ink-300' : 'text-ink-800'}`} />
              <TruncatedText text={run.name} className={`min-w-0 flex-1 text-sm ${run.sent ? 'text-ink-300' : 'text-ink-900'}`} />
              {run.sent ? <span className="shrink-0 text-helper text-ink-800">Sent</span> : <span className="shrink-0"><CategoryTag category={run.source} /></span>}
            </li>
          )
        })}
        {extra > 0 && (
          <li className="flex h-10 items-center text-helper">
            <Link to={moreHref} className="font-semibold text-brand-800 hover:underline">{extra} more sends on this day</Link>
          </li>
        )}
      </ul>
    </div>
  )
}

/** The week ahead: a tile per day with its send count and campaign / journey split, and the picked day's sends. */
export function NextSevenDays({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useSchedule(filters)
  const [picked, setPicked] = useState(0)
  if (result.status === 'unavailable') return null
  const href = scheduleHref(filters)
  const total = result.status === 'ready' ? result.data.total : null
  return (
    <HomeCard title="Next 7 Days" icon={CalendarDays}
      helper={total === null ? undefined : total === 0 ? 'No runs scheduled' : `${total} run${total === 1 ? '' : 's'} scheduled`}
      footer={<Link to={href} className={`${buttonClass({ variant: 'link', size: 'sm' })} -ml-3`}>Open Schedule</Link>}>
      {result.status === 'loading' ? (
        <div data-schedule="loading" className="flex flex-col gap-4">
          <div className="grid grid-cols-7 gap-2">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-[84px] rounded-lg bg-surface-sunken" />)}</div>
          <div className="flex flex-col gap-3">{[80, 65, 72, 50].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}</div>
        </div>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="The schedule could not be loaded" />
      ) : (
        <div className="flex flex-col gap-4">
          <DayStrip days={result.data.days} picked={picked} onPick={setPicked} journeysShown={filters.campaignIds.length === 0} />
          <DayList schedule={result.data} index={picked} moreHref={scheduleHref(filters, result.data.days[picked].day)} />
        </div>
      )}
    </HomeCard>
  )
}
