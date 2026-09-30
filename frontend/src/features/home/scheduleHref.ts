import type { HomeFilters } from './data/types'

/**
 * The Campaigns calendar's week view, with the page's channel: the one place "Open Schedule" is built. The week starts
 * today unless `start` says otherwise (the day picked in Next 7 Days).
 */
export function scheduleHref(filters: HomeFilters, start?: string): string {
  const params = new URLSearchParams({ view: 'calendar', mode: 'week' })
  if (start) params.set('start', start)
  if (filters.channel !== 'ALL') params.set('channel', filters.channel)
  return `/campaigns?${params.toString()}`
}
