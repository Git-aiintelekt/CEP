import { Link } from 'react-router-dom'

import { CategoryTag } from '@/components/CategoryTag'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { statusColours } from '@/components/statusColours'
import type { CalendarSpan } from '@/lib/types'

import { barStatus, dayTitle, LEGEND } from './calendarSpans'
import { campaignHome } from './vocabulary'

/** the status colours, and a Journey Run item while journey runs are shown */
export function CalendarLegend({ journeys, note }: { journeys: boolean; note?: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-800">
      {note && <span className="font-medium text-ink-900">{note}</span>}
      {LEGEND.map(([status, text]) => <span key={text} className="inline-flex items-center gap-1.5"><span aria-hidden data-legend={status} className={`h-3 w-5 rounded-sm ${statusColours(status)}`} />{text}</span>)}
      {journeys && <span data-legend="journey" className="inline-flex items-center gap-1.5"><CategoryTag category="journey" />Journey Run</span>}
    </div>
  )
}

/** every campaign on one day, when the day has more than fits */
export function CalendarDayModal({ day, spans, canEdit, onClose }: { day: string; spans: CalendarSpan[]; canEdit: boolean; onClose: () => void }) {
  return (
    <Modal title={dayTitle(day)} onClose={onClose}>
      <ul className="divide-y divide-line">
        {spans.map((span) => (
          <li key={span.campaign} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <Link to={campaignHome({ ...span, id: span.campaign }, canEdit)} className="min-w-0 truncate font-medium text-brand-800 hover:underline">{span.name}</Link>
            <span className="flex shrink-0 items-center gap-2">
              {span.is_journey_generated && <CategoryTag category="journey" />}
              <StatusBadge status={barStatus(span)} />
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
