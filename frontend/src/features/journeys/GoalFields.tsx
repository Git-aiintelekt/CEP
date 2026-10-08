/** The Goal step's panel: the event that counts as reached (with filters on its data), the attribution window from entering,
 * and what happens when it is reached. The config it writes is what apps/journeys/goals.py reads. */
import { Plus, X } from 'lucide-react'
import { useId } from 'react'

import { Field, Select, TextInput } from '@/components/Form'
import { formatNumber } from '@/lib/format'
import type { ConditionItem } from '@/lib/types'

import { useConditionFields } from './conditions/ConditionBuilder'
import { PROPERTY_OPERATORS, titleFromKey } from './conditions/conditionModel'
import { ValuesText } from './ExtraStepFields'
import { RadioCard } from './RadioCard'

export const MAX_WINDOW = 365
const WINDOWS = [1, 3, 7, 14, 21, 30, 45, 60, 90, 180, 365]
type Prop = NonNullable<ConditionItem['props']>[number]

export function goalProps(config: Record<string, unknown>): Prop[] {
  return Array.isArray(config.props) ? (config.props as Prop[]) : []
}

export function goalContinues(config: Record<string, unknown>): boolean {
  return String(config.when_reached ?? 'EXIT').toUpperCase() === 'CONTINUE'
}

/** What the goal still needs before it can be saved, or null (no event yet is left to readiness). */
export function goalProblem(config: Record<string, unknown>): string | null {
  const eventType = String(config.event_type ?? '').trim()
  if (eventType && !/^[A-Z][A-Z0-9_]{1,59}$/.test(eventType)) return 'An event type is capital letters, digits and underscores, starting with a letter.'
  const window = Number(config.window_days ?? 30)
  if (!Number.isInteger(window) || window < 1 || window > MAX_WINDOW) return `A whole number of days from 1 to ${MAX_WINDOW}.`
  for (const prop of goalProps(config)) {
    if (!prop.key.trim()) return 'Name the event property to filter on.'
    const operator = PROPERTY_OPERATORS.find((op) => op.value === prop.op)
    if (!operator) return 'Choose how to compare the property.'
    if (operator.takes === 'one' && (prop.value === undefined || prop.value === '')) return 'Enter the property value.'
    if (operator.takes === 'many' && !(Array.isArray(prop.value) && prop.value.length > 0)) return 'Add at least one property value.'
    if (operator.takes === 'two' && !(Array.isArray(prop.value) && prop.value.length === 2)) return 'Enter both numbers.'
  }
  return null
}

export function isGoalConfigured(config: Record<string, unknown>): boolean {
  return String(config.event_type ?? '').trim() !== '' && goalProblem(config) === null
}

/** "Purchase within 14 days of entering": the card's line. */
export function summarizeGoal(config: Record<string, unknown>, eventLabel?: string): string {
  const eventType = String(config.event_type ?? '').trim()
  if (!eventType) return 'No goal event chosen'
  const props = goalProps(config)
  const filtered = props.length ? ` with ${props.length} filter${props.length === 1 ? '' : 's'}` : ''
  return `${eventLabel ?? titleFromKey(eventType)}${filtered} within ${Number(config.window_days ?? 30)} days of entering`
}

/** Numbers typed as text become numbers: what PUT sends. */
export function normalizeGoal(config: Record<string, unknown>): Record<string, unknown> {
  const number = (value: string | number) => (Number.isFinite(Number(value)) && String(value).trim() !== '' ? Number(value) : value)
  const props = goalProps(config).map((prop) => {
    const operator = PROPERTY_OPERATORS.find((op) => op.value === prop.op)
    const numeric = operator?.type === 'number'
    const cleaned: Prop = { key: prop.key.trim(), op: prop.op }
    if (operator && operator.takes !== 'none') cleaned.value = Array.isArray(prop.value) ? prop.value.map((value) => (numeric ? number(value) : value)) : numeric && prop.value !== undefined ? number(prop.value) : prop.value
    return cleaned
  })
  const { props: _props, ...rest } = config
  return { ...rest, event_type: String(config.event_type ?? '').trim().toUpperCase(), window_days: Number(config.window_days ?? 30), when_reached: goalContinues(config) ? 'CONTINUE' : 'EXIT', ...(props.length ? { props } : {}) }
}

type SetFn = (patch: Record<string, unknown>) => void

export function GoalFields({ config, set, insideBranch, hasBranchSteps }: { config: Record<string, unknown>; set: SetFn; insideBranch: boolean; hasBranchSteps: boolean }) {
  const fields = useConditionFields()
  const eventType = String(config.event_type ?? '')
  const known = fields.data?.events ?? []
  const chosen = known.find((item) => item.key === `event:${eventType}`)
  const options = eventType && !chosen ? [...known, { key: `event:${eventType}`, label: titleFromKey(eventType), seen: 0, properties: [] }] : known
  const props = goalProps(config)
  const window = Number(config.window_days ?? 30)
  const windows = WINDOWS.includes(window) ? WINDOWS : [...WINDOWS, window].sort((a, b) => a - b)
  const continues = goalContinues(config)
  const keysId = useId()
  const setProp = (index: number, patch: Partial<Prop>) => set({ props: props.map((prop, i) => (i === index ? { ...prop, ...patch } : prop)) })
  const problem = goalProblem(config)
  return (
    <div className="space-y-4">
      <Field label="Counts as Reached When" required hint={fields.isError ? 'The workspace’s events could not be loaded; type the event type.' : 'Any event of this type; add filters on its data below if needed.'}>
        {(ids) => fields.data || fields.isError ? (
          <Select {...ids} value={eventType} onChange={(event) => set({ event_type: event.target.value })}>
            <option value="">Choose an Event</option>
            {options.map((item) => <option key={item.key} value={item.key.slice(6)}>{item.label}{item.seen ? ` · ${formatNumber(item.seen)} in 90 days` : ''}</option>)}
            <option value="__other">Another event type…</option>
          </Select>
        ) : <p className="text-sm text-ink-800">Loading events…</p>}
      </Field>
      {eventType === '__other' && (
        <Field label="Event Type" required hint="Capital letters, digits and underscores, as the event is sent.">
          {(ids) => <TextInput {...ids} value="" onChange={(event) => set({ event_type: event.target.value.toUpperCase().replace(/[\s-]+/g, '_') })} placeholder="e.g. BOOKING_MADE" autoFocus />}
        </Field>
      )}
      {eventType && eventType !== '__other' && !/^[A-Z][A-Z0-9_]{1,59}$/.test(eventType) && (
        <Field label="Event Type" required hint="Capital letters, digits and underscores, as the event is sent." error={problem ?? undefined}>
          {(ids) => <TextInput {...ids} value={eventType} onChange={(event) => set({ event_type: event.target.value.toUpperCase().replace(/[\s-]+/g, '_') })} />}
        </Field>
      )}

      {eventType && eventType !== '__other' && (
        <div>
          <p className="text-sm font-medium text-ink-800">Filters on the Event</p>
          <div className="mt-1 space-y-2">
            {props.map((prop, index) => {
              const operator = PROPERTY_OPERATORS.find((op) => op.value === prop.op)
              return (
                <div key={index} className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-block w-32"><TextInput controlSize="sm" aria-label="Property" list={chosen?.properties?.length ? keysId : undefined} value={prop.key} onChange={(event) => setProp(index, { key: event.target.value })} placeholder="property" /></span>
                  <span className="inline-block w-36">
                    <Select controlSize="sm" aria-label="Property Operator" value={prop.op} onChange={(event) => setProp(index, { op: event.target.value, value: undefined })}>
                      <option value="">Compare…</option>
                      {PROPERTY_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </Select>
                  </span>
                  {operator && operator.takes === 'one' && (
                    <span className="inline-block w-32"><TextInput controlSize="sm" type={operator.type === 'number' ? 'number' : 'text'} step="any" aria-label="Property Value" value={Array.isArray(prop.value) ? '' : String(prop.value ?? '')} onChange={(event) => setProp(index, { value: event.target.value })} /></span>
                  )}
                  {operator && operator.takes === 'two' && (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-20"><TextInput controlSize="sm" type="number" step="any" aria-label="Property From" value={Array.isArray(prop.value) ? String(prop.value[0] ?? '') : ''} onChange={(event) => setProp(index, { value: [event.target.value, Array.isArray(prop.value) ? prop.value[1] ?? '' : ''] })} /></span>
                      <span className="text-sm text-ink-800">and</span>
                      <span className="inline-block w-20"><TextInput controlSize="sm" type="number" step="any" aria-label="Property To" value={Array.isArray(prop.value) ? String(prop.value[1] ?? '') : ''} onChange={(event) => setProp(index, { value: [Array.isArray(prop.value) ? prop.value[0] ?? '' : '', event.target.value] })} /></span>
                    </span>
                  )}
                  {operator && operator.takes === 'many' && (
                    <span className="inline-block w-40"><ValuesText label="Property Values" values={Array.isArray(prop.value) ? prop.value : []} placeholder="a, b, c" onChange={(value) => setProp(index, { value })} /></span>
                  )}
                  <button type="button" aria-label="Remove Filter" onClick={() => set({ props: props.filter((_prop, i) => i !== index) })} className="text-ink-800 hover:text-ink-900">
                    <X size={16} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              )
            })}
            {chosen?.properties?.length ? <datalist id={keysId}>{chosen.properties.map((key) => <option key={key} value={key} />)}</datalist> : null}
            {props.length < 10 && (
              <button type="button" onClick={() => set({ props: [...props, { key: '', op: 'is' }] })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                <Plus size={14} strokeWidth={1.5} aria-hidden /> Add Filter
              </button>
            )}
          </div>
        </div>
      )}

      <Field label="Attribution Window" required hint="How long after entering the journey the event still counts.">
        {(ids) => (
          <Select {...ids} value={String(window)} onChange={(event) => set({ window_days: Number(event.target.value) })}>
            {windows.map((days) => <option key={days} value={days}>{days} day{days === 1 ? '' : 's'} from entering</option>)}
          </Select>
        )}
      </Field>

      <div>
        <p className="text-sm font-medium text-ink-800">When Reached</p>
        <div className="mt-1 space-y-2" role="radiogroup" aria-label="When Reached">
          <RadioCard name="goal-when" checked={!continues} onSelect={() => set({ when_reached: 'EXIT' })} title="Mark converted and exit"
            description={hasBranchSteps ? 'Remove the steps on the Reached and Not Yet paths first.' : 'Counts in Converted; the customer leaves wherever they are.'} />
          <RadioCard name="goal-when" checked={continues} onSelect={() => set({ when_reached: 'CONTINUE' })} title="Mark converted and continue on the Reached path"
            description={insideBranch ? 'Not inside another step’s branch: keep a Goal with paths on the main journey.' : 'A thank-you or review request can follow; everyone else takes the Not Yet path.'} />
        </div>
      </div>
      <p className="text-xs text-ink-800">Checked when the customer reaches this step, and again whenever a matching event arrives while they are in the journey.</p>
      {problem && eventType && eventType !== '__other' && /^[A-Z][A-Z0-9_]{1,59}$/.test(eventType) && <p className="text-xs font-medium text-danger-text">{problem}</p>}
    </div>
  )
}
