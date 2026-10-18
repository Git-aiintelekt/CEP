/**
 * Format Values: conditional formatting for each totalled column of the report (each measure, and each of its comparisons):
 * none, a colour scale, data bars, or up to five rules (more than, at least, less than, at most or equal to a number, with
 * a tone: good, warning or bad; the first rule that matches colours the cell). Saved with the view; the grid, the pivot and
 * the hierarchy show it, totals stay plain.
 */
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/Button'
import { Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import type { CatalogDataset, ColumnFormat, FormatRule, FormatStyle, FormatTone, ReportDefinition } from '../types'
import { formattableColumns } from './definition'

const STYLE_LABEL: Record<FormatStyle | 'none', string> = { none: 'None', scale: 'Colour Scale', bars: 'Data Bars', rules: 'Rules' }
const OP_LABEL: Record<FormatRule['op'], string> = { '>': 'More than', '>=': 'At least', '<': 'Less than', '<=': 'At most', '=': 'Equal to' }
const TONE_LABEL: Record<FormatTone, string> = { good: 'Good', warning: 'Warning', bad: 'Bad' }
const MAX_RULES = 5

type Draft = Record<string, { style: FormatStyle | 'none'; rules: { op: FormatRule['op']; value: string; tone: FormatTone }[] }>

export function FormatDialog({ dataset, definition, formats, onApply, onClose }: { dataset: CatalogDataset; definition: ReportDefinition; formats: ColumnFormat[]; onApply: (formats: ColumnFormat[]) => void; onClose: () => void }) {
  const columns = formattableColumns(dataset, definition)
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(columns.map((column) => {
    const saved = formats.find((format) => format.column === column.key)
    return [column.key, { style: saved?.style ?? 'none', rules: (saved?.rules ?? []).map((rule) => ({ ...rule, value: String(rule.value) })) }]
  })))
  const set = (key: string, patch: Partial<Draft[string]>) => setDraft((all) => ({ ...all, [key]: { ...all[key], ...patch } }))
  const incomplete = columns.some((column) => draft[column.key].style === 'rules' && (draft[column.key].rules.length === 0 || draft[column.key].rules.some((rule) => rule.value.trim() === '' || Number.isNaN(Number(rule.value)))))

  function apply() {
    onApply(columns.flatMap((column): ColumnFormat[] => {
      const item = draft[column.key]
      if (item.style === 'none') return []
      return [{ column: column.key, style: item.style, ...(item.style === 'rules' ? { rules: item.rules.map((rule) => ({ op: rule.op, value: Number(rule.value), tone: rule.tone })) } : {}) }]
    }))
  }

  return (
    <Modal title="Format Values" subtitle="Colour the numbers of each column. Totals stay plain." onClose={onClose} size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} onClick={apply} disabled={incomplete}>Apply</button>
        </div>
      )}>
      {columns.length === 0 ? <p className="text-sm text-ink-800">Add a value to the report first: only totalled columns are formatted.</p> : (
        <ul aria-label="Columns to format" className="flex flex-col divide-y divide-line-subtle">
          {columns.map((column) => {
            const item = draft[column.key]
            return (
              <li key={column.key} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{column.label}</span>
                  <span className="w-44"><Select aria-label={`${column.label} formatting`} controlSize="sm" value={item.style}
                    onChange={(event) => { const style = event.target.value as FormatStyle | 'none'; set(column.key, { style, rules: style === 'rules' && item.rules.length === 0 ? [{ op: '<', value: '', tone: 'bad' }] : item.rules }) }}>
                    {(Object.keys(STYLE_LABEL) as (FormatStyle | 'none')[]).map((style) => <option key={style} value={style}>{STYLE_LABEL[style]}</option>)}
                  </Select></span>
                </div>
                {item.style === 'rules' && (
                  <div className="flex flex-col gap-1.5 pl-3">
                    {item.rules.map((rule, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-ink-800">{index === 0 ? 'When' : 'Else when'}</span>
                        <span className="w-32"><Select aria-label={`${column.label} rule ${index + 1} comparison`} controlSize="sm" value={rule.op}
                          onChange={(event) => set(column.key, { rules: item.rules.map((r, i) => (i === index ? { ...r, op: event.target.value as FormatRule['op'] } : r)) })}>
                          {(Object.keys(OP_LABEL) as FormatRule['op'][]).map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
                        </Select></span>
                        <span className="w-28"><TextInput aria-label={`${column.label} rule ${index + 1} value`} controlSize="sm" type="number" step="any" value={rule.value}
                          onChange={(event) => set(column.key, { rules: item.rules.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)) })} /></span>
                        <span className="text-xs text-ink-800">shows as</span>
                        <span className="w-28"><Select aria-label={`${column.label} rule ${index + 1} tone`} controlSize="sm" value={rule.tone}
                          onChange={(event) => set(column.key, { rules: item.rules.map((r, i) => (i === index ? { ...r, tone: event.target.value as FormatTone } : r)) })}>
                          {(Object.keys(TONE_LABEL) as FormatTone[]).map((tone) => <option key={tone} value={tone}>{TONE_LABEL[tone]}</option>)}
                        </Select></span>
                        <IconButton label={`Remove ${column.label} rule ${index + 1}`} icon={X} size="xs" onClick={() => set(column.key, { rules: item.rules.filter((_, i) => i !== index) })} />
                      </div>
                    ))}
                    {item.rules.length < MAX_RULES && (
                      <button type="button" onClick={() => set(column.key, { rules: [...item.rules, { op: '>=', value: '', tone: 'good' }] })}
                        className="inline-flex h-7 w-fit items-center gap-1 rounded-control-sm px-1.5 text-xs font-semibold text-brand-800 hover:bg-surface-hover">
                        <Plus size={12} strokeWidth={1.5} aria-hidden />Add Rule
                      </button>
                    )}
                    <p className="text-xs text-ink-700">The first rule a number meets colours its cell. A change or a share is in percent: 10 means 10%.</p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
