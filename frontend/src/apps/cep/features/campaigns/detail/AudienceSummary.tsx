/** The audience in one line and a bar: shared by Overview's Audience card and the Audience tab, so the two can never differ. */
import type { ReactNode } from 'react'

import { formatNumber } from '@/lib/format'

import { percentOf, type AudienceSummaryNumbers } from '../audienceNumbers'

function Swatch({ className, children }: { className: string; children: ReactNode }) {
  return <span className="flex items-center gap-1.5"><span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-xs ${className}`} />{children}</span>
}

export function AudienceSummary({ numbers }: { numbers: AudienceSummaryNumbers }) {
  const { sent, eligible, excluded, total, share } = numbers
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="cep-num font-display text-page-title font-semibold text-ink-900" data-testid="audience-eligible">{formatNumber(eligible)}</span>
        <span className="text-card-title text-ink-800">{sent ? 'recipients at last send' : 'eligible recipients'} · {share}% of your lists</span>
      </p>
      <div role="img" aria-label={`${formatNumber(eligible)} eligible, ${formatNumber(excluded)} excluded, of ${formatNumber(total)} in the lists`}
        className="flex h-2.5 overflow-hidden rounded-xs bg-surface-sunken">
        <span data-bar="eligible" className="h-full bg-success" style={{ width: `${percentOf(eligible, total)}%` }} />
        <span data-bar="excluded" className="h-full bg-warning" style={{ width: `${percentOf(excluded, total)}%` }} />
        <span className="h-full flex-1 bg-fill-muted" />
      </div>
      <div className="cep-num flex flex-wrap gap-x-5 gap-y-1 text-helper text-ink-800">
        <Swatch className="bg-success">Eligible {formatNumber(eligible)}</Swatch>
        <Swatch className="bg-warning">Excluded {formatNumber(excluded)}</Swatch>
        <Swatch className="bg-fill-muted">Total in Lists {formatNumber(total)}</Swatch>
      </div>
    </div>
  )
}
