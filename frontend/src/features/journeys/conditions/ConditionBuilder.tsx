/** The condition builder: rows of field, operator and value under "Yes when All of these are true", one nested group,
 * a read-back sentence, and (MatchCount) how many customers the rule holds for right now. Used by the Condition step
 * (NodeConfigPanel), by Setup's Customer Attribute Matches trigger and by its Only Customers Where filters.
 *
 * Fields come from GET /journeys/condition-fields/ (the workspace's own attributes, events, lists and segments) plus,
 * inside a journey, its message and Condition steps. Each field offers only the operators its kind allows
 * (conditionModel.ts); the rule PUT to the graph is exactly apps/journeys/conditions.py's shape. */
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'

import { controlClass } from '@/components/controlStyles'
import { Select, TextInput } from '@/components/Form'
import { Popover } from '@/components/Popover'
import { Spinner } from '@/components/States'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import type { ConditionCount, ConditionField, ConditionFieldCatalogue, ConditionItem, ConditionRule } from '@/lib/types'

import {
  MAX_CONDITIONS, MAX_DAYS, PROPERTY_OPERATORS, conditionProblem, countConditions, describeRule, emptyCondition, emptyRule, fieldKind, isGroup,
  lookupField, normalizeRule, operatorOf, operatorsFor, titleFromKey, type JourneyStepOption, type Operator,
} from './conditionModel'

export const CONDITION_FIELDS_KEY = ['journeys', 'condition-fields'] as const

export function useConditionFields() {
  return useQuery({
    queryKey: CONDITION_FIELDS_KEY,
    queryFn: ({ signal }) => api.get<ConditionFieldCatalogue>('/journeys/condition-fields/', undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
}

function Sized({ width, children }: { width: string; children: ReactNode }) {
  return <span className={`inline-block shrink-0 ${width}`}>{children}</span>
}

const linkButton = 'inline-flex items-center gap-1 text-sm font-medium text-link hover:text-brand-700 disabled:text-ink-300'
const small = controlClass({ size: 'sm' })

// ------------------------------------------------------------------------------------------------ the field picker

interface PickerGroup {
  label: string
  options: { key: string; label: string; note?: string }[]
}

function pickerGroups(catalogue: ConditionFieldCatalogue | undefined, steps: JourneyStepOption[], atEntry: boolean, search: string): PickerGroup[] {
  const q = search.trim().toLowerCase()
  const fits = (label: string, key: string) => !q || label.toLowerCase().includes(q) || key.toLowerCase().includes(q)
  const field = (item: ConditionField, note?: string) => ({ key: item.key, label: item.label, note })
  const groups: PickerGroup[] = [
    { label: 'Customer', options: [
      ...(catalogue?.customer ?? []).map((item) => field(item)),
      ...(catalogue?.attributes ?? []).map((item) => field(item, item.customers ? `${formatNumber(item.customers)} customers` : undefined)),
    ] },
  ]
  if (!atEntry) {
    groups.push({ label: 'This Journey', options: [
      ...(steps.some((step) => step.type !== 'CONDITION') ? [{ key: 'message:*', label: 'Any message of this journey' }] : []),
      ...steps.map((step) => ({ key: step.type === 'CONDITION' ? `step:${step.key}` : `message:${step.key}`,
                                label: step.type === 'CONDITION' ? `Condition · ${step.label}` : `${step.type === 'EMAIL' ? 'Email' : 'SMS'} · ${step.label}` })),
    ] })
  }
  groups.push({ label: 'Events', options: (catalogue?.events ?? []).map((item) => field(item, item.seen ? `${formatNumber(item.seen)} in 90 days` : undefined)) })
  groups.push({ label: 'Lists and Segments', options: [
    ...(catalogue?.lists ?? []).map((item) => ({ key: item.key, label: item.label, note: 'List' })),
    ...(catalogue?.segments ?? []).map((item) => ({ key: item.key, label: item.label, note: 'Segment' })),
  ] })
  return groups.map((group) => ({ ...group, options: group.options.filter((option) => fits(option.label, option.key)) })).filter((group) => group.options.length > 0)
}

/** The label the picker shows for a chosen field, even one the catalogue no longer lists. */
export function fieldTitle(key: string, catalogue: ConditionFieldCatalogue | undefined, steps: JourneyStepOption[]): string {
  const parsed = fieldKind(key)
  if (!parsed) return ''
  const named = lookupField(key, catalogue)?.label
  if (named) return named
  if (parsed.kind === 'message') {
    if (parsed.rest === '*') return 'Any message of this journey'
    const step = steps.find((item) => item.key === parsed.rest)
    return step ? `${step.type === 'EMAIL' ? 'Email' : 'SMS'} · ${step.label}` : `Message step ${parsed.rest}`
  }
  if (parsed.kind === 'step') {
    const step = steps.find((item) => item.key === parsed.rest)
    return step ? `Condition · ${step.label}` : `Step ${parsed.rest}`
  }
  if (parsed.kind === 'list') return 'A list that no longer exists'
  if (parsed.kind === 'segment') return 'A segment that no longer exists'
  return titleFromKey(parsed.rest)
}

function FieldPicker({ value, onPick, catalogue, loading, steps, atEntry }: {
  value: string; onPick: (key: string) => void; catalogue: ConditionFieldCatalogue | undefined; loading: boolean; steps: JourneyStepOption[]; atEntry: boolean
}) {
  const dropdown = useSingleDropdown<'field'>()
  const open = dropdown.isOpen('field')
  const [search, setSearch] = useState('')
  useEffect(() => { if (!open) setSearch('') }, [open])
  const groups = pickerGroups(catalogue, steps, atEntry, search)
  const title = fieldTitle(value, catalogue, steps)
  const typed = search.trim().toUpperCase().replace(/[\s-]+/g, '_')
  const asEvent = /^[A-Z][A-Z0-9_]{1,59}$/.test(typed) && !groups.some((group) => group.options.some((option) => option.key === `event:${typed}`))
  const asAttribute = search.trim() !== '' && !groups.some((group) => group.options.some((option) => option.key === `attr:${search.trim()}`))
  return (
    <div className="relative min-w-[160px] flex-1">
      <button type="button" {...dropdown.triggerProps('field')} aria-label="Field" className={`${small} flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${title ? 'text-ink-900' : 'text-ink-300'}`}>{title || 'Choose a field'}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 text-ink-800 transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Popover {...dropdown.panelProps('field')} label="Choose a field" placement="bottom-start" width={320}>
          <div className="border-b border-line p-2">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fields" aria-label="Search Fields" autoFocus
              className={controlClass({ size: 'sm', tone: 'sunken' })} />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {loading && <p className="flex items-center gap-2 px-3 py-2 text-sm text-ink-800"><Spinner size="sm" /> Loading fields</p>}
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">{group.label}</p>
                {group.options.map((option) => (
                  <button key={option.key} type="button" data-dropdown-item onClick={() => { onPick(option.key); dropdown.close() }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors duration-fast ease-standard ${value === option.key ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}>
                    <span className="truncate">{option.label}</span>
                    {option.note && <span className="shrink-0 text-xs text-ink-800">{option.note}</span>}
                  </button>
                ))}
              </div>
            ))}
            {(asEvent || asAttribute) && (
              <div>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">Not Listed</p>
                {asAttribute && (
                  <button type="button" data-dropdown-item onClick={() => { onPick(`attr:${search.trim()}`); dropdown.close() }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-surface-hover">
                    Custom attribute “{search.trim()}”
                  </button>
                )}
                {asEvent && (
                  <button type="button" data-dropdown-item onClick={() => { onPick(`event:${typed}`); dropdown.close() }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-surface-hover">
                    Event type {typed}
                  </button>
                )}
              </div>
            )}
            {!loading && groups.length === 0 && !asEvent && !asAttribute && <p className="px-3 py-2 text-sm text-ink-800">No field matches.</p>}
          </div>
        </Popover>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ values

type Scalar = string | number

function ValuesInput({ values, onChange, type, suggestions, label }: { values: Scalar[]; onChange: (values: Scalar[]) => void; type: 'text' | 'number'; suggestions?: string[]; label: string }) {
  const [draft, setDraft] = useState('')
  const listId = useId()
  const add = () => {
    const text = draft.trim()
    if (!text) return
    const value: Scalar = type === 'number' ? Number(text) : text
    if (!values.some((item) => String(item).toLowerCase() === String(value).toLowerCase())) onChange([...values, value])
    setDraft('')
  }
  return (
    <div className="min-w-[180px] flex-1">
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-line-control bg-surface px-1.5 py-1 focus-within:border-focus">
        {values.map((value) => (
          <span key={String(value)} className="inline-flex h-6 items-center gap-1 rounded-sm bg-fill-subtle px-1.5 text-xs text-ink-900">
            {String(value)}
            <button type="button" aria-label={`Remove ${String(value)}`} onClick={() => onChange(values.filter((item) => item !== value))} className="text-ink-800 hover:text-ink-900">
              <X size={12} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        ))}
        <input value={draft} type={type === 'number' ? 'number' : 'text'} aria-label={label} list={suggestions?.length ? listId : undefined}
          onChange={(event) => setDraft(event.target.value)} onBlur={add}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add() } }}
          placeholder={values.length ? 'Add another' : 'Type a value and press Enter'}
          className="h-6 min-w-[120px] flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300" />
      </div>
      {suggestions?.length ? <datalist id={listId}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist> : null}
    </div>
  )
}

function ScalarInput({ value, onChange, type, suggestions, label, placeholder }: { value: Scalar | undefined; onChange: (value: string) => void; type: 'text' | 'number' | 'date'; suggestions?: string[]; label: string; placeholder?: string }) {
  const listId = useId()
  return (
    <div className="min-w-[140px] flex-1">
      <TextInput controlSize="sm" type={type} value={value === undefined ? '' : String(value)} aria-label={label} list={suggestions?.length ? listId : undefined}
        onChange={(event) => onChange(event.target.value)} placeholder={placeholder} step={type === 'number' ? 'any' : undefined} />
      {suggestions?.length ? <datalist id={listId}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist> : null}
    </div>
  )
}

function ValueEditor({ item, operator, field, onChange }: { item: ConditionItem; operator: Operator; field: ConditionField | undefined; onChange: (value: ConditionItem['value']) => void }) {
  const type = operator.type ?? field?.type ?? 'text'
  const suggestions = type === 'text' ? field?.values ?? undefined : undefined
  const values = Array.isArray(item.value) ? item.value : []
  if (operator.takes === 'none') return null
  if (operator.takes === 'days') {
    return (
      <span className="flex items-center gap-1.5">
        <Sized width="w-20"><TextInput controlSize="sm" type="number" min={1} max={MAX_DAYS} step={1} aria-label="Days" value={item.value === undefined ? '' : String(item.value)} onChange={(event) => onChange(event.target.value)} /></Sized>
        <span className="text-sm whitespace-nowrap text-ink-800">{item.op === 'older_than_days' ? 'days ago' : 'days'}</span>
      </span>
    )
  }
  if (operator.takes === 'many') return <ValuesInput values={values} onChange={onChange} type={type === 'number' ? 'number' : 'text'} suggestions={suggestions} label="Values" />
  if (operator.takes === 'two') {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <ScalarInput value={values[0]} type={type} label="From" onChange={(from) => onChange([from, values[1] ?? ''])} />
        <span className="text-sm text-ink-800">and</span>
        <ScalarInput value={values[1]} type={type} label="To" onChange={(to) => onChange([values[0] ?? '', to])} />
      </span>
    )
  }
  return <ScalarInput value={Array.isArray(item.value) ? undefined : item.value} type={type} suggestions={suggestions} label="Value" onChange={onChange} placeholder={type === 'text' ? 'Value' : undefined} />
}

// ------------------------------------------------------------------------------------------------ one row

function EventExtras({ item, field, onChange }: { item: ConditionItem; field: ConditionField | undefined; onChange: (patch: Partial<ConditionItem>) => void }) {
  const props = item.props ?? []
  const keysId = useId()
  const setProp = (index: number, patch: Partial<NonNullable<ConditionItem['props']>[number]>) => onChange({ props: props.map((prop, i) => (i === index ? { ...prop, ...patch } : prop)) })
  return (
    <div className="mt-2 space-y-2 pl-3">
      <label className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-800">
        within the last
        <Sized width="w-20"><TextInput controlSize="sm" type="number" min={1} max={MAX_DAYS} step={1} aria-label="Within Days" value={item.days === undefined ? '' : String(item.days)}
          onChange={(event) => onChange({ days: event.target.value === '' ? '' : Number(event.target.value) })} placeholder="any" /></Sized>
        days
      </label>
      {props.map((prop, index) => {
        const operator = PROPERTY_OPERATORS.find((op) => op.value === prop.op)
        return (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-ink-800">where</span>
            <Sized width="w-32"><TextInput controlSize="sm" aria-label="Property" list={field?.properties?.length ? keysId : undefined} value={prop.key} onChange={(event) => setProp(index, { key: event.target.value })} placeholder="property" /></Sized>
            <Sized width="w-36">
              <Select controlSize="sm" aria-label="Property Operator" value={prop.op} onChange={(event) => setProp(index, { op: event.target.value, value: undefined })}>
                <option value="">Compare…</option>
                {PROPERTY_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
              </Select>
            </Sized>
            {operator && operator.takes !== 'none' && (
              operator.takes === 'many'
                ? <ValuesInput values={Array.isArray(prop.value) ? prop.value : []} onChange={(value) => setProp(index, { value })} type={operator.type === 'number' ? 'number' : 'text'} label="Property Values" />
                : operator.takes === 'two'
                  ? <span className="flex items-center gap-1.5">
                      <Sized width="w-20"><TextInput controlSize="sm" type="number" step="any" aria-label="Property From" value={Array.isArray(prop.value) ? String(prop.value[0] ?? '') : ''} onChange={(event) => setProp(index, { value: [event.target.value, Array.isArray(prop.value) ? prop.value[1] ?? '' : ''] })} /></Sized>
                      <span className="text-sm text-ink-800">and</span>
                      <Sized width="w-20"><TextInput controlSize="sm" type="number" step="any" aria-label="Property To" value={Array.isArray(prop.value) ? String(prop.value[1] ?? '') : ''} onChange={(event) => setProp(index, { value: [Array.isArray(prop.value) ? prop.value[0] ?? '' : '', event.target.value] })} /></Sized>
                    </span>
                  : <Sized width="w-36"><TextInput controlSize="sm" type={operator.type === 'number' ? 'number' : 'text'} step="any" aria-label="Property Value" value={Array.isArray(prop.value) ? '' : String(prop.value ?? '')} onChange={(event) => setProp(index, { value: event.target.value })} /></Sized>
            )}
            <button type="button" aria-label="Remove Property Filter" onClick={() => onChange({ props: props.filter((_prop, i) => i !== index) })} className="text-ink-800 hover:text-ink-900">
              <X size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        )
      })}
      {field?.properties?.length ? <datalist id={keysId}>{field.properties.map((key) => <option key={key} value={key} />)}</datalist> : null}
      {props.length < 10 && (
        <button type="button" onClick={() => onChange({ props: [...props, { key: '', op: 'is' }] })} className={linkButton}>
          <Plus size={14} strokeWidth={1.5} aria-hidden /> Add Property Filter
        </button>
      )}
    </div>
  )
}

function ConditionRow({ item, onChange, onRemove, catalogue, loading, steps, atEntry }: {
  item: ConditionItem; onChange: (item: ConditionItem) => void; onRemove: () => void
  catalogue: ConditionFieldCatalogue | undefined; loading: boolean; steps: JourneyStepOption[]; atEntry: boolean
}) {
  const operators = operatorsFor(item.field, catalogue)
  const operator = operatorOf(item.field, item.op, catalogue)
  const field = lookupField(item.field, catalogue)
  const kind = fieldKind(item.field)?.kind
  const problem = item.field && item.op ? conditionProblem(item, catalogue, atEntry) : null
  const pickField = (key: string) => {
    const next = operatorsFor(key, catalogue)
    const keep = next.some((op) => op.value === item.op) ? item.op : next.length === 1 || fieldKind(key)?.kind === 'event' || fieldKind(key)?.kind === 'list' || fieldKind(key)?.kind === 'segment' ? next[0].value : ''
    onChange({ field: key, op: keep, ...(fieldKind(key)?.kind === 'event' ? { props: [] } : {}) })
  }
  const pickOperator = (op: string) => {
    const next = operatorOf(item.field, op, catalogue)
    const previous = operator
    const keepValue = next && previous && next.takes === previous.takes && next.type === previous.type
    onChange({ ...item, op, value: keepValue ? item.value : undefined })
  }
  return (
    <div data-condition-row className="rounded-control-lg border border-line p-2">
      <div className="flex items-start gap-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <FieldPicker value={item.field} onPick={pickField} catalogue={catalogue} loading={loading} steps={steps} atEntry={atEntry} />
        {item.field && (
          <Select controlSize="sm" className="min-w-[150px] flex-1" aria-label="Operator" value={item.op} onChange={(event) => pickOperator(event.target.value)}>
            <option value="">Compare…</option>
            {operators.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
          </Select>
        )}
        {operator && <ValueEditor item={item} operator={operator} field={field} onChange={(value) => onChange({ ...item, value })} />}
      </div>
        <button type="button" aria-label="Remove Condition" onClick={onRemove} className="mt-2 shrink-0 text-ink-800 hover:text-ink-900">
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      {kind === 'event' && operator && <EventExtras item={item} field={field} onChange={(patch) => onChange({ ...item, ...patch })} />}
      {problem && <p className="mt-1.5 text-xs font-medium text-danger-text">{problem}</p>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ a group and the builder

function AllAny({ value, onChange, lead }: { value: boolean; onChange: (all: boolean) => void; lead: string }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-900">
      {lead}
      <span className="inline-block w-20">
        <Select controlSize="sm" aria-label="All or Any" value={value ? 'ALL' : 'ANY'} onChange={(event) => onChange(event.target.value === 'ALL')}>
          <option value="ALL">All</option>
          <option value="ANY">Any</option>
        </Select>
      </span>
      of these are true
    </p>
  )
}

function GroupEditor({ group, onChange, onRemove, lead, depth, total, catalogue, loading, steps, atEntry }: {
  group: ConditionRule; onChange: (group: ConditionRule) => void; onRemove?: () => void; lead: string; depth: number; total: number
  catalogue: ConditionFieldCatalogue | undefined; loading: boolean; steps: JourneyStepOption[]; atEntry: boolean
}) {
  const setAt = (index: number, next: ConditionItem | ConditionRule) => onChange({ ...group, conditions: group.conditions.map((item, i) => (i === index ? next : item)) })
  const removeAt = (index: number) => onChange({ ...group, conditions: group.conditions.filter((_item, i) => i !== index) })
  const full = total >= MAX_CONDITIONS
  return (
    <div className={depth > 0 ? 'rounded-control-lg border border-line bg-surface-subtle p-2' : ''}>
      <div className="flex items-center justify-between gap-2">
        <AllAny value={group.all} onChange={(all) => onChange({ ...group, all })} lead={lead} />
        {onRemove && (
          <button type="button" aria-label="Remove Group" onClick={onRemove} className="shrink-0 text-ink-800 hover:text-ink-900">
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-2 space-y-2">
        {group.conditions.map((item, index) => isGroup(item)
          ? <GroupEditor key={index} group={item} onChange={(next) => setAt(index, next)} onRemove={() => removeAt(index)} lead="" depth={depth + 1} total={total} catalogue={catalogue} loading={loading} steps={steps} atEntry={atEntry} />
          : <ConditionRow key={index} item={item} onChange={(next) => setAt(index, next)} onRemove={() => removeAt(index)} catalogue={catalogue} loading={loading} steps={steps} atEntry={atEntry} />)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <button type="button" disabled={full} onClick={() => onChange({ ...group, conditions: [...group.conditions, emptyCondition()] })} className={linkButton}>
          <Plus size={14} strokeWidth={1.5} aria-hidden /> Add Condition
        </button>
        {depth === 0 && (
          <button type="button" disabled={full} onClick={() => onChange({ ...group, conditions: [...group.conditions, emptyRule(!group.all)] })} className={linkButton}>
            <Plus size={14} strokeWidth={1.5} aria-hidden /> Add Group
          </button>
        )}
        {full && <span className="text-xs text-ink-800">At most {MAX_CONDITIONS} conditions.</span>}
      </div>
    </div>
  )
}

export function ConditionBuilder({ rule, onChange, lead, steps = [], atEntry, readBackLead }: {
  rule: ConditionRule; onChange: (rule: ConditionRule) => void
  /** before the All / Any choice: "Yes when", "Enter when", "Only customers where" */
  lead: string
  steps?: JourneyStepOption[]
  /** entry filters and the attribute trigger: no fields about this journey */
  atEntry: boolean
  /** before the read-back sentence: "Yes when", "Customers enter when" */
  readBackLead: string
}) {
  const fields = useConditionFields()
  const sentence = describeRule(rule, fields.data, steps)
  return (
    <div className="space-y-3">
      <GroupEditor group={rule} onChange={onChange} lead={lead} depth={0} total={countConditions(rule)} catalogue={fields.data} loading={fields.isPending} steps={steps} atEntry={atEntry} />
      {sentence && <p data-read-back className="text-sm text-ink-800">{readBackLead} {sentence}.</p>}
      {fields.isError && <p className="text-xs text-danger-text">The workspace’s fields could not be loaded; the rule can still be written by name.</p>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ Match on Entry

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** "1,284 of the 3,412 customers in this journey would answer Yes right now." (a journey), or "218 of 12,400 customers
 * would enter now." (Setup). Counted while the rule is complete, a moment after the last change. */
export function MatchCount({ rule, filters, journeyId, ready, wording }: {
  rule: ConditionRule | null; filters?: ConditionRule | null; journeyId?: string; ready: boolean
  wording: 'answer' | 'enter' | 'match'
}) {
  const fields = useConditionFields()
  const body = JSON.stringify({ rule: rule ? normalizeRule(rule, fields.data) : null, filters: filters ? normalizeRule(filters, fields.data) : null })
  const settled = useDebounced(body, 600)
  const count = useQuery({
    queryKey: ['journeys', 'condition-count', journeyId ?? 'workspace', settled],
    queryFn: () => api.post<ConditionCount>(journeyId ? `/journeys/${journeyId}/condition-count/` : '/journeys/condition-count/', JSON.parse(settled)),
    enabled: ready && settled === body,
    retry: false,
  })
  if (!ready) return null
  let text: string
  if (count.isPending) text = 'Counting who matches right now…'
  else if (count.isError) text = 'The count is not available right now.'
  else if (journeyId && count.data.total === 0) text = 'No one is in this journey yet, so there is nothing to count.'
  else {
    const { matching, total, sampled } = count.data
    const of = journeyId ? `of the ${formatNumber(total)}${sampled ? ' newest' : ''} customers in this journey` : `of ${formatNumber(total)} customers`
    text = wording === 'answer' ? `${formatNumber(matching)} ${of} would answer Yes right now.`
      : wording === 'enter' ? `${formatNumber(matching)} ${of} would enter now.`
      : `${formatNumber(matching)} ${of} match these filters now.`
  }
  return (
    <p data-match-count className="flex items-start gap-2 text-sm text-ink-800">
      <span className="mt-px shrink-0 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-xs font-semibold text-ink-900">Match on Entry</span>
      <span>{text}</span>
    </p>
  )
}
