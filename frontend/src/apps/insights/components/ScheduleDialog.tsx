/**
 * Schedule, from a report's or a dashboard's viewer: every day, every weekday, weekly on a day or monthly on a day, at a
 * time in the workspace's zone, as Excel, CSV or PDF (a dashboard as PDF), to a list of addresses, with a subject and a
 * note. One screen; Send a Test Now on a saved schedule sends it to the person at once.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type KeyboardEvent } from 'react'

import { buttonPrimary, buttonSecondary, Field, Select, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SegmentedControl } from '@/components/SegmentedControl'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { keys, schedulesApi } from '../api'
import type { Schedule, ScheduleBody, ScheduleEvery, ScheduleFormat } from '../types'

const EVERY: { value: ScheduleEvery; label: string }[] = [{ value: 'day', label: 'Day' }, { value: 'weekday', label: 'Weekday' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FORMATS: { value: ScheduleFormat; label: string; hint: string }[] = [
  { value: 'xlsx', label: 'Excel', hint: 'The view with its totals, the rows after' }, { value: 'csv', label: 'CSV', hint: 'The rows only' }, { value: 'pdf', label: 'PDF', hint: 'The view, on A4' },
]

export function ScheduleDialog({ reportId, reportName, zone, existing, onClose, onSaved, kind = 'report' }: { reportId: string; reportName: string; zone: string; existing: Schedule | null; onClose: () => void; onSaved: (schedule: Schedule) => void; kind?: 'report' | 'dashboard' }) {
  const client = useQueryClient()
  const toast = useToast()
  const [every, setEvery] = useState<ScheduleEvery>(existing?.every ?? 'week')
  const [onDay, setOnDay] = useState<number>(existing?.on_day ?? 1)
  const [at, setAt] = useState(existing?.at_time ?? '08:00')
  const [format, setFormat] = useState<ScheduleFormat>(existing?.format ?? (kind === 'dashboard' ? 'pdf' : 'xlsx'))
  const [recipients, setRecipients] = useState<string[]>(existing?.recipients ?? [])
  const [typed, setTyped] = useState('')
  const [subject, setSubject] = useState(existing?.subject ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const body = (): ScheduleBody => ({ kind, item_id: reportId, every, on_day: every === 'week' || every === 'month' ? onDay : null, at_time: at, format, recipients: addAll(), subject: subject.trim() || null, note: note.trim() || null })
  const addAll = () => { const more = typed.split(/[,\s;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean); return Array.from(new Set([...recipients, ...more])) }
  const save = useMutation({
    mutationFn: () => (existing ? schedulesApi.update(existing.id, { ...body(), row_version: existing.row_version }) : schedulesApi.create(body())),
    onSuccess: (saved) => { client.invalidateQueries({ queryKey: keys.schedules }); toast.success(existing ? 'Schedule saved' : 'Scheduled', `${reportName}: ${saved.words.toLowerCase()}.`); onSaved(saved) },
    onError: (error) => toast.failure(error, existing ? 'The schedule was not saved' : 'The report was not scheduled'),
  })
  const test = useMutation({
    mutationFn: () => schedulesApi.test((existing as Schedule).id),
    onSuccess: (result) => toast.success('Test sent', `The email went to you, with ${result.rows ?? 0} rows.`),
    onError: (error) => toast.failure(error, 'The test did not go'),
  })
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      event.preventDefault()
      const next = addAll()
      setRecipients(next)
      setTyped('')
    } else if (event.key === 'Backspace' && !typed && recipients.length) {
      setRecipients(recipients.slice(0, -1))
    }
  }
  return (
    <Modal title={existing ? 'Change Schedule' : 'Schedule'} subtitle={`${reportName} · sent as it is saved, with the rights of whoever schedules it`} onClose={onClose} size="picker" scrollBody
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          {existing && <button type="button" className={buttonSecondary} onClick={() => test.mutate()} disabled={test.isPending}>Send a Test Now</button>}
          <button type="button" className={buttonPrimary} onClick={() => save.mutate()} disabled={save.isPending}>{existing ? 'Save' : 'Schedule'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-900">Every</span>
          <SegmentedControl label="Every" options={EVERY} value={every} onChange={setEvery} />
          {errors.every && <span className="text-xs text-danger-text">{errors.every}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(every === 'week' || every === 'month') && (
            <Field label="On" error={errors.on_day}>
              {({ id, describedBy, invalid }) => (
                <Select id={id} describedBy={describedBy} invalid={invalid} value={String(onDay)} onChange={(event) => setOnDay(Number(event.target.value))}>
                  {every === 'week' ? WEEKDAYS.map((day, i) => <option key={day} value={i + 1}>{day}</option>) : Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>The {ordinal(i + 1)}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="At" hint={zone} error={errors.at_time}>
            {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} type="time" value={at} onChange={(event) => setAt(event.target.value)} />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-semibold text-ink-900">Send as</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {FORMATS.map((item) => {
              const off = kind === 'dashboard' && item.value !== 'pdf'
              return (
                <label key={item.value} className={`flex flex-col gap-0.5 rounded-md border p-3 ${off ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${format === item.value ? 'border-brand-600 bg-brand-100/40' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                  <input type="radio" name="format" value={item.value} checked={format === item.value} disabled={off} onChange={() => setFormat(item.value)} className="sr-only" />
                  <span className="text-sm font-semibold">{item.label}</span><span className="text-xs text-ink-800">{off ? 'A dashboard goes as PDF' : item.value === 'pdf' && kind === 'dashboard' ? 'The tiles on the saved period' : item.hint}</span>
                </label>
              )
            })}
          </div>
          {errors.format && <span className="text-xs text-danger-text">{errors.format}</span>}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="schedule-to" className="text-sm font-semibold text-ink-900">To</label>
          <div className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-control-md border bg-surface px-2 py-1.5 ${errors.recipients ? 'border-danger-text' : 'border-line-control'}`}>
            {recipients.map((address) => (
              <span key={address} className="inline-flex h-6 items-center gap-1 rounded-sm bg-fill-subtle px-2 text-xs font-semibold text-ink-900">
                {address}<button type="button" aria-label={`Remove ${address}`} onClick={() => setRecipients(recipients.filter((a) => a !== address))} className="text-ink-700 hover:text-ink-900">×</button>
              </span>
            ))}
            <input id="schedule-to" value={typed} onChange={(event) => setTyped(event.target.value)} onKeyDown={onKey} onBlur={() => { if (typed.trim()) { setRecipients(addAll()); setTyped('') } }}
              placeholder={recipients.length ? 'Add an address' : 'name@example.com, another@example.com'} className="h-6 min-w-40 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-700 focus:outline-none" />
          </div>
          {errors.recipients ? <span className="text-xs text-danger-text">{errors.recipients}</span> : <span className="text-xs text-ink-700">Enter, a comma or a space adds an address.</span>}
        </div>
        <Field label="Subject" hint={`Empty: “${reportName} · {date}”. {date} is the sending date.`} error={errors.subject}>
          {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} placeholder={`${reportName} · {date}`} />}
        </Field>
        <Field label="Note" hint="Optional, at the top of the email" error={errors.note}>
          {({ id, describedBy, invalid }) => <TextArea id={id} describedBy={describedBy} invalid={invalid} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} />}
        </Field>
      </div>
    </Modal>
  )
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}
