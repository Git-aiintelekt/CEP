/**
 * Custom Fields: a report's own dimensions computed from a row. Groups name sets of values (North = Downtown, Riverside);
 * bands cut a number at edges (Under 100, 100 to under 1,000, 1,000 and over); if-then labels give the first matching
 * condition's label (Amount at least 500 is Gold), else a label for the rest. A formula works out one value for each row in the
 * formula language ([Revenue] - [Cost]); a measure formula adds up the rows of each group (SUM([Sent], [Channel] = "EMAIL")).
 * Each one is then a field like any other.
 */
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import { FormulaEditor } from './FormulaEditor'

import { IconButton } from '@/components/Button'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import type { CatalogDataset, CustomField, ReportDefinition } from '../types'
import { removeCustom, setCustom } from './definition'

type Draft = { kind: CustomField['kind']; label: string; field: string; other: string; groups: { label: string; values: string }[]; edges: string; rules: { field: string; op: string; value: string; label: string }[];
  expression: string; role: '' | 'dimension' | 'measure'; format: string }
const OPS: Record<string, string> = { '=': 'is', '!=': 'is not', '>': 'more than', '>=': 'at least', '<': 'less than', '<=': 'at most' }
const KIND_LABEL: Record<CustomField['kind'], string> = { group: 'Groups', band: 'Number Bands', rule: 'If-Then Labels', formula: 'Formula (Each Row)', measure: 'Measure Formula' }
const formulaKind = (kind: CustomField['kind']): kind is 'formula' | 'measure' => kind === 'formula' || kind === 'measure'

function blank(): Draft {
  return { kind: 'group', label: '', field: '', other: 'Other', groups: [{ label: '', values: '' }], edges: '', rules: [{ field: '', op: '=', value: '', label: '' }], expression: '', role: '', format: '' }
}

function fromSpec(spec: CustomField): Draft {
  return { ...blank(), kind: spec.kind, label: spec.label, field: spec.field ?? '', other: spec.other ?? 'Other',
    groups: spec.groups?.map((g) => ({ label: g.label, values: g.values.map(String).join(', ') })) ?? blank().groups,
    edges: spec.edges?.join(', ') ?? '', rules: spec.rules?.map((r) => ({ field: r.field, op: r.op, value: String(r.value), label: r.label })) ?? blank().rules,
    expression: spec.expression ?? '', role: spec.role ?? '', format: spec.format ?? '' }
}

const list = (text: string) => text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean)

function toSpec(draft: Draft, key?: string): CustomField | null {
  const base = { ...(key ? { key } : {}), label: draft.label.trim(), kind: draft.kind }
  if (!base.label) return null
  if (draft.kind === 'group') {
    const groups = draft.groups.filter((g) => g.label.trim() && list(g.values).length).map((g) => ({ label: g.label.trim(), values: list(g.values) }))
    return draft.field && groups.length ? { ...base, field: draft.field, groups, other: draft.other.trim() || 'Other' } : null
  }
  if (draft.kind === 'band') {
    const edges = list(draft.edges).map(Number)
    return draft.field && edges.length && edges.every(Number.isFinite) ? { ...base, field: draft.field, edges } : null
  }
  const rules = draft.rules.filter((r) => r.field && r.label.trim() && r.value.trim()).map((r) => ({ field: r.field, op: r.op as never, value: r.value.trim(), label: r.label.trim() }))
  return rules.length ? { ...base, rules, other: draft.other.trim() || 'Other' } : null
}

export function CustomFieldsDialog({ dataset, definition, onChange, onClose, start }: { dataset: CatalogDataset; definition: ReportDefinition; onChange: (next: ReportDefinition) => void; onClose: () => void
  /** a new field to open with (the /dev/data playground) */
  start?: Partial<CustomField> }) {
  const customs = definition.derived ?? []
  const [editing, setEditing] = useState<{ key?: string; draft: Draft } | null>(start ? { draft: { ...blank(), ...fromSpec({ label: '', kind: 'group', ...start } as CustomField) } } : customs.length ? null : { draft: blank() })
  const sources = dataset.fields.filter((f) => !f.formula && !customs.some((c) => c.key === f.key) && (f.type === 'string' || f.type === 'number' || f.type === 'boolean'))
  const numbers = sources.filter((f) => f.type === 'number')
  const set = (patch: Partial<Draft>) => setEditing((now) => (now ? { ...now, draft: { ...now.draft, ...patch } } : now))
  const [checked, setChecked] = useState<CustomField | null>(null)
  const formulaDraft = editing !== null && formulaKind(editing.draft.kind)
  const spec = !editing ? null : formulaDraft ? (checked && editing.draft.label.trim() ? { ...checked, ...(editing.key ? { key: editing.key } : {}), label: editing.draft.label.trim() } : null) : toSpec(editing.draft, editing.key)
  const before = editing?.key ? customs.slice(0, Math.max(0, customs.findIndex((c) => c.key === editing.key))) : customs

  return (
    <Modal title="Custom Fields" subtitle="Fields of this report worked out from each row, and measure formulas" onClose={onClose} size={formulaDraft ? 'xl' : 'lg'}
      footer={editing ? (
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={() => (customs.length ? setEditing(null) : onClose())}>Back</button>
          <button type="button" className={buttonPrimary} disabled={!spec} onClick={() => { if (spec) { onChange(setCustom(definition, spec)); setEditing(null) } }}>{editing.key ? 'Save Field' : 'Add Field'}</button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={() => setEditing({ draft: blank() })}><Plus size={14} strokeWidth={1.5} aria-hidden />Add a Custom Field</button>
          <button type="button" className={buttonPrimary} onClick={onClose}>Done</button>
        </div>
      )}>
      {!editing ? (
        <ul aria-label="Custom fields" className="flex flex-col divide-y divide-line-subtle rounded-md border border-line">
          {customs.map((custom) => (
            <li key={custom.key} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1"><span className="font-semibold text-ink-900">{custom.label}</span><span className="ml-2 text-xs text-ink-700">{KIND_LABEL[custom.kind]}</span></span>
              <button type="button" className="text-xs font-semibold text-brand-800 hover:underline" onClick={() => setEditing({ key: custom.key, draft: fromSpec(custom) })}>Edit</button>
              <IconButton label={`Remove ${custom.label}`} icon={X} size="xs" onClick={() => onChange(removeCustom(definition, custom.key as string))} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>{({ id }) => <TextInput id={id} value={editing.draft.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} placeholder="Region" />}</Field>
            <Field label="Kind">{({ id }) => (
              <Select id={id} value={editing.draft.kind} onChange={(e) => set({ kind: e.target.value as Draft['kind'] })}>
                {(Object.keys(KIND_LABEL) as Draft['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            )}</Field>
          </div>
          {formulaDraft && (
            <FormulaEditor dataset={dataset} kind={editing.draft.kind as 'formula' | 'measure'} label={editing.draft.label} fieldKey={editing.key} expression={editing.draft.expression}
              role={editing.draft.role} format={editing.draft.format} before={before} onChange={set} onChecked={setChecked} />
          )}
          {!formulaDraft && editing.draft.kind !== 'rule' && (
            <Field label="From">{({ id }) => (
              <Select id={id} value={editing.draft.field} onChange={(e) => set({ field: e.target.value })}>
                <option value="">Choose a field</option>
                {(editing.draft.kind === 'band' ? numbers : sources.filter((f) => f.type !== 'boolean')).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Select>
            )}</Field>
          )}
          {editing.draft.kind === 'group' && (
            <div className="flex flex-col gap-2">
              {editing.draft.groups.map((group, i) => (
                <div key={i} className="flex flex-wrap items-start gap-2">
                  <span className="w-40"><TextInput aria-label={`Group ${i + 1} name`} controlSize="sm" value={group.label} placeholder="North" onChange={(e) => set({ groups: editing.draft.groups.map((g, j) => (j === i ? { ...g, label: e.target.value } : g)) })} /></span>
                  <span className="min-w-48 flex-1"><TextInput aria-label={`Group ${i + 1} values`} controlSize="sm" value={group.values} placeholder="Downtown, Riverside" onChange={(e) => set({ groups: editing.draft.groups.map((g, j) => (j === i ? { ...g, values: e.target.value } : g)) })} /></span>
                  <IconButton label={`Remove group ${i + 1}`} icon={X} size="xs" onClick={() => set({ groups: editing.draft.groups.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <button type="button" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-brand-800 hover:underline" onClick={() => set({ groups: [...editing.draft.groups, { label: '', values: '' }] })}><Plus size={12} strokeWidth={1.5} aria-hidden />Add Group</button>
            </div>
          )}
          {editing.draft.kind === 'band' && (
            <Field label="Edges" hint="The numbers where a band ends, going up: 100, 1000 gives Under 100, 100 to under 1,000, and 1,000 and over.">{({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} value={editing.draft.edges} onChange={(e) => set({ edges: e.target.value })} placeholder="100, 1000" />}</Field>
          )}
          {editing.draft.kind === 'rule' && (
            <div className="flex flex-col gap-2">
              {editing.draft.rules.map((rule, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs text-ink-800">
                  <span>{i === 0 ? 'When' : 'Else when'}</span>
                  <span className="w-36"><Select aria-label={`Condition ${i + 1} field`} controlSize="sm" value={rule.field} onChange={(e) => set({ rules: editing.draft.rules.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)) })}>
                    <option value="">Field</option>{sources.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </Select></span>
                  <span className="w-28"><Select aria-label={`Condition ${i + 1} comparison`} controlSize="sm" value={rule.op} onChange={(e) => set({ rules: editing.draft.rules.map((r, j) => (j === i ? { ...r, op: e.target.value } : r)) })}>
                    {Object.entries(OPS).filter(([op]) => sources.find((f) => f.key === rule.field)?.type === 'number' || op === '=' || op === '!=').map(([op, words]) => <option key={op} value={op}>{words}</option>)}
                  </Select></span>
                  <span className="w-28"><TextInput aria-label={`Condition ${i + 1} value`} controlSize="sm" value={rule.value} onChange={(e) => set({ rules: editing.draft.rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) })} /></span>
                  <span>then</span>
                  <span className="w-28"><TextInput aria-label={`Condition ${i + 1} label`} controlSize="sm" value={rule.label} placeholder="Gold" onChange={(e) => set({ rules: editing.draft.rules.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)) })} /></span>
                  <IconButton label={`Remove condition ${i + 1}`} icon={X} size="xs" onClick={() => set({ rules: editing.draft.rules.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <button type="button" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-brand-800 hover:underline" onClick={() => set({ rules: [...editing.draft.rules, { field: '', op: '=', value: '', label: '' }] })}><Plus size={12} strokeWidth={1.5} aria-hidden />Add Condition</button>
            </div>
          )}
          {!formulaDraft && editing.draft.kind !== 'band' && (
            <Field label="Everything else">{({ id }) => <TextInput id={id} value={editing.draft.other} onChange={(e) => set({ other: e.target.value })} maxLength={60} />}</Field>
          )}
        </div>
      )}
    </Modal>
  )
}
