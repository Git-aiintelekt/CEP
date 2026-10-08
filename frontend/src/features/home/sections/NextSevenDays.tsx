import { Calendar } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { zoneShort } from '@/features/campaigns/dripSequence'
import { formatClock, formatShortDay } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, MessageChannel, Schedule, ScheduleDay } from '../data/types'
import { scheduleHref } from '../scheduleHref'

const NAMED = 4
const CHANNEL_LABEL: Record<MessageChannel, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }
const weekday = (day: string, style: 'short' | 'long') => new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const longDate = (day: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const sends = (count: number) => `${count} send${count === 1 ? '' : 's'}`
const dayName = (day: ScheduleDay, index: number, style: 'short' | 'long') => (index === 0 ? 'Today' : weekday(day.day, style))

/** "Friday 2 October, 4 sends: 2 campaign, 2 journey": the split the dots show, for screen readers */
function dayLabel(day: ScheduleDay, index: number, journeysShown: boolean) {
  const count = day.runs.length
  const split = `${day.campaignRuns} campaign${journeysShown ? `, ${day.journeyRuns} journey` : ''}`
  return `${dayName(day, index, 'long')} ${longDate(day.day)}, ${count ? `${sends(count)}: ${split}` : 'No sends'}`
}

/** Seven days as radio tiles: one tab stop, the arrow keys move and pick, Home and End jump to the ends. A dot per kind of run: Blue campaign, Plum journey. */
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
    <div role="radiogroup" aria-label="Pick a day" onKeyDown={move} className="grid grid-cols-7 gap-1.5">
      {days.map((day, index) => {
        const selected = index === picked
        return (
          <button key={day.day} ref={(node) => { tiles.current[index] = node }} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
            aria-label={dayLabel(day, index, journeysShown)} onClick={() => onPick(index)}
            className={`flex min-h-[64px] flex-col items-center gap-1 rounded-control-md border px-1 py-2 text-center transition-colors duration-fast ease-standard ${selected ? 'cep-home-day border-plum-200' : 'border-line-subtle bg-surface hover:bg-surface-subtle'}`}>
            <span className={`text-xs font-semibold ${selected ? 'text-plum-800' : 'text-ink-900'}`}>{dayName(day, index, 'short')}</span>
            <span className={`text-xs ${selected ? 'text-plum-800' : 'text-ink-800'}`}>{formatShortDay(day.day)}</span>
            <span aria-hidden data-dots className="mt-1 flex h-1.5 items-center gap-1">
              {day.campaignRuns > 0 && <span data-dot="campaign" className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
              {journeysShown && day.journeyRuns > 0 && <span data-dot="journey" className="h-1.5 w-1.5 rounded-full bg-plum-500" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function weekLine(schedule: Schedule, journeysShown: boolean): string {
  const campaigns = schedule.days.reduce((total, day) => total + day.campaignRuns, 0)
  const journeys = journeysShown ? schedule.days.reduce((total, day) => total + day.journeyRuns, 0) : 0
  const parts = [campaigns > 0 ? `${campaigns} campaign send${campaigns === 1 ? '' : 's'}` : null, journeys > 0 ? `${journeys} journey touchpoint${journeys === 1 ? '' : 's'}` : null].filter(Boolean)
  return parts.length ? `${parts.join(' and ')} this week.` : 'Nothing is scheduled this week.'
}

/** The picked day's sends in time order, a coloured mark for campaign (blue into plum) or journey (plum), the first few named. */
function DayRuns({ schedule, index, journeysShown }: { schedule: Schedule; index: number; journeysShown: boolean }) {
  const day = schedule.days[index]
  const runs = [...day.runs].filter((run) => journeysShown || run.source === 'campaign').sort((a, b) => a.at.localeCompare(b.at))
  const when = index === 0 ? 'today' : `on ${weekday(day.day, 'long')}`
  const more = runs.length - NAMED
  return (
    <div data-day-runs className="flex flex-col gap-2">
      {runs.length === 0 ? (
        <p data-day-summary className="rounded-control-md border border-line-subtle px-2.5 py-2 text-helper text-ink-800">No sends are scheduled {when}.</p>
      ) : (
        <ul aria-label={`Sends ${when}`} className="flex flex-col gap-2">
          {runs.slice(0, NAMED).map((run) => {
            const journey = run.source === 'journey'
            // a drip message carries its zone and its type: "Mon · 09:00 CT", "Drip · Email"
            const kind = journey ? 'Journey' : run.drip ? 'Drip' : 'Campaign'
            return (
              <li key={run.id} data-run={run.source} className="flex items-center gap-2.5 rounded-control-md border border-line-subtle px-2.5 py-2">
                <span aria-hidden className={`w-[3px] self-stretch rounded-xs ${journey ? 'cep-home-journey-down' : 'cep-home-blend-down'}`} />
                <span className="shrink-0 text-helper font-medium whitespace-nowrap text-ink-800 cep-num">
                  {index === 0 ? 'Today' : weekday(day.day, 'short')} · {formatClock(run.at, schedule.timezone)}{run.drip ? ` ${zoneShort(schedule.timezone)}` : ''}
                </span>
                <TruncatedText text={run.name} className="min-w-0 flex-1 text-helper font-semibold text-ink-900" />
                <span className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs font-medium ${journey ? 'bg-cat-journey-bg text-cat-journey-text' : 'bg-cat-campaign-bg text-cat-campaign-text'}`}>
                  {kind} · {CHANNEL_LABEL[run.channel]}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p data-week-note className="text-xs text-ink-800">{more > 0 ? `${more} more ${when}. ` : ''}{weekLine(schedule, journeysShown)}</p>
    </div>
  )
}

/** The week ahead: a tile per day with a dot per kind of run, and the picked day's sends listed. */
export function NextSevenDays({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useSchedule(filters)
  const [picked, setPicked] = useState(0)
  if (result.status === 'unavailable') return null
  const href = scheduleHref(filters)
  const journeysShown = filters.campaignIds.length === 0
  return (
    <HomeCard title="Next 7 Days" icon={Calendar}
      actions={<Link to={href} className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`}>Open Schedule</Link>}>
      {result.status === 'loading' ? (
        <div data-schedule="loading" className="flex flex-col gap-4">
          <div className="grid grid-cols-7 gap-1.5">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-16 rounded-control-md bg-surface-sunken" />)}</div>
          <div className="flex flex-col gap-3">{[80, 65].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}</div>
        </div>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="The schedule could not be loaded" />
      ) : (
        <div className="flex h-full flex-col gap-3.5">
          <DayStrip days={result.data.days} picked={picked} onPick={setPicked} journeysShown={journeysShown} />
          <DayRuns schedule={result.data} index={picked} journeysShown={journeysShown} />
        </div>
      )}
    </HomeCard>
  )
}
