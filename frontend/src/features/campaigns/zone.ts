/**
 * A campaign is scheduled in ITS time zone, not the browser's: "09:00 in Chicago" has to mean the same send for
 * an operator in Atlanta and one in Kochi. These turn the wall-clock value of a date-time input into the UTC
 * timestamp the API stores, and back.
 */

function offsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

export function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** '2026-11-02T09:00' read as a clock in `zone` -> '2026-11-02T15:00:00.000Z'. Null when the value is not a date-time. */
export function zonedToIso(local: string, zone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!match || !isKnownZone(zone)) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let at = wall - offsetMinutes(new Date(wall), zone) * 60_000
  at = wall - offsetMinutes(new Date(at), zone) * 60_000 // a second pass settles the hours around a daylight-saving change
  return new Date(at).toISOString()
}

/** ISO timestamp -> the value of a date-time input showing the clock in `zone`. */
export function isoToZoned(iso: string | null | undefined, zone: string): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime()) || !isKnownZone(zone)) return ''
  return new Date(at.getTime() + offsetMinutes(at, zone) * 60_000).toISOString().slice(0, 16)
}

/** "2 Nov 2026, 09:00 (America/Chicago)" */
export function formatInZone(iso: string | null | undefined, zone: string): string {
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  const safe = isKnownZone(zone) ? zone : 'UTC'
  return `${new Intl.DateTimeFormat(undefined, { timeZone: safe, dateStyle: 'medium', timeStyle: 'short' }).format(at)} (${safe})`
}

/**
 * "09:39 EDT": the time of day in `zone` with its short name, for tight spaces. Intl will not combine timeStyle with
 * timeZoneName, and most locales other than US English name American zones "GMT-4"; so the time follows the reader's
 * locale and the zone name comes from US English.
 */
export function timeInZone(iso: string | null | undefined, zone: string): string {
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  const safe = isKnownZone(zone) ? zone : 'UTC'
  const time = new Intl.DateTimeFormat(undefined, { timeZone: safe, timeStyle: 'short' }).format(at)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: safe, timeZoneName: 'short' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? safe
  return `${time} ${name}`
}

/** "2 Nov 2026, 09:00 CST": the date in `zone`, then timeInZone */
/** "18 Sept 2026", the day as it was in `zone` */
export function dateInZone(iso: string | null | undefined, zone: string): string {
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { timeZone: isKnownZone(zone) ? zone : 'UTC', dateStyle: 'medium' }).format(at)
}

export function dateTimeInZone(iso: string | null | undefined, zone: string): string {
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  const safe = isKnownZone(zone) ? zone : 'UTC'
  return `${new Intl.DateTimeFormat(undefined, { timeZone: safe, dateStyle: 'medium' }).format(at)}, ${timeInZone(iso, safe)}`
}
