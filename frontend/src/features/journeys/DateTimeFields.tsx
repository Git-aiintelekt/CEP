/** Setup's Date / Time fields (docs/mockups/journey-date-time-trigger.html, option 1): the schedule's own fields under
 * Specific Trigger, who enters, and a line reading the result back in words. The rule they make is apps/journeys/schedule.py's. */
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'

import { Field, Select, TextInput } from '@/components/Form'
import { controlClass } from '@/components/controlStyles'
import { Popover } from '@/components/Popover'
import { Spinner } from '@/components/States'
import { useAuth } from '@/auth/AuthContext'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Audience, ContactList, JourneyDateAttribute, Page } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { WEEKDAYS, clockText, dateTimeDefinition, describeSchedule, type AudienceRef, type DateTimeChoice } from './entryTriggers'

export const TIMES = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)
const OFFSETS = [-90, -60, -30, -21, -14, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 60, 90]
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, index) => String(index + 1))

function offsetLabel(days: number): string {
  if (days === 0) return 'On the day'
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days < 0 ? 'before' : 'after'}`
}

export function DateTimeFields({ schedule, value, onChange }: { schedule: string; value: DateTimeChoice; onChange: (next: DateTimeChoice) => void }) {
  const { me } = useAuth()
  const zone = me?.tenant.timezone || 'UTC'
  const set = (patch: Partial<DateTimeChoice>) => onChange({ ...value, ...patch })
  const byAttribute = schedule === 'DATE_ATTRIBUTE'
  const times = TIMES.includes(value.time) ? TIMES : [...TIMES, value.time].sort()
  const { when, who } = describeSchedule(dateTimeDefinition(schedule, value), value.audience?.name ?? null)

  const atField = (
    <Field label="At" required strong hint={byAttribute ? undefined : `Workspace time zone (${zone}).`}>
      {(ids) => (
        <Select {...ids} value={value.time} onChange={(event) => set({ time: event.target.value })}>
          {times.map((time) => <option key={time} value={time}>{clockText(time)}</option>)}
        </Select>
      )}
    </Field>
  )

  return (
    <div className="space-y-5">
      {schedule === 'WEEKLY' && (
        <fieldset>
          <legend className="text-sm font-semibold text-ink-900">On<span className="ml-0.5 text-danger-text" aria-hidden>*</span></legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => {
              const on = value.weekdays.includes(day.value)
              return (
                <button key={day.value} type="button" aria-pressed={on} aria-label={day.long}
                  onClick={() => set({ weekdays: on ? value.weekdays.filter((item) => item !== day.value) : [...value.weekdays, day.value] })}
                  className={`h-9 w-11 rounded-lg border text-sm font-medium transition-colors duration-fast ease-standard ${
                    on ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-subtle'}`}>
                  {day.short}
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      {schedule === 'MONTHLY' && (
        <Field label="Day of the Month" required strong>
          {(ids) => (
            <Select {...ids} value={value.dayOfMonth} onChange={(event) => set({ dayOfMonth: event.target.value })}>
              {DAYS_OF_MONTH.map((day) => <option key={day} value={day}>{day}</option>)}
              <option value="LAST">Last Day</option>
            </Select>
          )}
        </Field>
      )}

      {schedule === 'SPECIFIC_DATE' && (
        <Field label="Date" required strong>
          {(ids) => <TextInput {...ids} type="date" value={value.date} onChange={(event) => set({ date: event.target.value })} />}
        </Field>
      )}

      {byAttribute ? (
        <>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <AttributeField value={value.attribute} onPick={(attribute) => set({ attribute })} />
            <Field label="When" required strong>
              {(ids) => (
                <Select {...ids} value={String(value.offsetDays)} onChange={(event) => set({ offsetDays: Number(event.target.value) })}>
                  {OFFSETS.map((days) => <option key={days} value={days}>{offsetLabel(days)}</option>)}
                </Select>
              )}
            </Field>
            {atField}
          </div>
          <div>
            <p id="date-time-repeat" className="text-sm font-semibold text-ink-900">Repeat</p>
            <div role="radiogroup" aria-labelledby="date-time-repeat" className="mt-1.5 inline-flex overflow-hidden rounded-lg border border-line-control">
              {([[true, 'Every Year'], [false, 'Once']] as const).map(([yearly, label]) => (
                <button key={label} type="button" role="radio" aria-checked={value.yearly === yearly} onClick={() => set({ yearly })}
                  className={`h-10 border-r border-line-subtle px-3.5 text-sm last:border-r-0 ${value.yearly === yearly ? 'bg-brand-100 font-semibold text-brand-800' : 'bg-surface text-ink-900 hover:bg-surface-subtle'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-helper text-ink-800">Every Year reads the day and month only (birthdays, anniversaries); Once reads the full date (a renewal date).</p>
          </div>
          <Field label="Only Customers In" strong hint={`Optional. Empty: every customer whose record has this date. Workspace time zone (${zone}).`}>
            {() => <AudienceDropdown value={value.audience} optional onPick={(audience) => set({ audience })} />}
          </Field>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {atField}
          <Field label="Who Enters" required strong hint="A customer list or a segment.">
            {() => <AudienceDropdown value={value.audience} onPick={(audience) => set({ audience })} />}
          </Field>
        </div>
      )}

      <p className="rounded-lg border border-line-subtle bg-surface-subtle px-3.5 py-3 text-sm text-ink-800" aria-live="polite">
        <strong className="font-semibold text-ink-900">{when}</strong>, {who} {who.startsWith('every') ? 'enters' : 'enter'}.
        {byAttribute ? ' Customers without that date on their record never do.' : ' Re-entry (step 2) decides whether they go through again next time.'}
      </p>
    </div>
  )
}

export function AttributeField({ value, onPick, label = 'Date' }: { value: string; onPick: (attribute: string) => void; label?: string }) {
  const attributes = useQuery({
    queryKey: ['journeys', 'date-attributes'],
    queryFn: ({ signal }) => api.get<JourneyDateAttribute[]>('/journeys/date-attributes/', undefined, signal),
    staleTime: 5 * 60_000,
  })
  const rows = attributes.data ?? []
  const chosen = rows.find((row) => row.key === value)
  const hint = attributes.isError ? 'The dates on customer records could not be loaded.'
    : attributes.isSuccess && rows.length === 0 ? 'No customer record holds a date yet: C360 sends them as custom attributes.'
    : chosen ? `${formatNumber(chosen.customers)} customer${chosen.customers === 1 ? ' has' : 's have'} it today.` : undefined
  return (
    <Field label={label} required strong hint={hint}>
      {(ids) => (
        <Select {...ids} value={value} disabled={attributes.isPending} onChange={(event) => onPick(event.target.value)}>
          <option value="">{attributes.isPending ? 'Loading…' : 'Select a Date'}</option>
          {value && !chosen && attributes.isSuccess && <option value={value}>{value}</option>}
          {rows.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
        </Select>
      )}
    </Field>
  )
}

/** Who enters: the workspace's customer lists and segments, in one grouped list. */
function AudienceDropdown({ value, optional = false, onPick }: { value: AudienceRef | null; optional?: boolean; onPick: (audience: AudienceRef | null) => void }) {
  const dropdown = useSingleDropdown<'audience'>()
  const open = dropdown.isOpen('audience')
  const lists = useQuery({
    queryKey: ['contact-lists', 'journey-setup-options'],
    queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { page_size: 200 }, signal),
    enabled: open,
  })
  const segments = useQuery({
    queryKey: ['audiences', 'options'],
    queryFn: ({ signal }) => api.get<Audience[]>('/contact-lists/audiences/', undefined, signal),
    enabled: open,
  })
  const placeholder = optional ? 'Every Customer With This Date' : 'Select a List or Segment'
  const label = value ? `${value.name ?? (value.kind === 'LIST' ? 'Unknown list' : 'Unknown segment')} · ${value.kind === 'LIST' ? 'list' : 'segment'}` : null
  const pick = (next: AudienceRef | null) => { onPick(next); dropdown.close() }
  const groups: [string, AudienceRef[], boolean, boolean][] = [
    ['Customer Lists', (lists.data?.results ?? []).map((row) => ({ kind: 'LIST' as const, id: row.id, name: row.name })), lists.isPending, lists.isError],
    ['Segments', (segments.data ?? []).map((row) => ({ kind: 'SEGMENT' as const, id: row.id, name: row.name })), segments.isPending, segments.isError],
  ]
  return (
    <div className="relative">
      <button type="button" {...dropdown.triggerProps('audience')} className={`${controlClass()} flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${label ? 'text-ink-900' : 'text-ink-300'}`}>{label ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 text-ink-800 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover {...dropdown.panelProps('audience')} label={placeholder} placement="bottom-start" width={320}>
          <div className="max-h-72 overflow-y-auto py-1">
            {optional && <Option label="Every Customer With This Date" selected={value === null} onPick={() => pick(null)} />}
            {groups.map(([title, rows, pending, failed]) => (
              <div key={title}>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">{title}</p>
                {pending && <p className="flex items-center gap-2 px-3 py-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>}
                {failed && <p className="px-3 py-2 text-sm text-danger-text">Couldn’t load {title.toLowerCase()}.</p>}
                {!pending && !failed && rows.length === 0 && <p className="px-3 py-2 text-sm text-ink-800">None yet.</p>}
                {rows.map((row) => <Option key={row.id} label={row.name ?? row.id} selected={value?.kind === row.kind && value.id === row.id} onPick={() => pick(row)} />)}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

function Option({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" data-dropdown-item onClick={onPick}
      className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors duration-fast ease-standard ${selected ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-subtle'}`}>
      {label}
    </button>
  )
}
