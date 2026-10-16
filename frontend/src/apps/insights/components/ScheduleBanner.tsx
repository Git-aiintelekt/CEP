/** The line under a report's or a dashboard's title once it is scheduled: what, when, to how many, the last sending and the next; Change, and Pause or Resume. */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { keys, schedulesApi } from '../api'
import type { Schedule } from '../types'

const FORMAT: Record<Schedule['format'], string> = { xlsx: 'Excel', csv: 'CSV', pdf: 'PDF' }

export function ScheduleBanner({ schedule, onChange }: { schedule: Schedule; onChange: () => void }) {
  const client = useQueryClient()
  const toast = useToast()
  const state = useMutation({
    mutationFn: (action: 'pause' | 'resume') => schedulesApi.state(schedule.id, action),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.schedules }),
    onError: (error) => toast.failure(error, 'The schedule was not changed'),
  })
  return (
    <div role="status" aria-label="Schedule" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">
      <Tag tone={schedule.status === 'ACTIVE' ? 'success' : 'warning'}>{schedule.status === 'ACTIVE' ? 'Scheduled' : 'Paused'}</Tag>
      <span>{schedule.words} to {schedule.recipients.length} {schedule.recipients.length === 1 ? 'person' : 'people'} as {FORMAT[schedule.format]}
        {schedule.last_sent_at ? ` · last ${schedule.last_outcome === 'OK' ? 'sent' : 'failed'} ${formatDateTime(schedule.last_sent_at)}` : ''}{schedule.status === 'ACTIVE' && schedule.next_run_at ? ` · next ${formatDateTime(schedule.next_run_at)}` : ''}</span>
      <span className="ml-auto flex gap-3 text-xs font-semibold text-brand-800">
        <button type="button" className="hover:underline" onClick={onChange}>Change</button>
        <button type="button" className="hover:underline" disabled={state.isPending} onClick={() => state.mutate(schedule.status === 'ACTIVE' ? 'pause' : 'resume')}>{schedule.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
      </span>
    </div>
  )
}
