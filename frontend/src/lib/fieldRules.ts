/**
 * The server's field rules (GET /field-rules/): type, length and choices per resource and field, read off the tables.
 * A form reads a rule to set the input's maxLength, show "42 / 200", and build its Zod check; the server still checks.
 * When the rules have not arrived (or there is no backend), `max` is null and the form falls back to its own number.
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { api } from './api'
import type { FieldRule, FieldRules } from './types'

export const FIELD_RULES_KEY = ['field-rules'] as const

export function useFieldRules(resource: string): (field: string) => FieldRule | null {
  const query = useQuery({ queryKey: FIELD_RULES_KEY, queryFn: ({ signal }) => api.get<FieldRules>('/field-rules/', undefined, signal), staleTime: Infinity, gcTime: Infinity, retry: 1 })
  const fields = query.data?.resources[resource]
  return (field) => ruleAt(fields, field)
}

/** `targets.notes` walks into a nested object rule */
export function ruleAt(fields: Record<string, FieldRule> | undefined, path: string): FieldRule | null {
  let current: Record<string, FieldRule> | undefined = fields
  let rule: FieldRule | null = null
  for (const part of path.split('.')) {
    rule = current?.[part] ?? null
    if (!rule) return null
    current = rule.fields
  }
  return rule
}

export interface Limit {
  used: number
  /** the table's limit; null when unknown */
  max: number | null
  /** a smaller limit worth showing first, such as the 90 characters an inbox shows of a preheader */
  soft?: number
}

export type LimitTone = 'quiet' | 'warn' | 'over'

/** grey until the last 10%, then amber, then red at the limit */
export function limitTone({ used, max, soft }: Limit): LimitTone {
  const ceiling = soft ?? max
  if (ceiling === null || ceiling === undefined || ceiling <= 0) return 'quiet'
  if (used >= ceiling) return 'over'
  return ceiling - used <= Math.max(1, Math.ceil(ceiling * 0.1)) ? 'warn' : 'quiet'
}

/** the input's maxLength: the rule's, else the form's own number, else none */
export function maxLengthOf(rule: FieldRule | null, fallback?: number): number | undefined {
  return rule?.max ?? fallback
}

/** A Zod string check from a rule, with the messages the forms already use. */
export function stringFromRule(rule: FieldRule | null, fallbackMax?: number): z.ZodString {
  let schema = z.string()
  const max = rule?.max ?? fallbackMax
  if (max) schema = schema.max(max, `Use ${max.toLocaleString('en-US')} characters or fewer.`)
  if (rule?.min) schema = schema.min(rule.min, `Use at least ${rule.min} characters.`)
  if (rule?.type === 'email') schema = schema.email('Enter a valid email address.')
  if (rule?.type === 'url') schema = schema.url('Enter a valid web address.')
  if (rule?.pattern) schema = schema.regex(new RegExp(rule.pattern), 'Not in the expected format.')
  return schema
}
