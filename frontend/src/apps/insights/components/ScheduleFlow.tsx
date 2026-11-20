/**
 * New Schedule and Edit Schedule on Insights → Scheduled (docs/mockups/insights-admin-pages.html), in the shared create frame:
 * 1 What to Send, a report or a dashboard; 2 When and to Whom, the schedule's fields with a sentence that sums them up.
 * Edit opens on step 2, filled in; Change on the picked line goes back to step 1.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { SetupDialog } from '@/components/SetupDialog'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { keys, schedulesApi } from '../api'
import type { Schedule } from '../types'
import { ItemPicker, PickedLine, type PickedItem } from './ItemPicker'
import { ScheduleFields } from './ScheduleFields'
import { draftOf, formatFits, scheduleBody, scheduleSentence } from './scheduleDraft'

const STEPS = ['What to Send', 'When and to Whom']

export function ScheduleFlow({ existing, zone, onClose }: { existing?: Schedule; zone: string; onClose: () => void }) {
  const client = useQueryClient()
  const toast = useToast()
  const [step, setStep] = useState(existing ? 2 : 1)
  const [item, setItem] = useState<PickedItem | null>(existing ? { kind: existing.kind, id: existing.item_id, name: existing.item_name ?? 'A deleted report' } : null)
  const [draft, setDraft] = useState(() => draftOf(existing ?? null, existing?.kind ?? 'report'))
  const pick = (next: PickedItem) => {
    setItem(next)
    if (!formatFits(next.kind, draft.format)) setDraft((now) => ({ ...now, format: 'pdf' }))
  }
  const save = useMutation({
    mutationFn: () => {
      const body = scheduleBody(draft, (item as PickedItem).kind, (item as PickedItem).id)
      return existing ? schedulesApi.update(existing.id, { ...body, row_version: existing.row_version }) : schedulesApi.create(body)
    },
    onSuccess: (saved) => { client.invalidateQueries({ queryKey: keys.schedules }); toast.success(existing ? 'Schedule saved' : 'Scheduled', `${item?.name}: ${saved.words.toLowerCase()}.`); onClose() },
    onError: (error) => toast.failure(error, existing ? 'The schedule was not saved' : 'The schedule was not made'),
  })
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  const primary = step === 1
    ? { label: 'Next', disabled: !item, onClick: () => setStep(2) }
    : { label: existing ? 'Save Changes' : 'Create Schedule', busy: save.isPending, busyLabel: 'Saving', onClick: () => save.mutate() }
  return (
    <SetupDialog title={existing ? 'Edit Schedule' : 'New Schedule'} steps={STEPS} step={step} onClose={onClose} onBack={step === 2 ? () => setStep(1) : undefined} primary={primary} locked={save.isPending}>
      {step === 1 || !item ? <ItemPicker value={item} onChange={pick} /> : (
        <div className="flex flex-col gap-4">
          <PickedLine item={item} onChange={() => setStep(1)} />
          <ScheduleFields draft={draft} onChange={setDraft} kind={item.kind} name={item.name} zone={zone} errors={errors} />
          <p role="status" className="rounded-md border border-line-subtle bg-surface-subtle px-3 py-2.5 text-sm text-ink-900">{scheduleSentence(draft, item.name)}</p>
        </div>
      )}
    </SetupDialog>
  )
}
