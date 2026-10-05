/** After Approve (or on opening a journey that is already ACTIVE, or APPROVED with a schedule): the whole page body
 * becomes this centred outcome. "Currently Qualifying" is the real eligible pool, GET /journeys/{id}/audience/. */
import { useQuery } from '@tanstack/react-query'
import { Check, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Spinner } from '@/components/States'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { JourneyAudience } from '@/lib/types'

import type { Outcome } from './testPublish'

export function JourneyOutcome({ journeyId, outcome }: { journeyId: string; outcome: Outcome }) {
  const audience = useQuery({
    queryKey: ['journeys', 'audience', journeyId],
    queryFn: ({ signal }) => api.get<JourneyAudience>(`/journeys/${journeyId}/audience/`, undefined, signal),
  })
  const live = outcome.kind === 'ACTIVE'
  const paused = outcome.kind === 'ACTIVE' && outcome.paused
  const title = outcome.kind === 'ACTIVE'
    ? (outcome.version ? (paused ? `Version ${outcome.version} Is Ready` : `Version ${outcome.version} Is Now Live`) : paused ? 'This Journey Is Paused' : 'Journey Is Now Live')
    : outcome.version ? `Version ${outcome.version} Is Scheduled` : 'Journey Is Scheduled to Activate'
  const text = outcome.kind === 'ACTIVE'
    ? (outcome.version
        ? (paused ? `The journey is paused: version ${outcome.version} runs when you resume it on the journey’s page. Customers already inside finish the version they started.`
                  : `New customers enter version ${outcome.version} from now on. Customers already inside finish the version they started.`)
        : paused ? 'Resume it on the journey’s page. To change it, edit it: your changes become a new version to test here.'
                 : 'This Journey is active and running automatically. New customers who qualify will start flowing in immediately — no further manual action is needed.')
    : outcome.version
      ? `It replaces the live version automatically at the time below; the live version keeps running until then. You can cancel the schedule on the journey’s page.`
      : 'It will go live automatically at the time below. Until then you can cancel the schedule on the journey’s page and approve it again for another time.'

  const qualifying =
    audience.isPending ? <Spinner size="sm" label="Loading the qualifying count" />
    : audience.isError || audience.data.eligible_pool === null ? 'Not calculated'
    : `${formatNumber(audience.data.eligible_pool)} customers`

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 md:px-8">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <span className={`flex h-16 w-16 items-center justify-center rounded-full ${live && !paused ? 'bg-success text-white' : 'bg-warning-bg text-warning-text'}`}>
          {live && !paused ? <Check size={32} strokeWidth={2.5} aria-hidden /> : <Clock size={32} strokeWidth={2} aria-hidden />}
        </span>
        <h1 className="mt-6 font-display text-page-title font-semibold text-ink-900">{title}</h1>
        <p className="mt-2 max-w-md text-sm text-ink-800">{text}</p>

        <dl className="mt-8 grid w-full gap-3 sm:grid-cols-2">
          {live ? (
            <>
              <Stat label="Currently Qualifying" value={qualifying} />
              <Stat label="First Run" value={paused ? 'When resumed' : 'Starting now'} />
            </>
          ) : (
            <>
              <Stat label="Activates On" value={outcome.when} />
              <Stat label="Currently Qualifying" value={qualifying} />
            </>
          )}
        </dl>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to={`/journeys/${journeyId}`} className={buttonSecondary}>View This Journey</Link>
          <Link to="/journeys" className={buttonPrimary}>Go to Journey Dashboard →</Link>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line p-4 text-left">
      <dt className="text-helper text-ink-800">{label}</dt>
      <dd className="mt-1 font-display text-section-title font-semibold text-ink-900 tabular-nums">{value}</dd>
    </div>
  )
}
