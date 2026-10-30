/**
 * The fields of an alert (which value, its condition and threshold, how often it is checked, a name, who is emailed), shared
 * by Alerts on a report's page and by New Alert and Edit Alert on Insights → Scheduled. The draft is held by whoever shows them.
 */
import { Field, Select, TextInput } from '@/components/Form'
import type { AlertOp, ResultColumn } from '../types'
import { ALERT_OPS, type AlertDraft } from './alertDraft'

export function AlertFields({ draft, onChange, measures, builder }: {
  draft: AlertDraft
  onChange: (next: AlertDraft) => void
  /** the report's totalled values */
  measures: ResultColumn[]
  /** may email anyone; else an alert goes to its maker only */
  builder: boolean
}) {
  const set = (patch: Partial<AlertDraft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="When">{(ids) => <Select id={ids.id} value={draft.measure} onChange={(event) => set({ measure: event.target.value })}>{measures.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select>}</Field>
        <Field label="Condition">{(ids) => <Select id={ids.id} value={draft.op} onChange={(event) => set({ op: event.target.value as AlertOp })}>{ALERT_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
        <Field label="Threshold" hint={measures.find((m) => m.key === draft.measure)?.format === 'percent' ? 'In percent: 90 is 90%' : undefined}>
          {(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} type="number" step="any" value={draft.threshold} onChange={(event) => set({ threshold: event.target.value })} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Check">{(ids) => <Select id={ids.id} value={draft.every} onChange={(event) => set({ every: event.target.value as 'hour' | 'day' })}><option value="day">Every Day</option><option value="hour">Every Hour</option></Select>}</Field>
        {draft.every === 'day' && <Field label="At">{(ids) => <TextInput id={ids.id} type="time" value={draft.at} onChange={(event) => set({ at: event.target.value })} />}</Field>}
        <Field label="Name" hint="Optional">{(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={draft.name} maxLength={120} onChange={(event) => set({ name: event.target.value })} />}</Field>
      </div>
      <Field label="Email To" hint={builder ? 'One or more addresses' : 'An alert goes to you only'}>
        {(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={draft.recipients} readOnly={!builder} onChange={(event) => set({ recipients: event.target.value })} />}
      </Field>
    </div>
  )
}
