/**
 * Schedule, from a report's or a dashboard's viewer: every day, every weekday, weekly on a day or monthly on a day, at a
 * time in the workspace's zone, as Excel, CSV or PDF (a dashboard as PDF), to a list of addresses, with a subject and a
 * note. One screen; Send a Test Now on a saved schedule sends it to the person at once. The fields are ScheduleFields,
 * shared with New Schedule on Insights → Scheduled.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { keys, schedulesApi } from '../api'
import type { Schedule } from '../types'
import { ScheduleFields } from './ScheduleFields'
import { draftOf, scheduleBody, type ScheduleKind } from './scheduleDraft'

export function ScheduleDialog({ reportId, reportName, zone, existing, onClose, onSaved, kind = 'report' }: { reportId: string; reportName: string; zone: string; existing: Schedule | null; onClose: () => void; onSaved: (schedule: Schedule) => void; kind?: ScheduleKind }) {
  const client = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState(() => draftOf(existing, kind))
  const save = useMutation({
    mutationFn: () => (existing ? schedulesApi.update(existing.id, { ...scheduleBody(draft, kind, reportId), row_version: existing.row_version }) : schedulesApi.create(scheduleBody(draft, kind, reportId))),
    onSuccess: (saved) => { client.invalidateQueries({ queryKey: keys.schedules }); toast.success(existing ? 'Schedule saved' : 'Scheduled', `${reportName}: ${saved.words.toLowerCase()}.`); onSaved(saved) },
    onError: (error) => toast.failure(error, existing ? 'The schedule was not saved' : 'The report was not scheduled'),
  })
  const test = useMutation({
    mutationFn: () => schedulesApi.test((existing as Schedule).id),
    onSuccess: (result) => toast.success('Test sent', `The email went to you, with ${result.rows ?? 0} rows.`),
    onError: (error) => toast.failure(error, 'The test did not go'),
  })
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  return (
    <Modal title={existing ? 'Change Schedule' : 'Schedule'} subtitle={`${reportName} · sent as it is saved, with the rights of whoever schedules it`} onClose={onClose} size="picker" scrollBody
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          {existing && <button type="button" className={buttonSecondary} onClick={() => test.mutate()} disabled={test.isPending}>Send a Test Now</button>}
          <button type="button" className={buttonPrimary} onClick={() => save.mutate()} disabled={save.isPending}>{existing ? 'Save' : 'Schedule'}</button>
        </div>
      )}>
      <ScheduleFields draft={draft} onChange={setDraft} kind={kind} name={reportName} zone={zone} errors={errors} />
    </Modal>
  )
}
