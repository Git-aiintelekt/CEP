/**
 * A date field that opens a month calendar: ‹ › months, weekday initials, today ringed, the chosen day filled, days
 * before `min` disabled. The grid follows the WAI-ARIA date picker pattern: arrows move a day or a week, Home/End go
 * to the week's ends, Page Up/Down change month, Enter or Space chooses, Escape closes and returns to the field.
 * Values are local calendar dates, "YYYY-MM-DD", or '' for none.
 */
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { formatDateValue, fromDateValue, toDateValue } from '@/lib/dateValue'

import { IconButton } from './Button'
import { controlClass } from './controlStyles'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const monthTitle = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const sameDay = (a: Date | null, b: Date | null) => a !== null && b !== null && a.getTime() === b.getTime()

function addMonths(date: Date, months: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last))
}

/** six rows of seven, Sunday first, from the Sunday on or before the 1st */
function monthGrid(month: Date): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = addDays(first, -first.getDay())
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)))
}

interface DatePickerProps {
  /** "YYYY-MM-DD" or '' */
  value: string
  onChange: (value: string) => void
  /** the field's accessible name, e.g. "Activation Date" */
  label: string
  placeholder?: string
  /** "YYYY-MM-DD": days before it can't be chosen; default today */
  min?: string
  /** for tests: what "today" is */
  today?: Date
  className?: string
}

export function DatePicker({ value, onChange, label, placeholder = 'Select Date', min, today: todayProp, className = '' }: DatePickerProps) {
  const today = startOfDay(todayProp ?? new Date())
  const minDate = (min ? fromDateValue(min) : null) ?? today
  const selected = fromDateValue(value)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState<Date>(() => selected ?? (today < minDate ? minDate : today))
  const trigger = useRef<HTMLButtonElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLTableElement>(null)
  const titleId = useId()
  const panelId = useId()

  const close = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  const openCalendar = () => {
    setFocused(selected ?? (today < minDate ? minDate : today))
    setOpen(true)
  }

  // the focused day takes focus whenever it moves (or the calendar opens)
  useEffect(() => {
    if (!open) return
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
  }, [open, focused])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const choose = (day: Date) => {
    if (day < minDate) return
    onChange(toDateValue(day))
    close(true)
  }

  const onGridKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -focused.getDay()),
      End: () => addDays(focused, 6 - focused.getDay()),
      PageUp: () => addMonths(focused, -1),
      PageDown: () => addMonths(focused, 1),
    }
    if (event.key in moves) {
      event.preventDefault()
      const next = moves[event.key]()
      setFocused(next < minDate ? minDate : next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(focused)
    }
  }

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    // stop here so a dialog around the field stays open
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }

  const shownMonth = new Date(focused.getFullYear(), focused.getMonth(), 1)
  const canGoBack = shownMonth > new Date(minDate.getFullYear(), minDate.getMonth(), 1)
  const text = formatDateValue(value)

  return (
    <div ref={wrapper} className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}, ${text || 'not set'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : openCalendar())}
        className={`${controlClass({ size: 'sm' })} flex items-center gap-2 text-left`}
      >
        <Calendar size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" />
        <span className={`truncate ${text ? 'text-ink-900' : 'text-ink-300'}`}>{text || placeholder}</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={onPanelKeyDown}
          className="absolute top-full left-0 z-40 mt-1.5 w-[296px] max-w-[calc(100vw-32px)] rounded-md border border-line bg-surface-overlay p-3 shadow-menu animate-popover-in motion-reduce:animate-none"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <IconButton label="Previous Month" icon={ChevronLeft} size="sm" disabled={!canGoBack} onClick={() => setFocused(addMonths(focused, -1) < minDate ? minDate : addMonths(focused, -1))} />
            <p id={titleId} aria-live="polite" className="text-sm font-semibold text-ink-900">{monthTitle.format(shownMonth)}</p>
            <IconButton label="Next Month" icon={ChevronRight} size="sm" onClick={() => setFocused(addMonths(focused, 1))} />
          </div>
          <table ref={grid} role="grid" aria-labelledby={titleId} onKeyDown={onGridKeyDown} className="w-full border-collapse">
            <thead>
              <tr>
                {WEEKDAYS.map((day) => (
                  <th key={day} scope="col" abbr={day} className="h-8 text-center text-xs font-semibold text-ink-800">
                    <span aria-hidden>{day[0]}</span>
                    <span className="sr-only">{day}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthGrid(shownMonth).map((week) => (
                <tr key={week[0].toISOString()}>
                  {week.map((day) => {
                    const outside = day.getMonth() !== shownMonth.getMonth()
                    const past = day < minDate
                    const isSelected = sameDay(day, selected)
                    const isToday = sameDay(day, today)
                    const isFocused = sameDay(day, focused)
                    const look =
                      isSelected ? 'bg-brand-600 font-semibold text-on-brand hover:bg-brand-fill-hover'
                      : past ? 'cursor-not-allowed text-ink-300'
                      : `${outside ? 'text-ink-800' : 'text-ink-900'} hover:bg-brand-100 hover:text-link-hover`
                    return (
                      <td key={day.toISOString()} role="gridcell" aria-selected={isSelected} className="p-0.5 text-center">
                        <button
                          type="button"
                          tabIndex={isFocused ? 0 : -1}
                          disabled={past}
                          aria-label={dayName.format(day)}
                          aria-current={isToday ? 'date' : undefined}
                          onClick={() => choose(day)}
                          className={`mx-auto flex h-8 w-8 items-center justify-center rounded-control-md text-sm tabular-nums transition-colors duration-fast ease-standard ${look} ${isToday && !isSelected ? 'ring-1 ring-focus ring-inset' : ''}`}
                        >
                          {day.getDate()}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
