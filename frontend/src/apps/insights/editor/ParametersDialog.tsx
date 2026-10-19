/**
 * Parameters: questions the report asks before it runs, up to five. Each names a field, how it is asked (one value, several,
 * a range, the last few days), whether an answer is required, and a default. A dashboard tile, a schedule or an alert runs
 * the report with the defaults; a question with no default then leaves its rule out.
 */
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/Button'
import { Checkbox } from '@/components/Checkbox'
import { buttonPrimary, buttonSecondary, Select, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import type { CatalogDataset, ParameterOperator, ReportParameter } from '../types'
import { coerceValue, fieldOf } from './definition'
import { askable, ASKED_AS, MAX_PARAMETERS, parameterKey } from './parameters'

function defaultText(parameter: ReportParameter): string {
  const value = parameter.default
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return parameter.operator === 'between' ? value.map(String).join('..') : value.map(String).join(', ')
  return String(value)
}

export function ParametersDialog({ dataset, parameters, onApply, onClose }: { dataset: CatalogDataset; parameters: ReportParameter[]; onApply: (parameters: ReportParameter[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<ReportParameter[]>(parameters)
  const usable = dataset.fields.filter((field) => !field.custom && field.role === 'dimension' && askable(field).length > 0)
  const free = usable.filter((field) => !rows.some((row) => row.field === field.key))
  const update = (index: number, patch: Partial<ReportParameter>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  function add() {
    const field = free[0]
    if (!field) return
    setRows([...rows, { key: parameterKey(field.label, rows.map((row) => row.key)), label: field.label, field: field.key, operator: askable(field)[0], required: false }])
  }

  function changeField(index: number, key: string) {
    const field = fieldOf(dataset, key)
    if (!field) return
    const others = rows.filter((_, i) => i !== index).map((row) => row.key)
    update(index, { field: key, label: field.label, key: parameterKey(field.label, others), operator: askable(field)[0], default: undefined })
  }

  return (
    <Modal title="Parameters" subtitle="Questions the report asks before it runs" onClose={onClose} size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} onClick={() => onApply(rows.map((row) => ({ ...row, label: row.label.trim() || (fieldOf(dataset, row.field)?.label ?? row.field) })))}>Apply</button>
        </div>
      )}>
      <p className="mb-3 text-sm text-ink-800">Each answer filters the report. People opening it choose the answers above the rows; a dashboard tile, a schedule or an alert uses the defaults.</p>
      {rows.length === 0 && <p className="mb-3 text-sm text-ink-700">No questions yet.</p>}
      <ul aria-label="Parameters" className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const field = fieldOf(dataset, row.field)
          const operators = field ? askable(field) : [row.operator]
          return (
            <li key={index} aria-label={row.label || `Parameter ${index + 1}`} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="flex flex-col gap-1 text-xs text-ink-800">Label
                <TextInput aria-label={`Parameter ${index + 1} label`} controlSize="sm" value={row.label} maxLength={60} onChange={(event) => update(index, { label: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-800">Field
                <Select aria-label={`Parameter ${index + 1} field`} controlSize="sm" value={row.field} onChange={(event) => changeField(index, event.target.value)}>
                  {[...(field ? [field] : []), ...free].map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-800">Asked As
                <Select aria-label={`Parameter ${index + 1} asked as`} controlSize="sm" value={row.operator} onChange={(event) => update(index, { operator: event.target.value as ParameterOperator, default: undefined })}>
                  {operators.map((operator) => <option key={operator} value={operator}>{ASKED_AS[operator]}</option>)}
                </Select>
              </label>
              <span className="flex items-end"><IconButton label={`Remove ${row.label || `parameter ${index + 1}`}`} icon={Trash2} size="sm" onClick={() => setRows(rows.filter((_, i) => i !== index))} /></span>
              <label className="flex flex-col gap-1 text-xs text-ink-800 sm:col-span-2">Default
                <TextInput aria-label={`Parameter ${index + 1} default`} controlSize="sm" value={defaultText(row)}
                  type={row.operator === 'last_days' || (field?.type === 'number' && !['in', 'between'].includes(row.operator)) ? 'number' : field?.type === 'date' && !['in', 'between'].includes(row.operator) ? 'date' : 'text'}
                  placeholder={row.operator === 'between' ? 'from..to' : row.operator === 'in' ? 'one, two, three' : field?.type === 'boolean' ? 'true or false' : 'None'}
                  onChange={(event) => update(index, { default: event.target.value === '' || !field ? undefined : coerceValue(field, row.operator, event.target.value) })} />
              </label>
              <span className="flex items-end pb-1.5 sm:col-span-2"><Checkbox label="An Answer Is Required" checked={row.required} onChange={(event) => update(index, { required: event.target.checked })} className="text-sm" /></span>
            </li>
          )
        })}
      </ul>
      <button type="button" onClick={add} disabled={rows.length >= MAX_PARAMETERS || free.length === 0}
        className="mt-3 inline-flex h-8 w-fit items-center gap-1.5 rounded-control-md border border-dashed border-line-control px-2.5 text-xs font-semibold text-ink-900 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
        <Plus size={14} strokeWidth={1.5} aria-hidden />Add Parameter
      </button>
      {rows.length >= MAX_PARAMETERS && <p className="mt-2 text-xs text-ink-700">A report asks up to {MAX_PARAMETERS} questions.</p>}
    </Modal>
  )
}
