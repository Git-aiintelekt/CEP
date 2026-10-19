/**
 * The questions a report asks, above its rows: one control per parameter (a list of the field's values to pick from, a
 * value, a range, the last few days), the defaults filled in, then Run Report. Nothing runs until Run is pressed.
 */
import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { FilterChip, MultiSelectMenu } from '@/components/FilterChip'
import { buttonPrimary, Select, TextInput } from '@/components/Form'
import { Spinner } from '@/components/States'
import { parametersApi } from '../api'
import { answered, answerWords } from '../editor/parameters'
import type { CatalogField, ParameterValues, ReportParameter } from '../types'

interface ParameterBarProps {
  dataset: string
  fields: CatalogField[]
  parameters: ReportParameter[]
  values: ParameterValues
  onRun: (values: ParameterValues) => void
  /** the question the server said is unanswered */
  missing?: string
  running?: boolean
}

function initial(parameters: ReportParameter[], values: ParameterValues): ParameterValues {
  return Object.fromEntries(parameters.map((p) => [p.key, answered(values[p.key]) ? values[p.key] : p.default]))
}

export function ParameterBar({ dataset, fields, parameters, values, onRun, missing, running = false }: ParameterBarProps) {
  const [draft, setDraft] = useState<ParameterValues>(() => initial(parameters, values))
  const lacking = parameters.filter((p) => p.required && !answered(draft[p.key]))
  function submit(event: FormEvent) {
    event.preventDefault()
    if (lacking.length === 0) onRun(Object.fromEntries(Object.entries(draft).filter(([, value]) => answered(value))))
  }
  return (
    <form onSubmit={submit} aria-label="Parameters" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
      {parameters.map((parameter) => {
        const field = fields.find((f) => f.key === parameter.field)
        return (
          <div key={parameter.key} role="group" aria-label={parameter.label} className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-ink-800">{parameter.label}{parameter.required && <span className="ml-0.5 text-danger-plain" aria-hidden>*</span>}</span>
            <Answer dataset={dataset} parameter={parameter} type={field?.type ?? 'string'} value={draft[parameter.key]} onChange={(value) => setDraft({ ...draft, [parameter.key]: value })} />
          </div>
        )
      })}
      <button type="submit" className={buttonPrimary} disabled={running || lacking.length > 0}><Play size={16} strokeWidth={1.5} aria-hidden />Run Report</button>
      {(lacking.length > 0 || missing) && (
        <p role="status" className="basis-full text-xs text-ink-800">{lacking.length > 0 ? `Choose ${lacking.map((p) => p.label).join(' and ')}, then run the report.` : missing}</p>
      )}
    </form>
  )
}

function Answer({ dataset, parameter, type, value, onChange }: { dataset: string; parameter: ReportParameter; type: CatalogField['type']; value: unknown; onChange: (value: unknown) => void }) {
  const label = parameter.label
  const listed = (parameter.operator === 'in' || parameter.operator === '=') && (type === 'string' || type === 'number')
  if (type === 'boolean') {
    return (
      <span className="w-32"><Select aria-label={label} controlSize="sm" value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}>
        <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
      </Select></span>
    )
  }
  if (listed) return <ListedAnswer dataset={dataset} parameter={parameter} type={type} value={value} onChange={onChange} />
  const input = type === 'number' ? 'number' : 'date'
  if (parameter.operator === 'between') {
    const pair = Array.isArray(value) ? value : ['', '']
    const set = (at: 0 | 1, text: string) => { const next = [...pair]; next[at] = input === 'number' && text !== '' ? Number(text) : text; onChange(next.every((v) => v === '' || v === undefined) ? undefined : next) }
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-800">
        <span className="w-36"><TextInput aria-label={`${label} from`} controlSize="sm" type={input} value={String(pair[0] ?? '')} onChange={(event) => set(0, event.target.value)} /></span>
        <span>to</span>
        <span className="w-36"><TextInput aria-label={`${label} to`} controlSize="sm" type={input} value={String(pair[1] ?? '')} onChange={(event) => set(1, event.target.value)} /></span>
      </span>
    )
  }
  if (parameter.operator === 'last_days') {
    return <span className="flex items-center gap-1.5 text-xs text-ink-800">Last <span className="w-20"><TextInput aria-label={label} controlSize="sm" type="number" min={1} max={3660} value={String(value ?? '')} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} /></span> days</span>
  }
  return <span className="w-40"><TextInput aria-label={label} controlSize="sm" type={input} value={String(value ?? '')} onChange={(event) => onChange(event.target.value === '' ? undefined : input === 'number' ? Number(event.target.value) : event.target.value)} /></span>
}

/** a text or number dimension: its values to pick from (one, or any of several); typed in when the field offers no list */
function ListedAnswer({ dataset, parameter, type, value, onChange }: { dataset: string; parameter: ReportParameter; type: CatalogField['type']; value: unknown; onChange: (value: unknown) => void }) {
  const choices = useQuery({ queryKey: ['insights', 'parameter-values', dataset, parameter.field], queryFn: () => parametersApi.values({ dataset, field: parameter.field }), staleTime: 60_000, retry: false })
  const label = parameter.label
  if (choices.isPending) return <span className="flex h-8 items-center"><Spinner size="sm" label={`Loading ${label} values`} /></span>
  const offered = choices.data?.choosable ? choices.data.values : null
  if (!offered) {
    const text = Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '')
    return <span className="w-48"><TextInput aria-label={label} controlSize="sm" value={text} placeholder={parameter.operator === 'in' ? 'one, two, three' : ''}
      onChange={(event) => { const parts = event.target.value.split(',').map((part) => part.trim()).filter(Boolean).map((part) => (type === 'number' ? Number(part) : part)); onChange(parameter.operator === 'in' ? (parts.length ? parts : undefined) : parts[0]) }} /></span>
  }
  if (parameter.operator === '=') {
    return (
      <span className="w-48"><Select aria-label={label} controlSize="sm" value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : offered.find((v) => String(v) === event.target.value))}>
        <option value="">{parameter.required ? 'Choose One' : 'Any'}</option>
        {offered.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
      </Select></span>
    )
  }
  const picked = Array.isArray(value) ? value : value === undefined ? [] : [value]
  const raw = new Map(offered.map((v) => [String(v), v]))
  return (
    <FilterChip label={answerWords('in', picked)} active={picked.length > 0} menuLabel={`${label} values`} menuWidth={280}>
      {({ close }) => (
        <MultiSelectMenu label={label} searchLabel={`Search ${label}`} options={offered.map((v) => ({ value: String(v), label: String(v) }))} value={picked.map(String)}
          onApply={(next) => { onChange(next.length ? next.map((key) => raw.get(key) ?? key) : undefined); close() }}
          note={choices.data?.more ? 'The first 200 values' : undefined} />
      )}
    </FilterChip>
  )
}
