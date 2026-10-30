/**
 * The dashboard's period as one chip (docs/mockups/dashboards.html): “30 Days · 1 Oct – 30 Oct 2026”. Its menu has the quick
 * choices on the left, applied at once, and a month calendar on the right for a custom range: the first day clicked starts
 * it, the second ends it, Apply sets it.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Button, IconButton } from '@/components/Button'
import { FilterChip } from '@/components/FilterChip'
import { fromDateValue, toDateValue } from '@/lib/dateValue'
import { useFiscalYear } from '../api'
import type { Period, PeriodBounds } from '../types'
import { periodBounds, periodWords, presetsFor } from './layout'

const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** six weeks, Monday first, from the Monday on or before the 1st */
function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

function RangeCalendar({ from, to, onPick }: { from: string; to: string; onPick: (day: string) => void }) {
  const [month, setMonth] = useState(() => { const d = fromDateValue(to || from) ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const shift = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <IconButton label="Previous Month" icon={ChevronLeft} size="xs" onClick={() => shift(-1)} />
        <p className="text-sm font-semibold text-ink-900" aria-live="polite">{monthTitle.format(month)}</p>
        <IconButton label="Next Month" icon={ChevronRight} size="xs" onClick={() => shift(1)} />
      </div>
      <div role="grid" aria-label={monthTitle.format(month)} className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {WEEKDAYS.map((day, i) => <span key={i} aria-hidden className="flex h-7 items-center justify-center font-semibold text-ink-800">{day}</span>)}
        {monthDays(month).map((date) => {
          const value = toDateValue(date)
          const end = value === from || value === to
          const inside = from && to && value > from && value < to
          const other = date.getMonth() !== month.getMonth()
          return (
            <button key={value} type="button" role="gridcell" aria-selected={end || Boolean(inside)} aria-label={dayName.format(date)} onClick={() => onPick(value)}
              className={`cep-num flex h-7 items-center justify-center rounded-sm ${end ? 'bg-brand-600 font-semibold text-on-brand' : inside ? 'bg-brand-100 text-brand-800' : other ? 'text-ink-300 hover:bg-surface-hover' : 'text-ink-900 hover:bg-surface-hover'}`}>
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PeriodMenu({ period, onPeriod, bounds }: { period: Period; onPeriod: (next: Period) => void; bounds?: PeriodBounds }) {
  const start = useFiscalYear().data?.start ?? 1
  const shown = bounds ?? periodBounds(period, new Date(), start)
  const presets = presetsFor(start).filter((p) => p.value !== 'custom')
  const name = presets.find((p) => p.value === period.preset)?.label
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const picked = range ?? { from: period.preset === 'custom' ? period.from ?? '' : '', to: period.preset === 'custom' ? period.to ?? '' : '' }
  const pick = (day: string) => setRange(!picked.from || picked.to || day < picked.from ? { from: day, to: '' } : { from: picked.from, to: day })
  return (
    <FilterChip label={name ? `${name} · ${periodWords(shown)}` : periodWords(shown)} active menuLabel="Period" menuWidth={520} maxLabelWidth={320} align="start">
      {({ close }) => (
        <div className="flex">
          <ul role="listbox" aria-label="Quick Choices" className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-line-subtle p-1.5">
            {presets.map((preset) => {
              const on = preset.value === period.preset
              return (
                <li key={preset.value}>
                  <button type="button" role="option" aria-selected={on} onClick={() => { onPeriod({ preset: preset.value }); setRange(null); close() }}
                    className={`flex h-8 w-full items-center rounded-sm px-2.5 text-left text-sm ${on ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}>
                    {preset.label}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
            <RangeCalendar from={picked.from} to={picked.to} onPick={pick} />
            <div className="flex items-center gap-2 border-t border-line-subtle pt-3">
              <p className="mr-auto text-xs text-ink-800">{picked.from ? (picked.to ? periodWords({ ...shown, from: picked.from, to: picked.to }) : 'Now pick the last day') : 'Pick the first day'}</p>
              <Button size="sm" onClick={() => { setRange(null); close() }}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={!picked.from || !picked.to} onClick={() => { onPeriod({ preset: 'custom', from: picked.from, to: picked.to }); setRange(null); close() }}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </FilterChip>
  )
}
