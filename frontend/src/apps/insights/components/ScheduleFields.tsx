/**
 * The fields of a schedule (when, as what, to whom, the subject and the note), shared by Schedule on a report's or a
 * dashboard's page and by New Schedule on Insights → Scheduled. The draft is held by whoever shows them.
 */
import type { KeyboardEvent } from 'react'

import { Field, Select, TextArea, TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import type { ScheduleEvery, ScheduleFormat } from '../types'
import { allRecipients, formatFits, ordinal, WEEKDAYS, type ScheduleDraft, type ScheduleKind } from './scheduleDraft'

const EVERY: { value: ScheduleEvery; label: string }[] = [{ value: 'day', label: 'Day' }, { value: 'weekday', label: 'Weekday' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]
const FORMATS: { value: ScheduleFormat; label: string; hint: string }[] = [
  { value: 'xlsx', label: 'Excel', hint: 'The view with its totals, the rows after' }, { value: 'csv', label: 'CSV', hint: 'The rows only' }, { value: 'pdf', label: 'PDF', hint: 'The view, on A4' },
  { value: 'pptx', label: 'PowerPoint', hint: 'A slide of the view, then the rows' },
]

export function ScheduleFields({ draft, onChange, kind, name, zone, errors = {} }: {
  draft: ScheduleDraft
  onChange: (next: ScheduleDraft) => void
  kind: ScheduleKind
  /** the report's or dashboard's name, for the subject's default */
  name: string
  zone: string
  errors?: Record<string, string>
}) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch })
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      event.preventDefault()
      set({ recipients: allRecipients(draft), typed: '' })
    } else if (event.key === 'Backspace' && !draft.typed && draft.recipients.length) {
      set({ recipients: draft.recipients.slice(0, -1) })
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-900">Every</span>
        <SegmentedControl label="Every" options={EVERY} value={draft.every} onChange={(every) => set({ every })} />
        {errors.every && <span className="text-xs text-danger-text">{errors.every}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(draft.every === 'week' || draft.every === 'month') && (
          <Field label="On" error={errors.on_day}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} describedBy={describedBy} invalid={invalid} value={String(draft.onDay)} onChange={(event) => set({ onDay: Number(event.target.value) })}>
                {draft.every === 'week' ? WEEKDAYS.map((day, i) => <option key={day} value={i + 1}>{day}</option>) : Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>The {ordinal(i + 1)}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="At" hint={zone} error={errors.at_time}>
          {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} type="time" value={draft.at} onChange={(event) => set({ at: event.target.value })} />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-semibold text-ink-900">Send as</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FORMATS.map((item) => {
            const off = !formatFits(kind, item.value)
            return (
              <label key={item.value} className={`flex flex-col gap-0.5 rounded-md border p-3 ${off ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${draft.format === item.value ? 'border-brand-600 bg-brand-100/40' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                <input type="radio" name="format" value={item.value} checked={draft.format === item.value} disabled={off} onChange={() => set({ format: item.value })} className="sr-only" />
                <span className="text-sm font-semibold">{item.label}</span><span className="text-xs text-ink-800">{off ? 'A dashboard goes as PDF or PowerPoint' : kind === 'dashboard' ? (item.value === 'pdf' ? 'The tiles on the saved period' : 'A slide per tile') : item.hint}</span>
              </label>
            )
          })}
        </div>
        {errors.format && <span className="text-xs text-danger-text">{errors.format}</span>}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="schedule-to" className="text-sm font-semibold text-ink-900">To</label>
        <div className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-control-md border bg-surface px-2 py-1.5 ${errors.recipients ? 'border-danger-text' : 'border-line-control'}`}>
          {draft.recipients.map((address) => (
            <span key={address} className="inline-flex h-6 items-center gap-1 rounded-sm bg-fill-subtle px-2 text-xs font-semibold text-ink-900">
              {address}<button type="button" aria-label={`Remove ${address}`} onClick={() => set({ recipients: draft.recipients.filter((a) => a !== address) })} className="text-ink-700 hover:text-ink-900">×</button>
            </span>
          ))}
          <input id="schedule-to" value={draft.typed} onChange={(event) => set({ typed: event.target.value })} onKeyDown={onKey} onBlur={() => { if (draft.typed.trim()) set({ recipients: allRecipients(draft), typed: '' }) }}
            placeholder={draft.recipients.length ? 'Add an address' : 'name@example.com, another@example.com'} className="h-6 min-w-40 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-700 focus:outline-none" />
        </div>
        {errors.recipients ? <span className="text-xs text-danger-text">{errors.recipients}</span> : <span className="text-xs text-ink-700">Enter, a comma or a space adds an address.</span>}
      </div>
      <Field label="Subject" hint={`Empty: “${name} · {date}”. {date} is the sending date.`} error={errors.subject}>
        {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={draft.subject} onChange={(event) => set({ subject: event.target.value })} maxLength={200} placeholder={`${name} · {date}`} />}
      </Field>
      <Field label="Note" hint="Optional, at the top of the email" error={errors.note}>
        {({ id, describedBy, invalid }) => <TextArea id={id} describedBy={describedBy} invalid={invalid} value={draft.note} onChange={(event) => set({ note: event.target.value })} maxLength={2000} rows={3} />}
      </Field>
    </div>
  )
}
