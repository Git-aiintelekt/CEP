import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { DEFAULT_FILTERS, type HomeChannel, type HomeFilters, type HomePeriod } from './data/types'

const CHANNELS: HomeChannel[] = ['ALL', 'EMAIL', 'SMS', 'MMS']
const PERIODS: HomePeriod[] = ['7d', '30d', '90d']

/** The Home filters live in the URL (?campaigns=a,b&channel=SMS&period=7d); defaults are left out of it. */
export function useHomeFilters(): [HomeFilters, (next: Partial<HomeFilters>) => void, () => void] {
  const [params, setParams] = useSearchParams()
  const filters = useMemo<HomeFilters>(() => {
    const channel = params.get('channel') as HomeChannel | null
    const period = params.get('period') as HomePeriod | null
    return {
      campaignIds: (params.get('campaigns') ?? '').split(',').filter(Boolean),
      channel: channel && CHANNELS.includes(channel) ? channel : DEFAULT_FILTERS.channel,
      period: period && PERIODS.includes(period) ? period : DEFAULT_FILTERS.period,
    }
  }, [params])

  const update = useCallback((next: Partial<HomeFilters>) => {
    setParams((current) => {
      const merged = { ...filters, ...next }
      const result = new URLSearchParams(current)
      const write = (key: string, value: string, fallback: string) => (value === fallback ? result.delete(key) : result.set(key, value))
      write('campaigns', merged.campaignIds.join(','), '')
      write('channel', merged.channel, DEFAULT_FILTERS.channel)
      write('period', merged.period, DEFAULT_FILTERS.period)
      return result
    }, { replace: true })
  }, [filters, setParams])

  const clear = useCallback(() => update(DEFAULT_FILTERS), [update])
  return [filters, update, clear]
}
