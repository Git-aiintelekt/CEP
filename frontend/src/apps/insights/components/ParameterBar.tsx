/**
 * The questions a report asks, above its rows: one control per parameter (a list of the field's values to pick from, a
 * value, a range, the last few days), the defaults filled in, then Run Report. Nothing runs until Run is pressed. A date range
 * is asked as One Day or a Date Range. A question that defaults to the latest is left empty and says what the latest was
 * (the newest campaign, its last send day), as the run reported it. Once campaigns are picked by hand, a date that defaults to the
 * latest stays open (any day of theirs) unless a day or range is given.
 */
import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { FilterChip, MultiSelectMenu } from '@/components/FilterChip'
import { buttonPrimary, Select, TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Spinner } from '@/components/States'
import { parametersApi } from '../api'
import { answered, answerWords, isLatest, PERIODS } from '../editor/parameters'
import type { CatalogField, ParameterValues, ReportParameter, RunResult } from '../types'

interface ParameterBarProps {
  dataset: string
  fields: CatalogField[]
  parameters: ReportParameter[]
  values: ParameterValues
  onRun: (values: ParameterValues) => void
  /** the question the server said is unanswered */
  missing?: string
  running?: boolean
  /** what the last run answered with: the latest values looked up */
  used?: RunResult['parameters']
}

function initial(parameters: ReportParameter[], values: ParameterValues): ParameterValues {
  return Object.fromEntries(parameters.map((p) => [p.key, answered(values[p.key]) ? values[p.key] : isLatest(p.default) ? undefined : p.default]))
}

function latestWords(value: unknown, range = false): string {
  if (Array.isArray(value)) return value.length === 2 && value[0] === value[1] ? String(value[0]) : value.map(String).join(range ? ' to ' : ', ')
  return String(value)
}

export function ParameterBar({ dataset, fields, parameters, values, onRun, missing, running = false, used }: ParameterBarProps) {
  const [draft, setDraft] = useState<ParameterValues>(() => initial(parameters, values))
  const lacking = parameters.filter((p) => p.required && !answered(draft[p.key]) && !isLatest(p.default))
    .concat(parameters.filter((p) => p.operator === 'period' && Array.isArray(draft[p.key]) && !(draft[p.key] as unknown[]).every((v) => answered(v))))
  function submit(event: FormEvent) {
    event.preventDefault()
    if (lacking.length === 0) onRun(Object.fromEntries(Object.entries(draft).filter(([, value]) => answered(value))))
  }
  return (
    <form onSubmit={submit} aria-label="Parameters" className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface p-3">
      {parameters.map((parameter) => {
        const field = fields.find((f) => f.key === parameter.field)
        const dated = field?.type === 'date' || field?.type === 'datetime'
        const open = dated && parameters.some((q) => q.key !== parameter.key && isLatest(q.default) && answered(draft[q.key]))      // campaigns picked by hand: any day of theirs
        const latest = isLatest(parameter.default) && !answered(draft[parameter.key]) && !open
        const found = used?.find((u) => u.key === parameter.key && u.latest)
        return (
          <div key={parameter.key} role="group" aria-label={parameter.label} className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-ink-800">{parameter.label}{parameter.required && <span className="ml-0.5 text-danger-plain" aria-hidden>*</span>}</span>
            <Answer dataset={dataset} parameter={parameter} type={field?.type ?? 'string'} value={draft[parameter.key]} onChange={(value) => setDraft({ ...draft, [parameter.key]: value })}
              latest={latest ? (found ? latestWords(found.value, parameter.operator === 'between') : '') : null} />
            {latest && <span className="text-xs text-ink-700">{found ? `Latest: ${latestWords(found.value, parameter.operator === 'between')}` : 'The latest, when it runs'}</span>}
            {open && isLatest(parameter.default) && !answered(draft[parameter.key]) && <span className="text-xs text-ink-700">Any day of the campaigns chosen</span>}
          </div>
        )
      })}
      <button type="submit" className={`${buttonPrimary} mt-5`} disabled={running || lacking.length > 0}><Play size={16} strokeWidth={1.5} aria-hidden />Run Report</button>
      {(lacking.length > 0 || missing) && (
        <p role="status" className="basis-full text-xs text-ink-800">{lacking.length > 0 ? `Choose ${lacking.map((p) => p.label).join(' and ')}, then run the report.` : missing}</p>
      )}
    </form>
  )
}

/** latest: the question defaults to the latest and has no answer (the value found, or '' before the first run); null otherwise */
function Answer({ dataset, parameter, type, value, onChange, latest = null }: { dataset: string; parameter: ReportParameter; type: CatalogField['type']; value: unknown; onChange: (value: unknown) => void; latest?: string | null }) {
  const label = parameter.label
  const listed = (parameter.operator === 'in' || parameter.operator === '=') && (type === 'string' || type === 'number')
  if (type === 'boolean') {
    return (
      <span className="w-32"><Select aria-label={label} controlSize="sm" value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}>
        <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
      </Select></span>
    )
  }
  if (parameter.operator === 'period') return <PeriodAnswer label={label} value={value} onChange={onChange} />
  if (listed) return <ListedAnswer dataset={dataset} parameter={parameter} type={type} value={value} onChange={onChange} latest={latest} />
  const input = type === 'number' ? 'number' : 'date'
  if (parameter.operator === 'between' && input === 'date') return <DayOrRange label={label} value={value} onChange={onChange} />
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

const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** Period (docs/mockups/report-filters-period.html, option B): one drop-down of spans, Custom with two dates beside it, the days it covers under it */
function PeriodAnswer({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const custom = Array.isArray(value)
  const [open, setOpen] = useState(custom)
  const pair = custom ? (value as unknown[]).map((v) => String(v ?? '')) : ['', '']
  const preset = PERIODS.find((p) => p.value === value)
  const today = new Date()
  const covers = preset ? `${dayMonth.format(new Date(today.getTime() - preset.days * 86_400_000))} to ${dayMonthYear.format(today)}` : null
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-800">
        <span className="w-44"><Select aria-label={label} controlSize="sm" value={open ? 'custom' : String(preset?.value ?? '7d')}
          onChange={(event) => { if (event.target.value === 'custom') { setOpen(true); onChange(pair[0] && pair[1] ? pair : undefined) } else { setOpen(false); onChange(event.target.value) } }}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          <option value="custom">Custom Range</option>
        </Select></span>
        {open && (
          <>
            <span className="w-36"><TextInput aria-label={`${label} from`} controlSize="sm" type="date" value={pair[0]} onChange={(event) => onChange([event.target.value, pair[1]])} /></span>
            <span>to</span>
            <span className="w-36"><TextInput aria-label={`${label} to`} controlSize="sm" type="date" value={pair[1]} onChange={(event) => onChange([pair[0], event.target.value])} /></span>
          </>
        )}
      </span>
      {covers && !open && <span className="text-xs text-ink-700">{covers}</span>}
    </span>
  )
}

/** a date range asked as One Day (sent as [day, day]) or a Date Range (from and to) */
function DayOrRange({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const pair = Array.isArray(value) ? value.map((v) => String(v ?? '')) : ['', '']
  const [mode, setMode] = useState<'day' | 'range'>(pair[0] && pair[0] !== pair[1] ? 'range' : 'day')
  const set = (next: string[]) => onChange(next.every((v) => v === '') ? undefined : next)
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-800">
      <SegmentedControl label={`${label}: one day or a date range`} variant="outline" value={mode} onChange={(next) => { setMode(next); if (next === 'day' && pair[0]) set([pair[0], pair[0]]) }}
        options={[{ value: 'day', label: 'One Day' }, { value: 'range', label: 'Date Range' }]} />
      {mode === 'day' ? (
        <span className="w-36"><TextInput aria-label={label} controlSize="sm" type="date" value={pair[0]} onChange={(event) => set([event.target.value, event.target.value])} /></span>
      ) : (
        <>
          <span className="w-36"><TextInput aria-label={`${label} from`} controlSize="sm" type="date" value={pair[0]} onChange={(event) => set([event.target.value, pair[1]])} /></span>
          <span>to</span>
          <span className="w-36"><TextInput aria-label={`${label} to`} controlSize="sm" type="date" value={pair[1]} onChange={(event) => set([pair[0], event.target.value])} /></span>
        </>
      )}
    </span>
  )
}

/** a text or number dimension: its values to pick from (one, or any of several); typed in when the field offers no list */
function ListedAnswer({ dataset, parameter, type, value, onChange, latest = null }: { dataset: string; parameter: ReportParameter; type: CatalogField['type']; value: unknown; onChange: (value: unknown) => void; latest?: string | null }) {
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
        <option value="">{latest !== null ? 'Latest' : parameter.required ? 'Choose One' : 'Any'}</option>
        {offered.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
      </Select></span>
    )
  }
  const picked = Array.isArray(value) ? value : value === undefined ? [] : [value]
  const raw = new Map(offered.map((v) => [String(v), v]))
  return (
    <FilterChip label={picked.length === 0 && latest !== null ? 'Latest' : answerWords('in', picked)} active={picked.length > 0} menuLabel={`${label} values`} menuWidth={280}>
      {({ close }) => (
        <MultiSelectMenu label={label} searchLabel={`Search ${label}`} options={offered.map((v) => ({ value: String(v), label: String(v) }))} value={picked.map(String)}
          onApply={(next) => { onChange(next.length ? next.map((key) => raw.get(key) ?? key) : undefined); close() }}
          note={choices.data?.more ? 'The first 200 values' : undefined} />
      )}
    </FilterChip>
  )
}
