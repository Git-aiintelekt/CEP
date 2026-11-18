/** What components/UpgradeNotice.tsx works from: the build this page runs, the status query, the words for a start time. */
import { ApiError } from '@/lib/api'
import { API_BASE_URL } from '@/lib/config'
import type { PlatformStatus } from '@/lib/types'

export const BUILT_VERSION: string = __CEP_VERSION__
export const PLATFORM_STATUS_KEY = ['platform-status'] as const
export const POLL_MS = 30_000
export const CHECK_MS = 10_000
export const SHOW_AFTER_MS = 3_000
export const VERSION_EVERY_MS = 5 * 60_000
export const FIRM_BEFORE_MS = 15 * 60_000

/** the API did not answer: no connection, or the proxy in front of a restarting service */
export const isDown = (error: unknown) => error instanceof ApiError && [0, 502, 503, 504].includes(error.status)

export const clock = (date: Date) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** "in 12 minutes (22:00)", "today at 22:00", "tomorrow at 22:00", "on 21 Nov at 22:00": in the viewer's own time zone */
export function whenWords(startsAt: Date, now = new Date()): string {
  const minutes = Math.round((startsAt.getTime() - now.getTime()) / 60_000)
  if (minutes <= 60) return `in ${Math.max(1, minutes)} minute${minutes === 1 ? '' : 's'} (${clock(startsAt)})`
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(startsAt) - day(now)) / 86_400_000)
  if (days === 0) return `today at ${clock(startsAt)}`
  if (days === 1) return `tomorrow at ${clock(startsAt)}`
  return `on ${startsAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${clock(startsAt)}`
}

/** GET /platform-status/ on its own, outside the API client: a failure here must not raise the "unreachable" signal the
 * notice itself listens to (that would ask again at once, for ever). Throws an ApiError with the status, 0 for no answer. */
export async function fetchStatus(signal?: AbortSignal): Promise<PlatformStatus> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/platform-status/`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError(0, { type: 'about:blank', title: 'C360 could not be reached', status: 0 })
  }
  if (!response.ok) throw new ApiError(response.status, { type: 'about:blank', title: 'C360 had a problem', status: response.status })
  return (await response.json()) as PlatformStatus
}

/** A newer build than this page's, or null (in development, or when /version.json is not there). */
export async function newerBuild(): Promise<string | null> {
  if (BUILT_VERSION === 'dev') return null
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as { version?: unknown }
    return typeof data.version === 'string' && data.version && data.version !== BUILT_VERSION ? data.version : null
  } catch {
    return null
  }
}
