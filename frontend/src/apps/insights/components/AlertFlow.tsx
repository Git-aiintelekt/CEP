/**
 * New Alert and Edit Alert on Insights → Scheduled (docs/mockups/insights-admin-pages.html), in the shared create frame:
 * 1 Pick a Report; 2 the alert's fields over that report's totalled values (read from a run of it, as its own Alerts does).
 * Edit opens on step 2, filled in.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { SetupDialog } from '@/components/SetupDialog'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { alertsApi, useRun } from '../api'
import type { ReportAlert } from '../types'
import { AlertFields } from './AlertFields'
import { alertBody, alertDraftOf, alertReady, type AlertDraft } from './alertDraft'
import { ItemPicker, PickedLine, type PickedItem } from './ItemPicker'

const STEPS = ['Pick a Report', 'The Alert']

function AlertStep({ item, draft, onChange, builder }: { item: PickedItem; draft: AlertDraft; onChange: (next: AlertDraft) => void; builder: boolean }) {
  const run = useRun(item.id, { limit: 1 })
  const measures = (run.data?.columns ?? []).filter((c) => c.aggregate && !c.compare && !c.linked)
  const first = measures[0]?.key
  const known = measures.some((m) => m.key === draft.measure)
  // the first value is chosen until another is: the draft hears of it, so Set Alert can be pressed
  useEffect(() => { if (first && !known) onChange({ ...draft, measure: first }) }, [first, known, draft, onChange])
  if (run.isPending) return <Spinner label="Reading the report's values" />
  if (run.isError) return <ErrorState error={run.error} onRetry={() => run.refetch()} />
  if (measures.length === 0) return <p className="text-sm text-ink-800">{item.name} has no totalled value to watch. Add one in its editor (Show), then set the alert.</p>
  return <AlertFields draft={draft} onChange={onChange} measures={measures} builder={builder} />
}

export function AlertFlow({ existing, onClose }: { existing?: ReportAlert; onClose: () => void }) {
  const client = useQueryClient()
  const toast = useToast()
  const { me, can } = useAuth()
  const builder = can('report.edit') || can('report.admin')
  const [step, setStep] = useState(existing ? 2 : 1)
  const [item, setItem] = useState<PickedItem | null>(existing ? { kind: 'report', id: existing.report_id, name: existing.report_name ?? 'A deleted report' } : null)
  const [draft, setDraft] = useState(() => alertDraftOf(existing ?? null, '', me?.principal.email ?? ''))
  const save = useMutation({
    mutationFn: () => (existing ? alertsApi.update(existing.id, { ...alertBody(draft, (item as PickedItem).id), row_version: existing.row_version }) : alertsApi.create(alertBody(draft, (item as PickedItem).id))),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['insights', 'alerts'] }); toast.success(existing ? 'Alert saved' : 'Alert set', 'It is checked on its schedule; Check Now reads it at once.'); onClose() },
    onError: (error) => toast.failure(error, existing ? 'The alert was not saved' : 'The alert was not set'),
  })
  const primary = step === 1
    ? { label: 'Next', disabled: !item, onClick: () => setStep(2) }
    : { label: existing ? 'Save Changes' : 'Set Alert', disabled: !alertReady(draft), busy: save.isPending, busyLabel: 'Saving', onClick: () => save.mutate() }
  return (
    <SetupDialog title={existing ? 'Edit Alert' : 'New Alert'} steps={STEPS} step={step} onClose={onClose} onBack={step === 2 ? () => setStep(1) : undefined} primary={primary} locked={save.isPending}>
      {step === 1 || !item ? <ItemPicker value={item} onChange={(next) => { setItem(next); setDraft((now) => ({ ...now, measure: '' })) }} dashboards={false} /> : (
        <div className="flex flex-col gap-4">
          <PickedLine item={item} onChange={existing ? undefined : () => setStep(1)} />
          <AlertStep item={item} draft={draft} onChange={setDraft} builder={builder} />
        </div>
      )}
    </SetupDialog>
  )
}
