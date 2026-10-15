import { Link } from 'react-router-dom'

import { CategoryTag } from '@/components/CategoryTag'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { statusColours } from '@/components/statusColours'
import type { CalendarSend, CalendarSpan } from '@/lib/types'

import { dayOf } from './calendarMath'
import { barStatus, dayTitle, dripSendTitle, isDripSend, LEGEND, onHold, sendState } from './calendarSpans'
import { whenInZone, zoneShort } from './dripSequence'
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

/**
 * Every campaign on one day, when the day has more than fits. A drip message sent or due that day is a row of its own
 * ("Loyalty Welcome Series · Message 3 of 4 · First Reward · 09:00 CT", then its state); held messages have no day.
 */
export function CalendarDayModal({ day, zone, spans, canEdit, onClose }: { day: string; zone: string; spans: CalendarSpan[]; canEdit: boolean; onClose: () => void }) {
  type Row = { key: string; span: CalendarSpan; send?: CalendarSend & { position: number; count: number } }
  const rows = spans.flatMap((span): Row[] => {
    const sends = span.sends.filter(isDripSend).filter((send) => dayOf(send.at, zone) === day)
    return sends.length ? sends.map((send) => ({ key: `${span.campaign}-${send.position}`, span, send })) : [{ key: span.campaign, span }]
  })
  return (
    <Modal title={dayTitle(day)} onClose={onClose}>
      <ul className="divide-y divide-line">
        {rows.map(({ key, span, send }) => (
          <li key={key} className="flex items-center justify-between gap-3 py-2.5 text-sm" data-day-row={send ? 'drip' : 'campaign'}>
            <span className="flex min-w-0 flex-col">
              <Link to={campaignHome({ ...span, id: span.campaign }, canEdit)} className="min-w-0 truncate font-medium text-brand-800 hover:underline">{send ? dripSendTitle(span, send) : span.name}</Link>
              {send && <span className="cep-num truncate text-xs text-ink-800">{[send.name, `${whenInZone(send.at, zone)?.time ?? ''} ${zoneShort(zone)}`].filter(Boolean).join(' · ')}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {span.is_journey_generated && <CategoryTag category="journey" />}
              {send ? <StatusBadge status={sendState(send).status} label={sendState(send).label} /> : <StatusBadge status={barStatus(span)} label={onHold(span) ? 'On Hold' : undefined} />}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
