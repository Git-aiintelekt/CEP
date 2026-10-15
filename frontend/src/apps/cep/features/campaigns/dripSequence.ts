/**
 * The Sequence step's arithmetic, kept apart from the screens: when each message of a drip goes out, the gaps between
 * them, the tags on a card, what still blocks Continue, and the series calendar. Days count from the start date
 * (campaign.scheduled_at, read in the campaign's zone); a message goes at its own send time, else the series time
 * (drip_config.time, else the start's own time of day), the backend's rule in apps/campaigns/drip.py.
 */
import type { Campaign, DripStep } from '@/lib/types'

import { isoToZoned, isKnownZone } from './zone'

export const MAX_MESSAGES = 30
export const MAX_DAY = 365
/** the backend's default gap for a new message: the last day + 3 */
export const DEFAULT_GAP_DAYS = 3
export const DEFAULT_SERIES_TIME = '09:00'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** a calendar day as UTC noon, so adding days never trips over a daylight-saving change */
const asDay = (value: string) => new Date(`${value}T12:00:00Z`)
const plusDays = (value: string, days: number) => {
  const date = asDay(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}
const dayValue = (date: Date) => date.toISOString().slice(0, 10)

/** "Thu 15 Oct" */
export const shortDay = (date: Date) => `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH[date.getUTCMonth()]}`
/** "Mon 12 Oct 2026" */
export const longDay = (date: Date) => `${shortDay(date)} ${date.getUTCFullYear()}`

/** "CT": the zone's generic short name (no summer/winter letter), else its usual short name */
export function zoneShort(zone: string): string {
  const safe = isKnownZone(zone) ? zone : 'UTC'
  for (const style of ['shortGeneric', 'short'] as const) {
    try {
      const name = new Intl.DateTimeFormat('en-US', { timeZone: safe, timeZoneName: style }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value
      if (name && !/^GMT[+-]/.test(name)) return name
      if (name && style === 'short') return name
    } catch {
      // older engines lack shortGeneric
    }
  }
  return safe
}

export interface Series {
  zone: string
  zoneShort: string
  /** "YYYY-MM-DD" in the zone, or '' before a start date is chosen */
  start: string
  /** HH:MM every message uses unless it has its own: drip_config.time, else the start's own time of day */
  time: string
}

export function seriesOf(campaign: Campaign, workspaceZone: string): Series {
  const zone = campaign.send_timezone || workspaceZone
  const local = isoToZoned(campaign.scheduled_at, zone)
  const configured = campaign.drip_config?.time?.slice(0, 5) ?? ''
  return {
    zone,
    zoneShort: zoneShort(zone),
    start: local.slice(0, 10),
    time: configured || local.slice(11, 16) || DEFAULT_SERIES_TIME,
  }
}

/** when one message goes: its date (null without a start date) and its clock time */
export function sendOf(step: Pick<DripStep, 'day' | 'send_time'>, series: Series): { date: Date | null; time: string } {
  return { date: series.start ? plusDays(series.start, step.day) : null, time: step.send_time?.slice(0, 5) || series.time }
}

/** "Message 2 of 4 · Day 3 · Thu 15 Oct, 09:00 CT" */
export function eyebrowOf(step: DripStep, total: number, series: Series): string {
  const { date, time } = sendOf(step, series)
  return `Message ${step.position} of ${total} · Day ${step.day} · ${date ? `${shortDay(date)}, ` : ''}${time} ${series.zoneShort}`
}

export interface Gap {
  label: string
  /** under two days from the message before (or the same day) */
  close: boolean
  note?: string
}

export const CLOSE_NOTE = 'Close together. Frequency limits may skip some people.'

/** the pill before the message at `index` of the day-ordered list */
export function gapBefore(steps: DripStep[], index: number): Gap {
  const day = steps[index].day
  if (index === 0) return { label: day === 0 ? 'On the start date' : `${day} ${day === 1 ? 'day' : 'days'} after start`, close: false }
  const gap = day - steps[index - 1].day
  if (gap <= 0) return { label: 'Same day', close: true }
  if (gap === 1) return { label: '1 day later', close: true, note: CLOSE_NOTE }
  return { label: `${gap} days later`, close: false }
}

const sameText = (a: string | null | undefined, b: string | null | undefined) => Boolean(a?.trim()) && a?.trim().toLowerCase() === b?.trim().toLowerCase()

/** the first earlier message with the same subject line (email), for the "Same Subject as Message N" nudge */
export function sameSubjectAs(steps: DripStep[], step: DripStep): DripStep | null {
  return steps.find((other) => other.position < step.position && sameText(other.subject_line, step.subject_line)) ?? null
}

export type CardTagTone = 'neutral' | 'amber' | 'red' | 'plum'
export type CardTagKind = 'ready' | 'template' | 'subject' | 'text' | 'same-day' | 'same-subject' | 'ab' | 'own-time'
export interface CardTag { kind: CardTagKind; label: string; tone: CardTagTone }

export function tagsOf(steps: DripStep[], step: DripStep, email: boolean): CardTag[] {
  const tags: CardTag[] = []
  if (step.problems.length === 0) tags.push({ kind: 'ready', label: 'Ready', tone: 'neutral' })
  if (step.problems.includes('NEEDS_TEMPLATE')) tags.push({ kind: 'template', label: 'Needs Template', tone: 'amber' })
  if (step.problems.includes('NEEDS_SUBJECT')) tags.push({ kind: 'subject', label: 'Needs Subject', tone: 'amber' })
  if (step.problems.includes('NEEDS_TEXT')) tags.push({ kind: 'text', label: 'Needs Message Text', tone: 'amber' })
  if (step.problems.includes('SAME_DAY')) tags.push({ kind: 'same-day', label: 'Same Day as Another Message', tone: 'red' })
  const twin = email ? sameSubjectAs(steps, step) : null
  if (twin) tags.push({ kind: 'same-subject', label: `Same Subject as Message ${twin.position}`, tone: 'amber' })
  if (email && step.ab_config?.enabled) tags.push({ kind: 'ab', label: 'A/B Subject Test', tone: 'plum' })
  if (step.send_time) tags.push({ kind: 'own-time', label: 'Own Send Time', tone: 'neutral' })
  return tags
}

/** what stands between the Sequence step and Continue */
export interface SequenceProblems {
  /** the messages that still need something, in day order */
  messages: DripStep[]
  noStart: boolean
  any: boolean
}

export function sequenceProblems(steps: DripStep[], series: Series): SequenceProblems {
  const messages = steps.filter((step) => step.problems.length > 0)
  return { messages, noStart: !series.start, any: messages.length > 0 || !series.start }
}

/** "2 messages need attention before you continue." (and the start date, when that is missing too) */
export function bannerText(problems: SequenceProblems): string {
  const count = problems.messages.length
  const messages = count === 0 ? '' : `${count} ${count === 1 ? 'message needs' : 'messages need'} attention before you continue.`
  return [messages, problems.noStart ? 'Choose a start date.' : ''].filter(Boolean).join(' ')
}

/** the footer's line: "All 4 messages are ready." or "1 of 4 messages needs attention." */
export function statusText(steps: DripStep[], problems: SequenceProblems): string {
  const total = steps.length
  const count = problems.messages.length
  if (count > 0) return `${count} of ${total} ${count === 1 ? 'messages needs' : 'messages need'} attention.`
  if (problems.noStart) return 'Choose a start date.'
  return total === 1 ? 'The message is ready.' : `All ${total} messages are ready.`
}

/** the top line of Series at a Glance, and the line under it */
export function summaryOf(steps: DripStep[], series: Series): { title: string; detail: string } {
  if (steps.length === 0) return { title: 'No messages yet', detail: '' }
  const last = steps[steps.length - 1]
  const lastSend = sendOf(last, series)
  if (!series.start) return { title: steps.length === 1 ? '1 message' : `${steps.length} messages over ${last.day + 1} days`, detail: 'Choose a start date to see the dates.' }
  if (steps.length === 1) return { title: `1 message on ${longDay(lastSend.date as Date)}`, detail: `Sends at ${lastSend.time} ${series.zoneShort}.` }
  return { title: `${steps.length} messages over ${last.day + 1} days`, detail: `Last message sends ${longDay(lastSend.date as Date)}, ${lastSend.time} ${series.zoneShort}` }
}

export interface CalendarCell {
  key: string
  /** "12", or "1 Nov" on the first of a month */
  label: string
  /** a full name for screen readers: "Thu 15 Oct 2026, message 2" */
  name: string
  inSeries: boolean
  /** the message numbers sent that day (more than one only while two share a day) */
  messages: number[]
}

/** whole weeks, Monday first, from the start date's week to the last message's week */
export function calendarOf(steps: DripStep[], series: Series): { title: string; cells: CalendarCell[] } | null {
  if (!series.start || steps.length === 0) return null
  const lastDay = steps[steps.length - 1].day
  const start = asDay(series.start)
  const end = plusDays(series.start, lastDay)
  const before = (start.getUTCDay() + 6) % 7
  const after = 6 - ((end.getUTCDay() + 6) % 7)
  const cells: CalendarCell[] = []
  for (let offset = -before; offset <= lastDay + after; offset += 1) {
    const date = plusDays(series.start, offset)
    const messages = steps.filter((step) => step.day === offset).map((step) => step.position)
    const inSeries = offset >= 0 && offset <= lastDay
    cells.push({
      key: dayValue(date),
      label: date.getUTCDate() === 1 ? `1 ${MONTH[date.getUTCMonth()]}` : String(date.getUTCDate()),
      name: `${longDay(date)}${messages.length ? `, message ${messages.join(' and ')}` : inSeries ? ', in the series' : ''}`,
      inSeries,
      messages,
    })
  }
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()
  const title = sameMonth ? `${MONTH_LONG[start.getUTCMonth()]} ${start.getUTCFullYear()}`
    : `${MONTH_LONG[start.getUTCMonth()]}${start.getUTCFullYear() === end.getUTCFullYear() ? '' : ` ${start.getUTCFullYear()}`} – ${MONTH_LONG[end.getUTCMonth()]} ${end.getUTCFullYear()}`
  return { title, cells }
}

/** where Add Message puts the next one: the backend's default, last day + 3 (Day 0 for the first) */
export function nextDay(steps: DripStep[]): number {
  return steps.length ? Math.min(MAX_DAY, steps[steps.length - 1].day + DEFAULT_GAP_DAYS) : 0
}

/** "Day 17 (Thu 29 Oct)", or "Day 17" without a start date */
export function dayWithDate(day: number, series: Series): string {
  return series.start ? `Day ${day} (${shortDay(plusDays(series.start, day))})` : `Day ${day}`
}

/** the drawer's grey sentence: when this message goes and to whom */
export function sendSentence(step: Pick<DripStep, 'day' | 'send_time'>, series: Series): string {
  const { date, time } = sendOf(step, series)
  if (!date) return step.day === 0 ? 'Sends on the start date.' : `Sends ${step.day} ${step.day === 1 ? 'day' : 'days'} after the start date.`
  return `Sends ${longDay(date)} at ${time} ${series.zoneShort} to everyone on the campaign list who is still subscribed and within frequency limits.`
}

/** a message's internal name, or a stand-in while it has none */
export const messageTitle = (step: Pick<DripStep, 'name'>) => step.name.trim() || 'Untitled Message'

/** a server timestamp read in the drip's zone: "Mon 12 Oct", "Mon 12 Oct 2026" and "09:00" (null when there is none) */
export function whenInZone(iso: string | null | undefined, zone: string): { day: string; long: string; time: string } | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: isKnownZone(zone) ? zone : 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((part) => [part.type, part.value]))
  const day = `${parts.weekday} ${parts.day} ${parts.month}`
  return { day, long: `${day} ${parts.year}`, time: `${parts.hour}:${parts.minute}` }
}
