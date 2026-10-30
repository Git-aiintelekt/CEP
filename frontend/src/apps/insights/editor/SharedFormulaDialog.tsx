/**
 * Add a Formula and Edit (docs/mockups/insights-admin-pages.html), in the shared create frame and two steps: 1 About the
 * Formula (the dataset, its name, a measure or a field, a description), 2 The Formula, at full width, checked as you type
 * against the dataset's fields and the shared formulas before it, with how it shows. Edit and Share open on step 2. Opened from
 * Insights → Shared Formulas, and from a report's Custom Fields to share one of its own formulas with every report on the
 * dataset.
 */
import { useMutation } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { Field, Select, TextInput } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { SetupDialog } from '@/components/SetupDialog'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { sharedFormulasApi } from '../api'
import type { CatalogDataset, CustomField, SharedFormula, SharedFormulaBody } from '../types'
import { FormulaEditor } from './FormulaEditor'
import { SHARED_KIND_LABEL as KIND_LABEL } from './formulaHelp'

const STEPS = ['About the Formula', 'The Formula']
const KIND_HINT: Record<'formula' | 'measure', string> = { measure: 'Adds up the rows of each group, like a rate', formula: 'Worked out on each row, like a month or a band' }

/** the dataset as a shared formula is written against: its own fields and the shared formulas before this one */
function fieldsBefore(dataset: CatalogDataset, id?: string): CatalogDataset {
  const at = id ? dataset.fields.findIndex((f) => f.shared?.id === id) : -1
  return { ...dataset, fields: dataset.fields.filter((f, i) => !f.shared || at < 0 || i < at) }
}

export function SharedFormulaDialog({ dataset: first, datasets, formula, start, onClose, onSaved }: {
  /** the dataset it is on, or the one picked first */
  dataset: CatalogDataset
  /** to choose from on step 1 (Insights → Shared Formulas); without them the dataset is fixed */
  datasets?: CatalogDataset[]
  formula?: SharedFormula
  /** a report's own formula, to share (Custom Fields → Share With Every Report) */
  start?: Partial<SharedFormulaBody>
  onClose: () => void; onSaved: (saved: SharedFormula) => void }) {
  const toast = useToast()
  // editing, or sharing a report's own formula (its name and formula already there), starts on the formula
  const [step, setStep] = useState(formula || start?.expression ? 2 : 1)
  const [datasetKey, setDatasetKey] = useState(first.key)
  const dataset = datasets?.find((d) => d.key === datasetKey) ?? first
  const [draft, setDraft] = useState({ label: formula?.label ?? start?.label ?? '', kind: (formula?.kind ?? start?.kind ?? 'measure') as 'formula' | 'measure', description: formula?.description ?? start?.description ?? '',
    expression: formula?.expression ?? start?.expression ?? '', role: (formula?.role ?? start?.role ?? '') as '' | 'dimension' | 'measure', format: formula?.format ?? start?.format ?? '' })
  const [checked, setChecked] = useState<CustomField | null>(null)
  const against = useMemo(() => fieldsBefore(dataset, formula?.id), [dataset, formula?.id])
  const checkWith = useMemo(() => ({ key: `shared:${dataset.key}:${formula?.id ?? 'new'}`, check: (field: Partial<CustomField>) => sharedFormulasApi.check(dataset.key, { ...(formula ? { id: formula.id } : {}), field: { ...field, key: undefined } }) }), [dataset.key, formula])
  const set = useCallback((patch: Partial<typeof draft>) => setDraft((now) => ({ ...now, ...patch })), [])
  const body = (confirm?: boolean): SharedFormulaBody => ({ label: draft.label.trim(), expression: draft.expression, description: draft.description.trim() || null,
    ...(draft.role ? { role: draft.role } : {}), format: draft.format, ...(formula ? { row_version: formula.row_version } : { kind: draft.kind }), ...(confirm ? { confirm } : {}) })
  const save = useMutation({
    mutationFn: (confirm?: boolean) => (formula ? sharedFormulasApi.update(dataset.key, formula.id, body(confirm)) : sharedFormulasApi.create(dataset.key, body())),
    onSuccess: (saved) => { toast.success(formula ? 'Formula saved' : 'Formula added', `${saved.label} is on ${dataset.label} for every report.`); onSaved(saved) },
    onError: (error) => {
      if (formula && error instanceof ApiError && error.status === 409 && /confirm/i.test(error.message) && window.confirm(`${error.message.replace(/ Send confirm to go ahead\.?$/, '')} Save anyway?`)) save.mutate(true)
      else toast.failure(error, 'The formula was not saved')
    },
  })
  const named = draft.label.trim().length > 0
  const primary = step === 1
    ? { label: 'Next', disabled: !named, onClick: () => setStep(2) }
    : { label: formula ? 'Save Formula' : 'Add Formula', disabled: !checked || !named, busy: save.isPending, busyLabel: 'Saving', onClick: () => save.mutate(undefined) }

  return (
    <SetupDialog title={formula ? `Edit ${formula.label}` : 'Add a Formula'} steps={STEPS} step={step} onClose={onClose} onBack={step === 2 ? () => setStep(1) : undefined}
      primary={primary} locked={save.isPending} wide={step === 2}>
      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dataset" required hint={formula ? 'A formula stays on its dataset' : datasets ? 'Every report on it can use the formula' : undefined}>{({ id, describedBy }) => (
              <Select id={id} describedBy={describedBy} value={dataset.key} disabled={Boolean(formula) || !datasets} onChange={(e) => { setDatasetKey(e.target.value); setChecked(null) }}>
                {(datasets ?? [first]).map((d) => <option key={d.key} value={d.key}>{d.label}{d.component?.name ? ` · ${d.component.name}` : ''}</option>)}
              </Select>
            )}</Field>
            <Field label="Kind" hint={KIND_HINT[draft.kind]}>{({ id, describedBy }) => (
              <Select id={id} describedBy={describedBy} value={draft.kind} disabled={Boolean(formula)} onChange={(e) => set({ kind: e.target.value as 'formula' | 'measure' })}>
                {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            )}</Field>
          </div>
          <Field label="Name" required>{({ id }) => <TextInput id={id} value={draft.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} placeholder="Refund Rate" autoFocus />}</Field>
          <Field label="Description" hint="What it means, so people pick the right one.">{({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} value={draft.description} maxLength={300} onChange={(e) => set({ description: e.target.value })} placeholder="Refunds as a share of order value" />}</Field>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-900">{draft.label || 'A new formula'}</span><span className="block text-xs text-ink-800">{KIND_LABEL[draft.kind]} on {dataset.label}</span></span>
            <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => setStep(1)}>Change</button>
          </div>
          {formula?.certified && <Notice tone="info" title="Certified">Reports trust this formula. A change applies to every report that uses it.</Notice>}
          <FormulaEditor dataset={against} kind={draft.kind} label={draft.label} expression={draft.expression} role={draft.role} format={draft.format} before={[]} onChange={set} onChecked={setChecked} checkWith={checkWith} />
        </div>
      )}
    </SetupDialog>
  )
}
