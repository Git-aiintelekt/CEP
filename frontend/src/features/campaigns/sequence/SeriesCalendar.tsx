/**
 * The series as a month grid, Monday first: days in the series filled Gray 75, send days marked with their message
 * numbers. The Sequence step shows every send day ahead (Blue 100, Blue 600 border); the campaign page shows the days
 * already sent in the Completed sky blue and outlines today. It scrolls inside its card once a long drip passes ~7 rows.
 */
import type { CalendarCell } from '../dripSequence'

const SEND = {
  upcoming: 'border-brand-600 bg-brand-100 font-semibold text-brand-800',
  sent: 'border-transparent bg-tag-completed-bg font-semibold text-tag-completed-text',
}

export function SeriesCalendar({ calendar, sentDays, today }: {
  calendar: { title: string; cells: CalendarCell[] }
  /** the dates ("YYYY-MM-DD") whose messages went out */
  sentDays?: ReadonlySet<string>
  /** "YYYY-MM-DD" in the drip's zone: outlined */
  today?: string
}) {
  const showsSent = Boolean(sentDays && sentDays.size > 0)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-800">{calendar.title}</span>
      <div className="max-h-[300px] overflow-y-auto" data-series-calendar>
        <div role="grid" aria-label="Series Calendar" className="grid grid-cols-7 gap-[3px]">
          <div role="row" className="contents">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <span key={day} role="columnheader" className="sticky top-0 flex h-5 items-center justify-center bg-surface text-xs font-semibold text-ink-800">{day}</span>
            ))}
          </div>
          {calendar.cells.map((cell) => {
            const send = cell.messages.length > 0
            const sent = send && sentDays?.has(cell.key)
            const isToday = cell.key === today
            return (
              <span key={cell.key} role="gridcell" aria-label={`${cell.name}${sent ? ', sent' : ''}${isToday ? ', today' : ''}`} data-send={send ? (sent ? 'sent' : 'upcoming') : undefined}
                data-in-series={cell.inSeries || undefined} data-today={isToday || undefined}
                className={`cep-num flex h-10 flex-col items-center justify-center rounded-sm border text-xs whitespace-nowrap ${
                  send ? SEND[sent ? 'sent' : 'upcoming'] : cell.inSeries ? 'border-transparent bg-surface-subtle text-ink-900' : 'border-transparent text-ink-300'} ${isToday ? 'outline-2 outline-offset-1 outline-ink-900' : ''}`}>
                <span aria-hidden>{cell.label}</span>
                {send && <span aria-hidden className="text-xs font-semibold">{cell.messages.map((number) => `M${number}`).join(' ')}</span>}
              </span>
            )
          })}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs text-ink-800"><span aria-hidden className="h-2.5 w-2.5 rounded-xs border border-line-subtle bg-surface-subtle" />In the Series</span>
        {showsSent && <span className="flex items-center gap-1.5 text-xs text-ink-800"><span aria-hidden className="h-2.5 w-2.5 rounded-xs bg-tag-completed-bg" />Sent</span>}
        <span className="flex items-center gap-1.5 text-xs text-ink-800"><span aria-hidden className="h-2.5 w-2.5 rounded-xs border border-brand-600 bg-brand-100" />{showsSent ? 'To Send, with Message Number' : 'Send Day, with Message Number'}</span>
        {today && <span className="flex items-center gap-1.5 text-xs text-ink-800"><span aria-hidden className="h-2.5 w-2.5 rounded-xs outline-1 outline-ink-900" />Today</span>}
      </div>
    </div>
  )
}
