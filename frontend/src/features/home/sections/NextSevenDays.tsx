import { CalendarDays } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatClock, formatShortDay } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, Schedule, ScheduleDay } from '../data/types'
import { scheduleHref } from '../scheduleHref'

const NAMED = 3
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
            className={`flex min-h-[64px] flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition-colors duration-fast ease-standard ${selected ? 'border-brand-600 bg-brand-100' : 'border-line bg-surface hover:bg-surface-subtle'}`}>
            <span className={`text-xs font-semibold ${selected ? 'text-brand-800' : 'text-ink-900'}`}>{dayName(day, index, 'short')}</span>
            <span className={`text-xs ${selected ? 'text-brand-800' : 'text-ink-800'}`}>{formatShortDay(day.day)}</span>
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

/** "6 sends today: 08:00 October Newsletter Preview, 09:30 Welcome Series, Step 2, 11:30 Flash Sale Reminder and 3 more." */
function daySummary(schedule: Schedule, index: number): string {
  const day = schedule.days[index]
  const runs = [...day.runs].sort((a, b) => a.at.localeCompare(b.at))
  const when = index === 0 ? 'today' : `on ${weekday(day.day, 'long')}`
  if (runs.length === 0) return `No sends are scheduled ${when}.`
  const named = runs.slice(0, NAMED).map((run) => `${formatClock(run.at, schedule.timezone)} ${run.name}`)
  const more = runs.length - named.length
  return `${sends(runs.length)} ${when}: ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`
}

function WeekNote({ schedule, index, journeysShown }: { schedule: Schedule; index: number; journeysShown: boolean }) {
  const campaigns = schedule.days.reduce((total, day) => total + day.campaignRuns, 0)
  const journeys = journeysShown ? schedule.days.reduce((total, day) => total + day.journeyRuns, 0) : 0
  const parts = [campaigns > 0 ? `${campaigns} campaign send${campaigns === 1 ? '' : 's'}` : null, journeys > 0 ? `${journeys} journey touchpoint${journeys === 1 ? '' : 's'}` : null].filter(Boolean)
  return (
    <div data-week-note className="flex items-start gap-3 rounded-lg border border-line bg-surface-subtle px-4 py-3">
      <CalendarDays size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-brand-600" />
      <p className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink-900">{parts.length ? `${parts.join(' and ')} this week` : 'Nothing scheduled this week'}</span>
        <span data-day-summary className="text-helper text-ink-800">{daySummary(schedule, index)}</span>
      </p>
    </div>
  )
}

/** The week ahead: a tile per day with a dot per kind of run, and the picked day's sends in a sentence. */
export function NextSevenDays({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useSchedule(filters)
  const [picked, setPicked] = useState(0)
  if (result.status === 'unavailable') return null
  const href = scheduleHref(filters)
  const journeysShown = filters.campaignIds.length === 0
  return (
    <HomeCard title="Next 7 Days" icon={CalendarDays}
      actions={<Link to={href} className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`}>Open Schedule</Link>}>
      {result.status === 'loading' ? (
        <div data-schedule="loading" className="flex flex-col gap-4">
          <div className="grid grid-cols-7 gap-1.5">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-16 rounded-lg bg-surface-sunken" />)}</div>
          <div className="flex flex-col gap-3">{[80, 65].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}</div>
        </div>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.retry} title="The schedule could not be loaded" />
      ) : (
        <div className="flex h-full flex-col gap-4">
          <DayStrip days={result.data.days} picked={picked} onPick={setPicked} journeysShown={journeysShown} />
          <WeekNote schedule={result.data} index={picked} journeysShown={journeysShown} />
        </div>
      )}
    </HomeCard>
  )
}
