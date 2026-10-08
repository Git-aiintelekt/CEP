/** The condition rule's vocabulary on the client, mirroring apps/journeys/conditions.py: which operators each field
 * kind allows, what a row still needs before it can be saved, and the read-back sentence under the builder
 * ("Yes when the customer's loyalty tier is Gold or Platinum, and the Welcome email was delivered and not opened"). */
import type { ConditionField, ConditionFieldCatalogue, ConditionItem, ConditionRule } from '@/lib/types'

export type FieldKind = 'customer' | 'attr' | 'message' | 'step' | 'event' | 'list' | 'segment'
export type ValueType = 'text' | 'number' | 'date'

export interface Operator {
  value: string
  label: string
  /** what the value box holds: nothing, one value, a list of values, two (between), or a number of days */
  takes: 'none' | 'one' | 'many' | 'two' | 'days'
  /** attributes: the operator decides whether the attribute is read as text, a number or a date */
  type?: ValueType
}

export const TEXT_OPERATORS: Operator[] = [
  { value: 'is', label: 'is', takes: 'one', type: 'text' },
  { value: 'is_not', label: 'is not', takes: 'one', type: 'text' },
  { value: 'in', label: 'is any of', takes: 'many', type: 'text' },
  { value: 'not_in', label: 'is none of', takes: 'many', type: 'text' },
  { value: 'contains', label: 'contains', takes: 'one', type: 'text' },
  { value: 'not_contains', label: 'does not contain', takes: 'one', type: 'text' },
  { value: 'starts_with', label: 'starts with', takes: 'one', type: 'text' },
  { value: 'is_set', label: 'is set', takes: 'none' },
  { value: 'is_not_set', label: 'is not set', takes: 'none' },
]
export const NUMBER_OPERATORS: Operator[] = [
  { value: 'eq', label: 'equals', takes: 'one', type: 'number' },
  { value: 'neq', label: 'does not equal', takes: 'one', type: 'number' },
  { value: 'gte', label: 'is at least', takes: 'one', type: 'number' },
  { value: 'lte', label: 'is at most', takes: 'one', type: 'number' },
  { value: 'between', label: 'is between', takes: 'two', type: 'number' },
  { value: 'is_set', label: 'is set', takes: 'none' },
  { value: 'is_not_set', label: 'is not set', takes: 'none' },
]
export const DATE_OPERATORS: Operator[] = [
  { value: 'within_days', label: 'is within the last', takes: 'days' },
  { value: 'older_than_days', label: 'is more than', takes: 'days' },
  { value: 'before', label: 'is before', takes: 'one', type: 'date' },
  { value: 'after', label: 'is after', takes: 'one', type: 'date' },
  { value: 'between_dates', label: 'is between', takes: 'two', type: 'date' },
  { value: 'is_set', label: 'is set', takes: 'none' },
  { value: 'is_not_set', label: 'is not set', takes: 'none' },
]
export const MESSAGE_OPERATORS: Operator[] = [
  { value: 'sent', label: 'was sent', takes: 'none' },
  { value: 'delivered', label: 'was delivered', takes: 'none' },
  { value: 'opened', label: 'was opened', takes: 'none' },
  { value: 'clicked', label: 'was clicked', takes: 'none' },
  { value: 'bounced', label: 'bounced', takes: 'none' },
  { value: 'delivered_not_opened', label: 'was delivered and not opened', takes: 'none' },
  { value: 'not_sent', label: 'was not sent', takes: 'none' },
]
export const STEP_OPERATORS: Operator[] = [
  { value: 'yes', label: 'answered Yes', takes: 'none' },
  { value: 'no', label: 'answered No', takes: 'none' },
]
export const EVENT_OPERATORS: Operator[] = [
  { value: 'happened', label: 'happened', takes: 'none' },
  { value: 'not_happened', label: 'did not happen', takes: 'none' },
]
export const MEMBERSHIP_OPERATORS: Operator[] = [
  { value: 'in', label: 'is in', takes: 'none' },
  { value: 'not_in', label: 'is not in', takes: 'none' },
]
/** an attribute offers every typed operator; the chosen one says how the attribute is read */
const ATTRIBUTE_OPERATORS: Operator[] = [
  ...TEXT_OPERATORS.filter((op) => op.takes !== 'none'),
  ...NUMBER_OPERATORS.filter((op) => op.takes !== 'none'),
  ...DATE_OPERATORS.filter((op) => op.takes !== 'none'),
  { value: 'is_set', label: 'is set', takes: 'none' },
  { value: 'is_not_set', label: 'is not set', takes: 'none' },
]
export const PROPERTY_OPERATORS: Operator[] = [...TEXT_OPERATORS, ...NUMBER_OPERATORS.filter((op) => op.takes !== 'none')]

export const MAX_CONDITIONS = 20
export const MAX_DAYS = 3650

export function fieldKind(field: string): { kind: FieldKind; rest: string } | null {
  const at = field.indexOf(':')
  if (at <= 0) return null
  const kind = field.slice(0, at)
  const rest = field.slice(at + 1)
  if (!rest || !['customer', 'attr', 'message', 'step', 'event', 'list', 'segment'].includes(kind)) return null
  return { kind: kind as FieldKind, rest }
}

/** A step of this journey the builder can name: a message step or an earlier Condition. */
export interface JourneyStepOption {
  key: string
  label: string
  type: 'EMAIL' | 'SMS' | 'MMS' | 'CONDITION'
}

export function isGroup(item: ConditionItem | ConditionRule): item is ConditionRule {
  return 'conditions' in item
}

export function emptyRule(all = true): ConditionRule {
  return { all, conditions: [] }
}

export function emptyCondition(): ConditionItem {
  return { field: '', op: '' }
}

export function lookupField(key: string, catalogue: ConditionFieldCatalogue | undefined): ConditionField | undefined {
  if (!catalogue) return undefined
  return [...catalogue.customer, ...catalogue.attributes, ...catalogue.events, ...catalogue.lists, ...catalogue.segments].find((item) => item.key === key)
}

/** The operators a field allows: by its kind, by its type for a standard field, all of them for an attribute. */
export function operatorsFor(field: string, catalogue: ConditionFieldCatalogue | undefined): Operator[] {
  const parsed = fieldKind(field)
  if (!parsed) return []
  switch (parsed.kind) {
    case 'customer': {
      const type = lookupField(field, catalogue)?.type ?? 'text'
      return type === 'number' ? NUMBER_OPERATORS : type === 'date' ? DATE_OPERATORS : TEXT_OPERATORS
    }
    case 'attr': {
      const type = lookupField(field, catalogue)?.type
      // a typed guess puts that type's operators first; every operator stays available
      const first = type === 'number' ? NUMBER_OPERATORS : type === 'date' ? DATE_OPERATORS : TEXT_OPERATORS
      return [...first, ...ATTRIBUTE_OPERATORS.filter((op) => !first.some((item) => item.value === op.value))]
    }
    case 'message':
      return MESSAGE_OPERATORS
    case 'step':
      return STEP_OPERATORS
    case 'event':
      return EVENT_OPERATORS
    default:
      return MEMBERSHIP_OPERATORS
  }
}

export function operatorOf(field: string, op: string, catalogue: ConditionFieldCatalogue | undefined): Operator | undefined {
  return operatorsFor(field, catalogue).find((item) => item.value === op)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function valueOk(value: unknown, type: ValueType | undefined): boolean {
  if (value === undefined || value === null || value === '') return false
  if (type === 'number') return Number.isFinite(Number(value))
  if (type === 'date') return DATE.test(String(value))
  return String(value).trim() !== ''
}

/** What a row still needs before the rule can be saved, or null. */
export function conditionProblem(item: ConditionItem, catalogue: ConditionFieldCatalogue | undefined, atEntry: boolean): string | null {
  const parsed = fieldKind(item.field)
  if (!parsed) return 'Choose a field.'
  if (atEntry && (parsed.kind === 'message' || parsed.kind === 'step')) return 'Fields about this journey can only be checked inside it.'
  const operator = operatorOf(item.field, item.op, catalogue)
  if (!operator) return 'Choose how to compare.'
  const type = operator.type ?? (parsed.kind === 'customer' ? lookupField(item.field, catalogue)?.type : undefined)
  if (operator.takes === 'days') {
    const days = Number(item.value)
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return `A whole number of days from 1 to ${MAX_DAYS.toLocaleString('en-US')}.`
  } else if (operator.takes === 'one') {
    if (!valueOk(item.value, type)) return type === 'date' ? 'Choose a date.' : type === 'number' ? 'Enter a number.' : 'Enter a value.'
  } else if (operator.takes === 'many') {
    const values = Array.isArray(item.value) ? item.value : []
    if (values.length === 0 || !values.every((value) => valueOk(value, type))) return 'Add at least one value.'
  } else if (operator.takes === 'two') {
    const values = Array.isArray(item.value) ? item.value : []
    if (values.length !== 2 || !values.every((value) => valueOk(value, type))) return type === 'date' ? 'Choose both dates.' : 'Enter both numbers.'
  }
  if (parsed.kind === 'event') {
    if (item.days !== undefined && item.days !== '' && (!Number.isInteger(Number(item.days)) || Number(item.days) < 1 || Number(item.days) > MAX_DAYS)) {
      return `A whole number of days from 1 to ${MAX_DAYS.toLocaleString('en-US')}, or blank.`
    }
    for (const prop of item.props ?? []) {
      if (!prop.key.trim()) return 'Name the event property to filter on.'
      const propOperator = PROPERTY_OPERATORS.find((op) => op.value === prop.op)
      if (!propOperator) return 'Choose how to compare the property.'
      if (propOperator.takes === 'one' && !valueOk(prop.value, propOperator.type)) return 'Enter the property value.'
      if (propOperator.takes === 'many' && !(Array.isArray(prop.value) && prop.value.length > 0)) return 'Add at least one property value.'
      if (propOperator.takes === 'two' && !(Array.isArray(prop.value) && prop.value.length === 2)) return 'Enter both numbers.'
    }
  }
  return null
}

export function countConditions(rule: ConditionRule): number {
  return rule.conditions.reduce((sum, item) => sum + (isGroup(item) ? countConditions(item) : 1), 0)
}

/** The first problem anywhere in the rule, or null; an empty rule has none (it is just not complete). */
export function ruleProblem(rule: ConditionRule, catalogue: ConditionFieldCatalogue | undefined, atEntry: boolean): string | null {
  if (countConditions(rule) > MAX_CONDITIONS) return `A rule holds at most ${MAX_CONDITIONS} conditions.`
  for (const item of rule.conditions) {
    const problem = isGroup(item) ? ruleProblem(item, catalogue, atEntry) : conditionProblem(item, catalogue, atEntry)
    if (problem) return problem
  }
  return null
}

export function isRuleComplete(rule: ConditionRule | undefined, catalogue: ConditionFieldCatalogue | undefined, atEntry: boolean): boolean {
  return Boolean(rule) && countConditions(rule!) > 0 && ruleProblem(rule!, catalogue, atEntry) === null
}

/** Numbers typed as text become numbers; blank optional parts are dropped: what PUT sends. */
export function normalizeRule(rule: ConditionRule, catalogue: ConditionFieldCatalogue | undefined): ConditionRule {
  const number = (value: string | number) => (Number.isFinite(Number(value)) && String(value).trim() !== '' ? Number(value) : value)
  return {
    all: rule.all,
    conditions: rule.conditions.map((item) => {
      if (isGroup(item)) return normalizeRule(item, catalogue)
      const operator = operatorOf(item.field, item.op, catalogue)
      const numeric = operator?.takes === 'days' || operator?.type === 'number'
      const out: ConditionItem = { field: item.field, op: item.op }
      if (operator && operator.takes !== 'none') {
        out.value = Array.isArray(item.value) ? item.value.map((value) => (numeric ? number(value) : value)) : numeric && item.value !== undefined ? number(item.value) : item.value
      }
      if (fieldKind(item.field)?.kind === 'event') {
        if (item.days !== undefined && item.days !== '') out.days = Number(item.days)
        if (item.props?.length) {
          out.props = item.props.map((prop) => {
            const propOperator = PROPERTY_OPERATORS.find((op) => op.value === prop.op)
            const propNumeric = propOperator?.type === 'number'
            const cleaned: NonNullable<ConditionItem['props']>[number] = { key: prop.key.trim(), op: prop.op }
            if (propOperator && propOperator.takes !== 'none') {
              cleaned.value = Array.isArray(prop.value) ? prop.value.map((value) => (propNumeric ? number(value) : value)) : propNumeric && prop.value !== undefined ? number(prop.value) : prop.value
            }
            return cleaned
          })
        }
      }
      return out
    }),
  }
}

// ---------------------------------------------------------------------------------------------- the read-back sentence

function list(values: (string | number)[], joiner: 'or' | 'and'): string {
  const text = values.map(String)
  if (text.length <= 1) return text[0] ?? ''
  return `${text.slice(0, -1).join(', ')} ${joiner} ${text[text.length - 1]}`
}

function dateText(value: string | number | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return 'a date'
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function days(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-US')} day${n === 1 ? '' : 's'}` : 'some days'
}

function fieldLabel(field: string, catalogue: ConditionFieldCatalogue | undefined, steps: JourneyStepOption[]): string {
  const parsed = fieldKind(field)
  if (!parsed) return 'a field'
  const named = lookupField(field, catalogue)?.label
  switch (parsed.kind) {
    case 'customer':
      return `their ${(named ?? titleFromKey(parsed.rest)).toLowerCase()}`
    case 'attr':
      return `their ${named ?? titleFromKey(parsed.rest)}`
    case 'message': {
      if (parsed.rest === '*') return 'any message of this journey'
      const step = steps.find((item) => item.key === parsed.rest)
      return step ? `the ${step.label} ${step.type === 'EMAIL' ? 'email' : 'text'}` : `the message step ${parsed.rest}`
    }
    case 'step': {
      const step = steps.find((item) => item.key === parsed.rest)
      return step ? `the condition ${step.label}` : `the step ${parsed.rest}`
    }
    case 'event':
      return named ?? titleFromKey(parsed.rest)
    case 'list':
      return named ?? 'a list'
    default:
      return named ?? 'a segment'
  }
}

export function titleFromKey(key: string): string {
  return key.replace(/_/g, ' ').trim().split(/\s+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

function propText(prop: NonNullable<ConditionItem['props']>[number]): string {
  const operator = PROPERTY_OPERATORS.find((op) => op.value === prop.op)
  const values = Array.isArray(prop.value) ? prop.value : prop.value === undefined ? [] : [prop.value]
  const value = operator?.takes === 'none' ? '' : operator?.takes === 'two' ? ` ${values[0] ?? '?'} and ${values[1] ?? '?'}` : ` ${list(values, 'or') || '?'}`
  return `${prop.key} ${operator?.label ?? prop.op}${value}`
}

/** One condition in words. */
export function describeCondition(item: ConditionItem, catalogue: ConditionFieldCatalogue | undefined, steps: JourneyStepOption[]): string {
  const parsed = fieldKind(item.field)
  const subject = fieldLabel(item.field, catalogue, steps)
  const operator = operatorOf(item.field, item.op, catalogue)
  if (!parsed || !operator) return `${subject} …`
  const values = Array.isArray(item.value) ? item.value : item.value === undefined || item.value === '' ? [] : [item.value]
  switch (parsed.kind) {
    case 'list':
      return `they are ${item.op === 'in' ? 'on' : 'not on'} ${subject}`
    case 'segment':
      return `they are ${item.op === 'in' ? 'in' : 'not in'} ${subject}`
    case 'message':
    case 'step':
      return `${subject} ${operator.label}`
    case 'event': {
      const when = item.days !== undefined && item.days !== '' ? ` in the last ${days(item.days)}` : ''
      const props = item.props?.length ? ` with ${list(item.props.map(propText), 'and')}` : ''
      return `${subject} ${operator.label}${when}${props}`
    }
    default: {
      if (operator.takes === 'none') return `${subject} ${operator.label}`
      if (operator.takes === 'days') return `${subject} ${operator.label} ${days(item.value)}${item.op === 'older_than_days' ? ' ago' : ''}`
      if (operator.takes === 'two') {
        const [from, to] = values
        return operator.type === 'date' ? `${subject} is between ${dateText(from)} and ${dateText(to)}` : `${subject} is between ${from ?? '?'} and ${to ?? '?'}`
      }
      if (operator.type === 'date') return `${subject} ${operator.label} ${dateText(values[0])}`
      const joiner = item.op === 'not_in' ? 'and' : 'or'
      const shown = values.length ? list(values, joiner) : '…'
      if (item.op === 'contains' || item.op === 'not_contains' || item.op === 'starts_with' || item.op === 'is' || item.op === 'is_not') return `${subject} ${operator.label} “${shown}”`
      return `${subject} ${operator.label} ${shown}`
    }
  }
}

/** The whole rule in words, without the leading "Yes when": "their loyalty tier is Gold or Platinum, and either they are
 * not on Do Not Contact or Store Visit happened in the last 14 days". */
export function describeRule(rule: ConditionRule, catalogue: ConditionFieldCatalogue | undefined, steps: JourneyStepOption[]): string {
  const parts = rule.conditions.map((item) => (isGroup(item) ? describeGroup(item, catalogue, steps) : describeCondition(item, catalogue, steps))).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')}, ${rule.all ? 'and' : 'or'} ${parts[parts.length - 1]}`
}

function describeGroup(group: ConditionRule, catalogue: ConditionFieldCatalogue | undefined, steps: JourneyStepOption[]): string {
  const parts = group.conditions.map((item) => (isGroup(item) ? describeGroup(item, catalogue, steps) : describeCondition(item, catalogue, steps))).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${group.all ? 'both ' : 'either '}${parts.slice(0, -1).join(', ')} ${group.all ? 'and' : 'or'} ${parts[parts.length - 1]}`
}

/** The card's one line: the first two conditions, "+ 2 more". */
export function summarizeRule(rule: ConditionRule | undefined, catalogue: ConditionFieldCatalogue | undefined, steps: JourneyStepOption[]): string {
  if (!rule || countConditions(rule) === 0) return 'No condition set'
  const flat: ConditionItem[] = []
  const collect = (group: ConditionRule) => group.conditions.forEach((item) => (isGroup(item) ? collect(item) : flat.push(item)))
  collect(rule)
  const shown = flat.slice(0, 2).map((item) => describeCondition(item, catalogue, steps))
  const more = flat.length - shown.length
  const text = shown.join(rule.all ? ' and ' : ' or ')
  const capped = text.charAt(0).toUpperCase() + text.slice(1)
  return more > 0 ? `${capped} + ${more} more` : capped
}

// ---------------------------------------------------------------------------------------------- the earlier Condition form

/** A Condition saved before the builder ({check, days?, event_type?, segment_id?, message_step?}) opens as the rule it
 * meant; the engine still reads the old form, so nothing changes until the step is saved again. */
export function ruleFromLegacy(config: Record<string, unknown>): ConditionRule | null {
  const check = String(config.check ?? '').toUpperCase()
  if (!check) return null
  const days = config.days !== undefined && config.days !== null && config.days !== '' ? Number(config.days) : undefined
  const event = (type: string): ConditionItem => ({ field: `event:${type}`, op: 'happened', ...(days ? { days } : {}), props: [] })
  switch (check) {
    case 'PURCHASED':
      return { all: true, conditions: [event('PURCHASE')] }
    case 'REDEEMED':
      return { all: true, conditions: [event('COUPON_REDEEMED')] }
    case 'EVENT':
      return config.event_type ? { all: true, conditions: [event(String(config.event_type).toUpperCase())] } : null
    case 'OPENED':
    case 'CLICKED':
      return { all: true, conditions: [{ field: `message:${String(config.message_step ?? '').trim() || '*'}`, op: check === 'OPENED' ? 'opened' : 'clicked' }] }
    case 'IN_SEGMENT':
      return config.segment_id ? { all: true, conditions: [{ field: `segment:${String(config.segment_id)}`, op: 'in' }] } : null
    default:
      return null
  }
}
