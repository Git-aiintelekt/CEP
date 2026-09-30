/** The weekly report email: on or off, which day and hour in the workspace's zone, and who gets it. Needs user.admin. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Field, Select, TextArea, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { addressesOf } from '@/lib/addresses'
import { ApiError, api } from '@/lib/api'
import type { ReportSchedule } from '@/lib/types'

import { formatDay } from './period'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const KEY = ['reports', 'schedule']

export function ScheduleModal({ zone, onClose }: { zone: string; onClose: () => void }) {
  const schedule = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<ReportSchedule>('/reports/schedule/', undefined, signal) })
  return (
    <Modal title="Schedule Report" subtitle="The last 7 days by email, every week" onClose={onClose}>
      {schedule.isError ? <ErrorState title="The schedule could not be loaded" error={schedule.error} onRetry={() => void schedule.refetch()} />
        : schedule.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
        : <ScheduleForm initial={schedule.data} zone={zone} onDone={onClose} />}
    </Modal>
  )
}

function ScheduleForm({ initial, zone, onDone }: { initial: ReportSchedule; zone: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [weekday, setWeekday] = useState(initial.weekday)
  const [hour, setHour] = useState(initial.hour)
  const [recipients, setRecipients] = useState(initial.recipients.join(', '))
  const save = useMutation({
    mutationFn: () => api.put<ReportSchedule>('/reports/schedule/', { enabled, weekday, hour, recipients: addressesOf(recipients) }),
    onSuccess: (next) => {
      queryClient.setQueryData(KEY, next)
      onDone()
    },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : null

  return (
    <form noValidate className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
      <Switch checked={enabled} onChange={setEnabled} label="Send the Weekly Report" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Day" error={errors.weekday}>
          {(ids) => <Select {...ids} value={weekday} disabled={!enabled} onChange={(event) => setWeekday(Number(event.target.value))}>
            {WEEKDAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </Select>}
        </Field>
        <Field label="Time" error={errors.hour} hint={zone}>
          {(ids) => <Select {...ids} value={hour} disabled={!enabled} onChange={(event) => setHour(Number(event.target.value))}>
            {Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{`${String(value).padStart(2, '0')}:00`}</option>)}
          </Select>}
        </Field>
      </div>
      <Field label="Recipients" error={errors.recipients} hint="Email addresses, separated by commas. The weekly report also goes where Settings → Notifications sends it.">
        {(ids) => <TextArea {...ids} rows={3} value={recipients} disabled={!enabled} onChange={(event) => setRecipients(event.target.value)} placeholder="marketing-ops@example.com" />}
      </Field>
      <p className="text-helper text-ink-800">{initial.last_sent_on ? `Last sent on ${formatDay(initial.last_sent_on)}.` : 'Not sent yet.'}</p>
      {other && <ErrorState title="The schedule was not saved" error={other} />}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonSecondary} onClick={onDone}>Cancel</button>
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save Schedule</button>
      </div>
    </form>
  )
}
