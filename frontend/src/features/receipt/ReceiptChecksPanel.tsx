/** The pre-send checks: a green check when a rule holds, an amber warning when it does not. */
import { CircleCheck, TriangleAlert } from 'lucide-react'

import type { ReceiptCheck } from './receiptChecks'

export function ReceiptChecksPanel({ checks }: { checks: ReceiptCheck[] }) {
  const failing = checks.filter((check) => check.status === 'fail').length
  return (
    <section aria-label="Checks" className="flex flex-col">
      <div className="flex items-baseline justify-between gap-2 border-b border-line p-3">
        <h2 className="text-sm font-semibold text-ink-900">Checks</h2>
        <span className="cep-num text-xs text-ink-800">{failing === 0 ? 'All passing' : `${failing} to fix`}</span>
      </div>
      <ul>
        {checks.map((check) => {
          const passing = check.status === 'pass'
          const Icon = passing ? CircleCheck : TriangleAlert
          return (
            <li key={check.id} data-check={check.id} data-status={check.status} className="flex items-start gap-2.5 border-b border-line-subtle px-3 py-3">
              <Icon size={16} strokeWidth={1.5} aria-hidden className={`mt-0.5 shrink-0 ${passing ? 'text-success' : 'text-warning'}`} />
              <div className="min-w-0">
                <p className={`text-sm ${passing ? 'text-ink-900' : 'font-semibold text-warning-text'}`}>
                  {check.title}
                  <span className="sr-only">{passing ? ' (passing)' : ' (needs attention)'}</span>
                </p>
                <p className="text-xs text-ink-800">{check.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
