/** A drip message's state as a tag, the same on the campaign page and in the quick view. Next Up is outlined: not a status colour. */
import { StatusBadge } from '@/components/StatusBadge'

import type { StepState } from './dripDetail'

export function StepTag({ state }: { state: StepState | 'planned' }) {
  switch (state) {
    case 'sent': return <StatusBadge status="COMPLETED" label="Sent" />
    case 'sending': return <StatusBadge status="SENDING" label="Sending" />
    case 'next': return <span className="inline-flex h-[22px] shrink-0 items-center rounded-sm border border-link bg-brand-100 px-2 text-xs font-semibold whitespace-nowrap text-brand-800">Next Up</span>
    case 'scheduled': return <StatusBadge status="SCHEDULED" label="Scheduled" />
    case 'on-hold': return <StatusBadge status="PAUSED" label="On Hold" />
    case 'cancelled': return <StatusBadge status="ARCHIVED" label="Cancelled" />
    case 'failed': return <StatusBadge status="FAILED" label="Failed" />
    case 'planned': return <StatusBadge status="DRAFT" label="Not Published" />
  }
}
