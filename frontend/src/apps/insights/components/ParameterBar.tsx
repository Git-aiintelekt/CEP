/**
 * The questions a report asks, above its rows, as one line of filter chips (the list pages' pattern): one chip per
 * parameter, named "Label: answer", its menu picking the answer. A change runs the report at once; "Updating…" shows
 * while it runs, and Clear Filters puts the optional answers back to their defaults. A required question with no answer
 * holds the run and says so. A date range is asked as One Day or a Date Range. A question that defaults to the latest
 * says what the latest was (the newest campaign, its last send day), as the run reported it. Once campaigns are picked by
 * hand, a date that defaults to the latest stays open (any day of theirs) unless a day or range is given.
 */
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { buttonClass } from '@/components/buttonStyles'
import { ClearFiltersLink, FilterChip, MultiSelectMenu, SingleSelectMenu } from '@/components/FilterChip'
import { TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Spinner } from '@/components/States'
import { parametersApi } from '../api'
import { answered, answerWords, isLatest, periodCovers, PERIODS } from '../editor/parameters'
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

function lackingIn(parameters: ReportParameter[], draft: ParameterValues): ReportParameter[] {
  return parameters.filter((p) => p.required && !answered(draft[p.key]) && !isLatest(p.default))
    .concat(parameters.filter((p) => p.operator === 'period' && Array.isArray(draft[p.key]) && !(draft[p.key] as unknown[]).every((v) => answered(v))))
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function ParameterBar({ dataset, fields, parameters, values, onRun, missing, running = false, used }: ParameterBarProps) {
  const [draft, setDraft] = useState<ParameterValues>(() => initial(parameters, values))
  const defaults = initial(parameters, {})
  const lacking = lackingIn(parameters, draft)
  function apply(next: ParameterValues) {
    setDraft(next)
    if (lackingIn(parameters, next).length === 0) onRun(Object.fromEntries(Object.entries(next).filter(([, value]) => answered(value))))
  }
  const changed = parameters.some((p) => !p.required && !same(draft[p.key], defaults[p.key]))
  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      {[...parameters].sort((a, b) => Number(b.operator === 'period') - Number(a.operator === 'period')).map((parameter) => {
        const field = fields.find((f) => f.key === parameter.field)
        const dated = field?.type === 'date' || field?.type === 'datetime'
        const open = dated && parameters.some((q) => q.key !== parameter.key && isLatest(q.default) && answered(draft[q.key]))      // campaigns picked by hand: any day of theirs
        const latest = isLatest(parameter.default) && !answered(draft[parameter.key]) && !open
        const found = used?.find((u) => u.key === parameter.key && u.latest)
        const value = draft[parameter.key]
        const oneDay = parameter.operator === 'between' && Array.isArray(value) && value[0] && value[0] === value[1]
        const said = answered(value) ? (oneDay ? String((value as unknown[])[0]) : answerWords(parameter.operator, value))
          : latest ? (found ? `Latest (${latestWords(found.value, parameter.operator === 'between')})` : 'Latest')
          : open && isLatest(parameter.default) ? 'Any Day' : null
        const hint = latest ? (found ? `Latest: ${latestWords(found.value, parameter.operator === 'between')}` : 'The latest, when it runs')
          : open && isLatest(parameter.default) && !answered(value) ? 'Any day of the campaigns chosen' : undefined
        return (
          <ParameterChip key={parameter.key} dataset={dataset} parameter={parameter} type={field?.type ?? 'string'} value={value} said={said} hint={hint} latest={latest}
            onChange={(next) => apply({ ...draft, [parameter.key]: next })} />
        )
      })}
      {changed && <ClearFiltersLink onClick={() => apply({ ...draft, ...Object.fromEntries(parameters.filter((p) => !p.required).map((p) => [p.key, defaults[p.key]])) })} />}
      {running && <span className="ml-auto flex items-center gap-2 text-helper text-ink-800"><Spinner size="sm" label="Updating the report" />Updating…</span>}
      {(lacking.length > 0 || missing) && (
        <p role="status" className="basis-full text-helper text-ink-800">{lacking.length > 0 ? `Choose ${lacking.map((p) => p.label).join(' and ')} to run the report.` : missing}</p>
      )}
    </div>
  )
}

interface ChipProps {
  dataset: string
  parameter: ReportParameter
  type: CatalogField['type']
  value: unknown
  /** the answer in words, or null when there is none to show */
  said: string | null
  hint?: string
  /** the question defaults to the latest and has no answer */
  latest: boolean
  onChange: (value: unknown) => void
}

function chipLabel(parameter: ReportParameter, said: string | null): string {
  return said ? `${parameter.label}: ${said}` : parameter.required ? `${parameter.label} (Required)` : parameter.label
}

function ParameterChip(props: ChipProps) {
  const { parameter, type, value, said, hint, onChange } = props
  const label = chipLabel(parameter, said)
  const active = answered(value)
  if (type === 'boolean') {
    const options = [{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
    return (
      <FilterChip align="start" label={label} active={active} hint={hint} menuLabel={`${parameter.label} values`} menuWidth={200}>
        {({ close }) => <SingleSelectMenu label={parameter.label} options={options} value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(next) => { onChange(next === '' ? undefined : next === 'true'); close() }} />}
      </FilterChip>
    )
  }
  if (parameter.operator === 'period') return <PeriodChip label={parameter.label} value={value} onChange={onChange} />
  const listed = (parameter.operator === 'in' || parameter.operator === '=') && (type === 'string' || type === 'number')
  if (listed) return <ListedChip {...props} />
  return (
    <FilterChip align="start" label={label} active={active} hint={hint} menuLabel={`${parameter.label} answer`} menuWidth={320}>
      {({ close }) => <AnswerMenu value={value} onApply={(next) => { onChange(next); close() }}>{(draft, set) => <Answer parameter={parameter} type={type} value={draft} onChange={set} />}</AnswerMenu>}
    </FilterChip>
  )
}

/** a typed answer: a draft until Apply; Clear empties it */
function AnswerMenu({ value, onApply, children }: { value: unknown; onApply: (value: unknown) => void; children: (draft: unknown, set: (value: unknown) => void) => ReactNode }) {
  const [draft, setDraft] = useState<unknown>(value)
  return (
    <div>
      <div className="flex flex-col gap-2 p-3">{children(draft, setDraft)}</div>
      <div className="flex items-center justify-between gap-2 border-t border-line-subtle px-3 py-2">
        <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => onApply(undefined)}>Clear</button>
        <button type="button" className={buttonClass({ variant: 'primary', size: 'sm' })} onClick={() => onApply(draft)}>Apply</button>
      </div>
    </div>
  )
}

/** the fields a typed answer is given in, inside its chip's menu */
function Answer({ parameter, type, value, onChange }: { parameter: ReportParameter; type: CatalogField['type']; value: unknown; onChange: (value: unknown) => void }) {
  const label = parameter.label
  const input = type === 'number' ? 'number' : type === 'date' || type === 'datetime' ? 'date' : 'text'
  if (parameter.operator === 'between' && input === 'date') return <DayOrRange label={label} value={value} onChange={onChange} />
  if (parameter.operator === 'between') {
    const pair = Array.isArray(value) ? value : ['', '']
    const set = (at: 0 | 1, text: string) => { const next = [...pair]; next[at] = input === 'number' && text !== '' ? Number(text) : text; onChange(next.every((v) => v === '' || v === undefined) ? undefined : next) }
    return (
      <>
        <TextInput aria-label={`${label} from`} controlSize="sm" type={input} value={String(pair[0] ?? '')} onChange={(event) => set(0, event.target.value)} />
        <TextInput aria-label={`${label} to`} controlSize="sm" type={input} value={String(pair[1] ?? '')} onChange={(event) => set(1, event.target.value)} />
      </>
    )
  }
  if (parameter.operator === 'last_days') {
    return <span className="flex items-center gap-1.5 text-sm text-ink-800">Last <span className="w-20"><TextInput aria-label={label} controlSize="sm" type="number" min={1} max={3660} value={String(value ?? '')} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} /></span> days</span>
  }
  if (input === 'text' && parameter.operator === 'in') {
    const text = Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '')
    return <TextInput aria-label={label} controlSize="sm" value={text} placeholder="one, two, three"
      onChange={(event) => { const parts = event.target.value.split(',').map((part) => part.trim()).filter(Boolean); onChange(parts.length ? parts : undefined) }} />
  }
  return <TextInput aria-label={label} controlSize="sm" type={input} value={String(value ?? '')} onChange={(event) => onChange(event.target.value === '' ? undefined : input === 'number' ? Number(event.target.value) : event.target.value)} />
}

const CUSTOM = 'custom'

/** Period: always answered, so the chip always names its span; the menu offers the spans, then Custom Range with two dates */
function PeriodChip({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const preset = PERIODS.find((p) => p.value === value)
  const covers = periodCovers(value)
  const words = preset ? preset.label : Array.isArray(value) ? (covers ?? 'Custom Range') : 'Last 7 Days'
  return (
    <FilterChip align="start" label={`${label}: ${words}`} active hint={covers ?? undefined} menuLabel={`${label} choices`} menuWidth={280}>
      {({ close }) => <PeriodMenu label={label} value={value} covers={covers} onChange={(next) => { onChange(next); close() }} />}
    </FilterChip>
  )
}

function PeriodMenu({ label, value, covers, onChange }: { label: string; value: unknown; covers: string | null; onChange: (value: unknown) => void }) {
  const [custom, setCustom] = useState(Array.isArray(value))
  const [pair, setPair] = useState<string[]>(Array.isArray(value) ? value.map((v) => String(v ?? '')) : ['', ''])
  const options = [...PERIODS.map((p) => ({ value: p.value as string, label: p.label })), { value: CUSTOM, label: 'Custom Range' }]
  return (
    <div>
      <SingleSelectMenu label={label} options={options} value={custom ? CUSTOM : String(value ?? '7d')} onChange={(next) => { if (next === CUSTOM) setCustom(true); else onChange(next) }} />
      {custom ? (
        <div className="border-t border-line-subtle">
          <div className="flex flex-col gap-2 p-3">
            <TextInput aria-label={`${label} from`} controlSize="sm" type="date" value={pair[0]} onChange={(event) => setPair([event.target.value, pair[1]])} />
            <TextInput aria-label={`${label} to`} controlSize="sm" type="date" value={pair[1]} onChange={(event) => setPair([pair[0], event.target.value])} />
          </div>
          <div className="flex justify-end border-t border-line-subtle px-3 py-2">
            <button type="button" className={buttonClass({ variant: 'primary', size: 'sm' })} disabled={!pair[0] || !pair[1]} onClick={() => onChange(pair)}>Apply</button>
          </div>
        </div>
      ) : covers && <p data-menu-note className="border-t border-line-subtle px-3 py-2 text-helper text-ink-800">{covers}</p>}
    </div>
  )
}

/** a date range asked as One Day (sent as [day, day]) or a Date Range (from and to) */
function DayOrRange({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const pair = Array.isArray(value) ? value.map((v) => String(v ?? '')) : ['', '']
  const [mode, setMode] = useState<'day' | 'range'>(pair[0] && pair[0] !== pair[1] ? 'range' : 'day')
  const set = (next: string[]) => onChange(next.every((v) => v === '') ? undefined : next)
  return (
    <>
      <SegmentedControl label={`${label}: one day or a date range`} variant="outline" value={mode} onChange={(next) => { setMode(next); if (next === 'day' && pair[0]) set([pair[0], pair[0]]) }}
        options={[{ value: 'day', label: 'One Day' }, { value: 'range', label: 'Date Range' }]} />
      {mode === 'day' ? (
        <TextInput aria-label={label} controlSize="sm" type="date" value={pair[0]} onChange={(event) => set([event.target.value, event.target.value])} />
      ) : (
        <>
          <TextInput aria-label={`${label} from`} controlSize="sm" type="date" value={pair[0]} onChange={(event) => set([event.target.value, pair[1]])} />
          <TextInput aria-label={`${label} to`} controlSize="sm" type="date" value={pair[1]} onChange={(event) => set([pair[0], event.target.value])} />
        </>
      )}
    </>
  )
}

/** a text or number dimension: its values to pick from (one, or any of several); typed in when the field offers no list */
function ListedChip({ dataset, parameter, type, value, said, hint, latest, onChange }: ChipProps) {
  const choices = useQuery({ queryKey: ['insights', 'parameter-values', dataset, parameter.field], queryFn: () => parametersApi.values({ dataset, field: parameter.field }), staleTime: 60_000, retry: false })
  const label = parameter.label
  const offered = choices.data?.choosable ? choices.data.values : null
  const chip = chipLabel(parameter, said)
  return (
    <FilterChip align="start" label={chip} active={answered(value)} hint={hint} menuLabel={`${label} values`} menuWidth={offered ? 280 : 320}>
      {({ close }) => {
        if (choices.isPending) return <div className="flex justify-center p-4"><Spinner size="sm" label={`Loading ${label} values`} /></div>
        if (!offered) {
          return (
            <AnswerMenu value={value} onApply={(next) => { onChange(next); close() }}>
              {(draft, set) => {
                const text = Array.isArray(draft) ? draft.map(String).join(', ') : String(draft ?? '')
                return <TextInput aria-label={label} controlSize="sm" value={text} placeholder={parameter.operator === 'in' ? 'one, two, three' : ''}
                  onChange={(event) => { const parts = event.target.value.split(',').map((part) => part.trim()).filter(Boolean).map((part) => (type === 'number' ? Number(part) : part)); set(parameter.operator === 'in' ? (parts.length ? parts : undefined) : parts[0]) }} />
              }}
            </AnswerMenu>
          )
        }
        const raw = new Map(offered.map((v) => [String(v), v]))
        if (parameter.operator === '=') {
          const none = latest ? 'Latest' : parameter.required ? 'Choose One' : 'Any'
          return <SingleSelectMenu label={label} options={[{ value: '', label: none }, ...offered.map((v) => ({ value: String(v), label: String(v) }))]} value={value === undefined ? '' : String(value)}
            onChange={(next) => { onChange(next === '' ? undefined : raw.get(next)); close() }} />
        }
        const picked = Array.isArray(value) ? value : value === undefined ? [] : [value]
        return (
          <MultiSelectMenu label={label} searchLabel={`Search ${label}`} options={offered.map((v) => ({ value: String(v), label: String(v) }))} value={picked.map(String)}
            onApply={(next) => { onChange(next.length ? next.map((key) => raw.get(key) ?? key) : undefined); close() }}
            note={choices.data?.more ? 'The first 200 values' : undefined} />
        )
      }}
    </FilterChip>
  )
}
