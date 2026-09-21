/** The month grid of the campaign calendar: which days it shows, which days a campaign covers, and which row each bar takes. Days are the workspace's. */
import type { CalendarSpan } from '@/lib/types'

export interface Month { year: number; month: number } // month: 0-11

const pad = (value: number) => String(value).padStart(2, '0')
export const dayKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`

/** the calendar day of a moment, as people of the workspace see it */
export function dayOf(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

export function monthOf(key: string): Month {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 }
}

export function shiftMonth({ year, month }: Month, by: number): Month {
  const moved = new Date(Date.UTC(year, month + by, 1))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() }
}

/** Whole weeks, Monday first, covering the month: 4 to 6 rows of 7 day keys. */
export function monthWeeks({ year, month }: Month): string[][] {
  const first = new Date(Date.UTC(year, month, 1))
  const lead = (first.getUTCDay() + 6) % 7 // Monday = 0
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const rows = Math.ceil((lead + days) / 7)
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => {
      const at = new Date(Date.UTC(year, month, 1 - lead + row * 7 + column))
      return dayKey(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
    }))
}

export interface PlacedSpan { span: CalendarSpan; from: string; to: string; lane: number }

/**
 * Each campaign becomes a bar from its first day to its last inside the grid (a campaign that goes on runs to the
 * grid's end), on the lowest row that is free for all of its days, so a bar keeps its row from week to week.
 */
export function placeSpans(spans: CalendarSpan[], weeks: string[][], zone: string): PlacedSpan[] {
  const gridStart = weeks[0][0]
  const gridEnd = weeks[weeks.length - 1][6]
  const laneEnds: string[] = []
  const placed: PlacedSpan[] = []
  const ranged = spans
    .map((span) => ({ span, from: dayOf(span.start, zone), to: span.ongoing || !span.end ? gridEnd : dayOf(span.end, zone) }))
    .filter((item) => item.from <= gridEnd && item.to >= gridStart)
    .map((item) => ({ ...item, from: item.from < gridStart ? gridStart : item.from, to: item.to > gridEnd ? gridEnd : item.to }))
    .sort((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to) || a.span.name.localeCompare(b.span.name))
  for (const item of ranged) {
    let lane = laneEnds.findIndex((end) => end < item.from)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = item.to
    placed.push({ ...item, lane })
  }
  return placed
}
