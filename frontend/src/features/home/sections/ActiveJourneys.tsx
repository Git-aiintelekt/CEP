import { Route } from 'lucide-react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState, SkeletonLine } from '@/components/States'
import { TruncatedText } from '@/components/Tooltip'
import { buttonClass } from '@/components/buttonStyles'
import { formatNumber, formatPercent } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { HomeFilters, JourneyRow } from '../data/types'

const SHOWN = 5
const RANK: Record<JourneyRow['status'], number> = { FAILED: 0, PAUSED: 1, ACTIVE: 2 }
const CONTEXT: Record<JourneyRow['status'], string> = { FAILED: 'text-danger-text', PAUSED: 'text-warning-text', ACTIVE: 'text-ink-800' }
const HEAD = 'h-10 px-3 text-xs font-semibold whitespace-nowrap text-ink-900'
const NUMBER_HEAD = 'h-10 px-2 text-right text-xs font-semibold whitespace-nowrap text-ink-900'
const ENTERED = 'hidden min-[768px]:table-cell'
const CONVERSION = 'hidden min-[480px]:table-cell'

/** failures first, then paused journeys, then the busiest */
const topJourneys = (rows: JourneyRow[]) => [...rows].sort((a, b) => RANK[a.status] - RANK[b.status] || b.inFlight - a.inFlight).slice(0, SHOWN)

/** The journeys that need a look first, then the busiest, with how many people are in each. */
export function ActiveJourneys({ filters }: { filters: HomeFilters }) {
  const { source } = useHomeData()
  const result = source.useJourneys(filters)
  if (result.status === 'unavailable' || (result.status === 'ready' && result.data.totalJourneys === 0)) return null
  const total = result.status === 'ready' ? result.data.totalJourneys : null
  return (
    <HomeCard title="Active Journeys" icon={Route} flush
      footer={<Link to="/journeys" className={`${buttonClass({ variant: 'link', size: 'sm' })} -ml-3`}>{total === null ? 'View All Journeys' : `View All ${total} Journeys`}</Link>}>
      {result.status === 'loading' ? (
        <div data-journeys="loading" className="flex flex-col gap-5 p-4">{[70, 60, 75, 55, 65].map((width) => <SkeletonLine key={width} width={`${width}%`} />)}</div>
      ) : result.status === 'error' ? (
        <div className="p-4"><ErrorState error={result.error} onRetry={result.retry} title="Journeys could not be loaded" /></div>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">Journeys that need attention first, then the busiest</caption>
          <thead className="bg-surface-subtle">
            <tr className="border-b border-line-subtle">
              <th scope="col" className={`${HEAD} w-[40%] text-left`}>Journey</th>
              <th scope="col" className={`${HEAD} w-[19%] text-left`}>Status</th>
              <th scope="col" className={`${NUMBER_HEAD} w-[13%]`}>In Flight</th>
              <th scope="col" className={`${NUMBER_HEAD} ${ENTERED} w-[13%]`}>Entered</th>
              <th scope="col" className={`${NUMBER_HEAD} ${CONVERSION} w-[15%] pr-3`}>Conversion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {topJourneys(result.data.rows).map((row) => (
              <tr key={row.id} data-journey={row.id} className="h-16">
                <td className="px-3">
                  <div className="flex min-w-0 flex-col items-start">
                    <TruncatedText text={row.name} className="text-sm text-ink-900" />
                    <TruncatedText text={row.contextLine} className={`text-helper ${CONTEXT[row.status]}`} />
                  </div>
                </td>
                <td className="px-3"><StatusBadge status={row.status} /></td>
                <td className="px-2 text-right text-sm text-ink-900 cep-num">{formatNumber(row.inFlight)}</td>
                <td className={`${ENTERED} px-2 text-right text-sm text-ink-900 cep-num`}>{formatNumber(row.entered)}</td>
                <td className={`${CONVERSION} pr-3 pl-2 text-right text-sm text-ink-900 cep-num`}>{formatPercent(row.conversionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </HomeCard>
  )
}
