/** The Build page's bottom bar (the step-category legend, Back to Setup and Continue to Test Publish) and the
 * readiness indicator that sits in its top bar. */
import { ArrowLeft, ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Tooltip } from '@/components/Tooltip'

import type { Validity } from './graphModel'
import { CATEGORY, CATEGORY_ORDER } from './nodeDefs'

export function ReadinessPill({ validity }: { validity: Validity }) {
  return validity.ready ? (
    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control-md border border-success bg-surface px-3 text-sm font-medium whitespace-nowrap text-success-text">
      <CircleCheck size={16} strokeWidth={1.5} aria-hidden /> Ready for Test Publish
    </span>
  ) : (
    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control-md border border-warning bg-warning-bg px-3 text-sm font-medium whitespace-nowrap text-warning-text">
      <TriangleAlert size={16} strokeWidth={1.5} aria-hidden /> {validity.unconfigured} step{validity.unconfigured === 1 ? '' : 's'} need setup
    </span>
  )
}

export function Footer({ journeyId, validity, onBackToSetup }: { journeyId: string; validity: Validity; onBackToSetup: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-4 border-t border-line bg-surface px-5 py-3">
      <ul aria-label="Step Categories" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {CATEGORY_ORDER.map((key) => (
          <li key={key} className="flex items-center gap-1.5 text-helper whitespace-nowrap text-ink-800">
            <span aria-hidden className={`h-2 w-2 rounded-full ${CATEGORY[key].dot}`} />
            {CATEGORY[key].label}
          </li>
        ))}
      </ul>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" onClick={onBackToSetup} className={buttonSecondary}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Back to Setup
        </button>
        {validity.ready ? (
          <Link to={`/journeys/${journeyId}/test-publish`} className={buttonPrimary}>
            Continue to Test Publish <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
          </Link>
        ) : (
          <Tooltip content="Every step needs its settings finished first.">
            <button type="button" disabled aria-disabled className={`${buttonPrimary} cursor-not-allowed`}>
              Continue to Test Publish <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
