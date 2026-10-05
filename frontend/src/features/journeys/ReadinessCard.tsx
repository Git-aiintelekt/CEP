/** "Everything below must pass before you can run the test." The 4 checks come from the backend
 * (GET /journeys/{id}/versions/{n}/readiness/ — apps/journeys/publish.py), not re-derived here. */
import { Check, CircleDashed } from 'lucide-react'

import { Spinner } from '@/components/States'
import type { JourneyReadiness } from '@/lib/types'

export function ReadinessCard({ readiness, loading }: { readiness: JourneyReadiness | undefined; loading: boolean }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="font-display text-card-heading font-semibold text-ink-900">Readiness Checks</h2>
      <p className="mt-1 text-helper text-ink-800">Everything below must pass before you can run the test.</p>

      {loading || !readiness ? (
        <p className="mt-4 flex items-center gap-2 text-helper text-ink-800"><Spinner size="sm" /> Checking readiness</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {readiness.items.map((item) => (
            <li key={item.key} className="flex items-start gap-3">
              {item.ok ? (
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
                  <Check size={12} strokeWidth={3} aria-hidden />
                  <span className="sr-only">Passed:</span>
                </span>
              ) : (
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center text-ink-300">
                  <CircleDashed size={20} strokeWidth={1.5} aria-hidden />
                  <span className="sr-only">Not passed:</span>
                </span>
              )}
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${item.ok ? 'text-ink-900' : 'text-ink-800'}`}>{item.label}</p>
                <p className="text-helper text-ink-800">{item.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
