import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { zoneShort } from '@/features/campaigns/dripSequence'
import { formatClock } from '@/lib/format'

import { ChannelIcon } from '../components/ChannelIcon'
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

/** The day's mix as a thin bar along the tile's foot: blue for campaign runs, plum for journey runs; nothing on an empty day. */
function MixBar({ campaigns, journeys, onBlue }: { campaigns: number; journeys: number; onBlue: boolean }) {
  const total = campaigns + journeys
  if (total === 0) return <span aria-hidden data-mix className="mt-2 h-[3px]" />
  return (
    <span aria-hidden data-mix className="mt-2 flex h-[3px] w-4/5 overflow-hidden rounded-pill">
      {campaigns > 0 && <span data-mix-part="campaign" className={onBlue ? 'bg-on-brand-soft' : 'bg-brand-600'} style={{ width: `${(campaigns / total) * 100}%` }} />}
      {journeys > 0 && <span data-mix-part="journey" className="bg-chart-2" style={{ width: `${(journeys / total) * 100}%` }} />}
    </span>
  )
}

/** Seven days as radio tiles: one tab stop, the arrow keys move and pick, Home and End jump to the ends. The picked day is solid blue; a bar at the foot shows the mix of campaign and journey runs. */
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
            className={`flex min-h-[88px] flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-2.5 text-center transition-colors duration-fast ease-standard ${selected ? 'border-brand-600 bg-brand-600' : 'border-line-subtle bg-surface hover:bg-surface-hover'}`}>
            <span className={`text-xs font-medium ${selected ? 'text-on-brand' : 'text-ink-800'}`}>{dayName(day, index, 'short')}</span>
            <span className={`text-card-heading font-semibold cep-num ${selected ? 'text-on-brand' : 'text-ink-900'}`}>{Number(day.day.slice(8))}</span>
            <span className={`text-xs ${selected ? 'text-on-brand-soft' : 'text-ink-800'}`}>{day.runs.length} run{day.runs.length === 1 ? '' : 's'}</span>
            <MixBar campaigns={day.campaignRuns} journeys={journeysShown ? day.journeyRuns : 0} onBlue={selected} />
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

/** The picked day's sends in time order, edge to edge with hairlines between: the time, the channel, the name and what it is, the first few named. */
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
        <ul aria-label={`Sends ${when}`} className="-mx-6 divide-y divide-line-subtle border-y border-line-subtle">
          {runs.slice(0, NAMED).map((run) => {
            const journey = run.source === 'journey'
            // a drip message carries its zone and its type: "Mon · 09:00 CT", "Drip · Email"
            const kind = journey ? 'Journey' : run.drip ? 'Drip' : 'Campaign'
            return (
              <li key={run.id} data-run={run.source} className="flex min-h-14 items-center gap-4 px-6 py-2">
                <span className="w-16 shrink-0 text-sm font-semibold whitespace-nowrap text-ink-900 cep-num">
                  {formatClock(run.at, schedule.timezone)}{run.drip ? ` ${zoneShort(schedule.timezone)}` : ''}
                </span>
                <span aria-hidden className="flex shrink-0"><ChannelIcon channel={run.channel} /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <TruncatedText text={run.name} className="text-sm font-semibold text-ink-900" />
                  <span className="text-xs text-ink-800">{index === 0 ? 'Today' : weekday(day.day, 'short')} · {kind} · {CHANNEL_LABEL[run.channel]}</span>
                </span>
                <span className={`inline-flex h-6 shrink-0 items-center rounded-sm px-2 text-xs font-medium ${journey || run.drip ? 'bg-cat-journey-bg text-cat-journey-text' : 'bg-cat-campaign-bg text-cat-campaign-text'}`}>
                  {kind}
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
    <HomeCard title="Next 7 Days" helper={result.status === 'ready' ? `${result.data.days.reduce((total, day) => total + day.runs.length, 0)} runs · ${zoneShort(result.data.timezone)}` : undefined}
      actions={<Link to={href} className={buttonClass({ variant: 'secondary', size: 'sm' })}>Open Schedule</Link>}>
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
