/**
 * Add a Shared Formula and Edit: the name, the kind, a description, and the formula checked as you type against the dataset's
 * fields and the shared formulas before it. Opened from Insights → Shared Formulas, and from a report's Custom Fields to share
 * one of its own formulas with every report on the dataset.
 */
import { useMutation } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { sharedFormulasApi } from '../api'
import type { CatalogDataset, CustomField, SharedFormula, SharedFormulaBody } from '../types'
import { FormulaEditor } from './FormulaEditor'
import { SHARED_KIND_LABEL as KIND_LABEL } from './formulaHelp'


/** the dataset as a shared formula is written against: its own fields and the shared formulas before this one */
function fieldsBefore(dataset: CatalogDataset, id?: string): CatalogDataset {
  const at = id ? dataset.fields.findIndex((f) => f.shared?.id === id) : -1
  return { ...dataset, fields: dataset.fields.filter((f, i) => !f.shared || at < 0 || i < at) }
}

export function SharedFormulaDialog({ dataset, formula, start, onClose, onSaved }: { dataset: CatalogDataset; formula?: SharedFormula
  /** a report's own formula, to share (Custom Fields → Share With Every Report) */
  start?: Partial<SharedFormulaBody>
  onClose: () => void; onSaved: (saved: SharedFormula) => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState({ label: formula?.label ?? start?.label ?? '', kind: (formula?.kind ?? start?.kind ?? 'measure') as 'formula' | 'measure', description: formula?.description ?? start?.description ?? '',
    expression: formula?.expression ?? start?.expression ?? '', role: (formula?.role ?? start?.role ?? '') as '' | 'dimension' | 'measure', format: formula?.format ?? start?.format ?? '' })
  const [checked, setChecked] = useState<CustomField | null>(null)
  const against = useMemo(() => fieldsBefore(dataset, formula?.id), [dataset, formula?.id])
  const checkWith = useMemo(() => ({ key: `shared:${formula?.id ?? 'new'}`, check: (field: Partial<CustomField>) => sharedFormulasApi.check(dataset.key, { ...(formula ? { id: formula.id } : {}), field: { ...field, key: undefined } }) }), [dataset.key, formula])
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
  const ready = Boolean(checked) && draft.label.trim().length > 0 && !save.isPending

  return (
    <Modal title={formula ? `Edit ${formula.label}` : 'Add a Shared Formula'} subtitle={`On ${dataset.label}: every report on it can use it`} onClose={onClose} size="xl"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={!ready} onClick={() => save.mutate(undefined)}>{formula ? 'Save Formula' : 'Add Formula'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        {formula?.certified && <Notice tone="info" title="Certified">Reports trust this formula. A change applies to every report that uses it.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>{({ id }) => <TextInput id={id} value={draft.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} placeholder="Refund Rate" />}</Field>
          <Field label="Kind">{({ id }) => (
            <Select id={id} value={draft.kind} disabled={Boolean(formula)} onChange={(e) => set({ kind: e.target.value as 'formula' | 'measure' })}>
              {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          )}</Field>
        </div>
        <Field label="Description" hint="What it means, so people pick the right one.">{({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} value={draft.description} maxLength={300} onChange={(e) => set({ description: e.target.value })} placeholder="Refunds as a share of order value" />}</Field>
        <FormulaEditor dataset={against} kind={draft.kind} label={draft.label} expression={draft.expression} role={draft.role} format={draft.format} before={[]} onChange={set} onChecked={setChecked} checkWith={checkWith} />
      </div>
    </Modal>
  )
}
