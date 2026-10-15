/** The smaller steps' panels and their words: Update Profile (any attribute), Add to / Remove from List, and Split (by an
 * attribute's value, or at random). The configs they write are what apps/journeys/extras.py reads. */
import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'

import { Field, Select, TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { api } from '@/lib/api'
import type { ContactList, Page } from '@/lib/types'

import { useConditionFields } from './conditions/ConditionBuilder'
import { titleFromKey } from './conditions/conditionModel'

export const OTHERWISE = 'OTHERWISE'
export const MAX_PATHS = 6
const ATTRIBUTE_KEY = /^[A-Za-z0-9_ .-]{1,100}$/

export interface SplitPath {
  key: string
  label: string
  values?: (string | number)[]
  share?: number | string
}

export function splitPaths(config: Record<string, unknown>): SplitPath[] {
  return Array.isArray(config.paths) ? (config.paths as SplitPath[]) : []
}

export function splitMode(config: Record<string, unknown>): 'ATTRIBUTE' | 'RANDOM' {
  return String(config.by ?? 'ATTRIBUTE').toUpperCase() === 'RANDOM' ? 'RANDOM' : 'ATTRIBUTE'
}

export function emptySplit(): Record<string, unknown> {
  return { by: 'ATTRIBUTE', attribute: '', paths: [{ key: 'P1', label: '', values: [] }] }
}

/** A split's branch keys in canvas order: its paths, then Everyone Else (attribute splits). */
export function splitBranchKeys(config: Record<string, unknown>): string[] {
  const keys = splitPaths(config).map((path) => String(path.key ?? '').toUpperCase())
  return splitMode(config) === 'ATTRIBUTE' ? [...keys, OTHERWISE] : keys
}

export function splitBranchLabels(config: Record<string, unknown>): Record<string, string> {
  const labels = Object.fromEntries(splitPaths(config).map((path) => [String(path.key ?? '').toUpperCase(), (path.label || String(path.key)).toUpperCase()]))
  return splitMode(config) === 'ATTRIBUTE' ? { ...labels, [OTHERWISE]: 'EVERYONE ELSE' } : labels
}

/** What a step still needs before it can be saved, or null (an untouched step is left to readiness). */
export function extraProblem(type: string, config: Record<string, unknown>): string | null {
  if (type === 'PROFILE_UPDATE') {
    const attribute = String(config.attribute ?? '')
    if (attribute && !ATTRIBUTE_KEY.test(attribute.trim())) return 'The attribute’s name is letters, digits, spaces, dots, dashes and underscores.'
    if (String(config.value ?? '').length > 200) return 'The value is at most 200 characters.'
    return null
  }
  if (type === 'SPLIT') {
    const paths = splitPaths(config)
    if (paths.length < 1 || paths.length > MAX_PATHS) return `A split has 1 to ${MAX_PATHS} paths besides Everyone Else.`
    const keys = new Set<string>()
    let total = 0
    for (const path of paths) {
      const key = String(path.key ?? '').toUpperCase()
      if (!/^[A-Z0-9_]{1,50}$/.test(key) || key === OTHERWISE || keys.has(key)) return 'Each path needs its own key.'
      keys.add(key)
      if (splitMode(config) === 'ATTRIBUTE') {
        if (!Array.isArray(path.values) || path.values.length === 0) return `Add the values that take the ${path.label || key} path.`
      } else {
        const share = Number(path.share)
        if (!Number.isFinite(share) || share <= 0) return 'Each path has a share above 0.'
        total += share
      }
    }
    if (splitMode(config) === 'RANDOM' && Math.abs(total - 100) > 0.01) return `The shares add up to ${total}, not 100.`
    return null
  }
  return null
}

export function isExtraConfigured(type: string, config: Record<string, unknown>): boolean {
  if (type === 'PROFILE_UPDATE') return String(config.attribute ?? '').trim() !== '' && String(config.value ?? '').trim() !== '' && extraProblem(type, config) === null
  if (type === 'LIST_ADD' || type === 'LIST_REMOVE') return Boolean(config.contact_list_id)
  if (type === 'SPLIT') return (splitMode(config) === 'RANDOM' || String(config.attribute ?? '').trim() !== '') && extraProblem(type, config) === null
  return true
}

/** The card's line. */
export function summarizeExtra(type: string, config: Record<string, unknown>): string {
  if (type === 'PROFILE_UPDATE') {
    const attribute = String(config.attribute ?? '').trim()
    return attribute ? `Set ${titleFromKey(attribute)} to ${String(config.value ?? '') || '?'}` : 'No attribute chosen'
  }
  if (type === 'LIST_ADD') return config.contact_list_name ? `Add to ${String(config.contact_list_name)}` : 'No list chosen'
  if (type === 'LIST_REMOVE') return config.contact_list_name ? `Remove from ${String(config.contact_list_name)}` : 'No list chosen'
  if (type === 'SPLIT') {
    const n = splitPaths(config).length
    if (splitMode(config) === 'RANDOM') return `Split at random, ${n} path${n === 1 ? '' : 's'}`
    const attribute = String(config.attribute ?? '').trim()
    return attribute ? `Split by ${titleFromKey(attribute)}, ${n + 1} paths` : 'No attribute chosen'
  }
  return ''
}

/** Numbers typed as text become numbers, keys are upper case: what PUT sends. */
export function normalizeExtra(type: string, config: Record<string, unknown>): Record<string, unknown> {
  if (type !== 'SPLIT') return config
  const mode = splitMode(config)
  const paths = splitPaths(config).map((path, index) => ({
    key: String(path.key || `P${index + 1}`).toUpperCase(), label: String(path.label ?? '').trim() || `Path ${index + 1}`,
    ...(mode === 'ATTRIBUTE' ? { values: (path.values ?? []).map(String) } : { share: Number(path.share) }),
  }))
  const { attribute: _attribute, ...rest } = config
  return { ...rest, by: mode, ...(mode === 'ATTRIBUTE' ? { attribute: String(config.attribute ?? '').trim() } : {}), paths }
}

type SetFn = (patch: Record<string, unknown>) => void

/** A comma-separated list typed freely: the text stays as typed (spaces and a trailing comma included) while the values
 * behind it are the trimmed, non-empty parts. */
export function ValuesText({ values, onChange, label, placeholder, className }: { values: (string | number)[]; onChange: (values: string[]) => void; label: string; placeholder?: string; className?: string }) {
  const [text, setText] = useState(values.map(String).join(', '))
  const [known, setKnown] = useState(values.map(String).join(', '))
  const joined = values.map(String).join(', ')
  if (joined !== known) {                                  // changed from outside (a mode switch, a reset): show it
    setKnown(joined)
    setText(joined)
  }
  return (
    <TextInput controlSize="sm" aria-label={label} value={text} placeholder={placeholder} className={className}
      onChange={(event) => {
        const next = event.target.value
        const parsed = next.split(',').map((item) => item.trim()).filter(Boolean)
        setText(next)
        setKnown(parsed.join(', '))
        onChange(parsed)
      }} />
  )
}

function AttributePicker({ value, onChange, label, hint }: { value: string; onChange: (value: string) => void; label: string; hint?: string }) {
  const fields = useConditionFields()
  const listId = useId()
  const known = fields.data?.attributes ?? []
  return (
    <Field label={label} required hint={hint ?? (fields.data ? 'An attribute on the customer’s record; type a new name to add one.' : undefined)}>
      {(ids) => (
        <>
          <TextInput {...ids} value={value} list={known.length ? listId : undefined} onChange={(event) => onChange(event.target.value)} placeholder="e.g. customer_status" />
          {known.length > 0 && <datalist id={listId}>{known.map((item) => <option key={item.key} value={item.key.slice(5)}>{item.label}</option>)}</datalist>}
        </>
      )}
    </Field>
  )
}

export function ProfileFields({ config, set }: { config: Record<string, unknown>; set: SetFn }) {
  const fields = useConditionFields()
  const attribute = String(config.attribute ?? '')
  const known = fields.data?.attributes.find((item) => item.key === `attr:${attribute.trim()}`)
  const problem = extraProblem('PROFILE_UPDATE', config)
  return (
    <div className="space-y-4">
      <AttributePicker value={attribute} onChange={(value) => set({ attribute: value })} label="Attribute" />
      <Field label="Set To" required error={problem ?? undefined} hint={known?.values?.length ? `Values today: ${known.values.join(', ')}.` : 'Text or a number; Update Loyalty Tier stays the step for the tier.'}>
        {(ids) => <TextInput {...ids} value={String(config.value ?? '')} maxLength={200} onChange={(event) => set({ value: event.target.value })} placeholder="e.g. Welcomed" />}
      </Field>
    </div>
  )
}

export function ListFields({ type, config, set }: { type: 'LIST_ADD' | 'LIST_REMOVE'; config: Record<string, unknown>; set: SetFn }) {
  const lists = useQuery({ queryKey: ['contact-lists', 'journey-setup-options'], queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { page_size: 200 }, signal) })
  return (
    <Field label="Contact List" required hint={type === 'LIST_ADD' ? 'The customer joins the list when they reach this step.' : 'The customer leaves the list when they reach this step.'}>
      {(ids) =>
        lists.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading contact lists</p>
        : lists.isError ? <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
        : (
          <Select {...ids} value={String(config.contact_list_id ?? '')} onChange={(event) => set({ contact_list_id: event.target.value, contact_list_name: lists.data?.results.find((item) => item.id === event.target.value)?.name })}>
            <option value="">Choose a List</option>
            {(lists.data?.results ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        )}
    </Field>
  )
}

const MODES: { value: 'ATTRIBUTE' | 'RANDOM'; label: string }[] = [{ value: 'ATTRIBUTE', label: 'By an Attribute' }, { value: 'RANDOM', label: 'At Random' }]

export function SplitFields({ config, set, usedKeys }: { config: Record<string, unknown>; set: SetFn; usedKeys: string[] }) {
  const mode = splitMode(config)
  const paths = splitPaths(config)
  const fields = useConditionFields()
  const attribute = String(config.attribute ?? '')
  const known = fields.data?.attributes.find((item) => item.key === `attr:${attribute.trim()}`)
  const setPath = (index: number, patch: Partial<SplitPath>) => set({ paths: paths.map((path, i) => (i === index ? { ...path, ...patch } : path)) })
  const nextKey = () => {
    let n = paths.length + 1
    while (paths.some((path) => path.key === `P${n}`)) n += 1
    return `P${n}`
  }
  const problem = extraProblem('SPLIT', config)
  const total = paths.reduce((sum, path) => sum + (Number(path.share) || 0), 0)
  return (
    <div className="space-y-4">
      <div>
        <p className="block text-sm font-medium text-ink-800">Split</p>
        <div className="mt-1">
          <SegmentedControl label="How to split" variant="solid" stretch options={MODES} value={mode}
            onChange={(next) => set({ by: next, paths: paths.map((path) => (next === 'RANDOM' ? { key: path.key, label: path.label, share: path.share ?? Math.round(100 / paths.length) } : { key: path.key, label: path.label, values: path.values ?? [] })) })} />
        </div>
      </div>
      {mode === 'ATTRIBUTE' && <AttributePicker value={attribute} onChange={(value) => set({ attribute: value })} label="Attribute" hint="Each customer takes the first path whose values hold theirs; everyone else takes the last path." />}
      <div>
        <p className="block text-sm font-medium text-ink-800">Paths</p>
        <div className="mt-1 space-y-2">
          {paths.map((path, index) => {
            const holdsSteps = usedKeys.includes(String(path.key).toUpperCase())
            return (
              <div key={path.key} className="rounded-control-lg border border-line p-2" data-split-path={path.key}>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-36"><TextInput controlSize="sm" aria-label={`Path ${index + 1} Name`} value={path.label ?? ''} onChange={(event) => setPath(index, { label: event.target.value })} placeholder={`Path ${index + 1}`} /></span>
                  {mode === 'RANDOM' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-20"><TextInput controlSize="sm" type="number" min={1} max={100} step={1} aria-label={`Path ${index + 1} Share`} value={String(path.share ?? '')} onChange={(event) => setPath(index, { share: event.target.value })} /></span>
                      <span className="text-sm text-ink-800">%</span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1"><ValuesText label={`Path ${index + 1} Values`} values={path.values ?? []} placeholder="values, comma separated" onChange={(values) => setPath(index, { values })} /></span>
                  )}
                  <button type="button" aria-label={`Remove Path ${index + 1}`} disabled={paths.length <= 1 || holdsSteps} title={holdsSteps ? 'Remove the steps on this path first.' : undefined}
                    onClick={() => set({ paths: paths.filter((_path, i) => i !== index) })} className="ml-auto shrink-0 text-ink-800 hover:text-ink-900 disabled:text-ink-300">
                    <X size={16} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
                {mode === 'ATTRIBUTE' && known?.values?.length ? <p className="mt-1 text-xs text-ink-800">Values today: {known.values.join(', ')}.</p> : null}
              </div>
            )
          })}
          {mode === 'ATTRIBUTE' && <p className="rounded-control-lg border border-line-subtle bg-surface-subtle px-2 py-1.5 text-sm text-ink-800">Everyone else · the last path, always there</p>}
          {paths.length < MAX_PATHS && (
            <button type="button" onClick={() => set({ paths: [...paths, mode === 'RANDOM' ? { key: nextKey(), label: '', share: '' } : { key: nextKey(), label: '', values: [] }] })}
              className="inline-flex items-center gap-1 text-sm font-medium text-link hover:text-brand-700">
              <Plus size={14} strokeWidth={1.5} aria-hidden /> Add Path
            </button>
          )}
        </div>
        {mode === 'RANDOM' && <p className={`mt-1 text-xs ${Math.abs(total - 100) > 0.01 ? 'text-danger-text' : 'text-ink-800'}`}>Shares add up to {total}%. Chosen once per customer and kept on retry.</p>}
        {problem && mode === 'ATTRIBUTE' && <p className="mt-1 text-xs font-medium text-danger-text">{problem}</p>}
      </div>
    </div>
  )
}
