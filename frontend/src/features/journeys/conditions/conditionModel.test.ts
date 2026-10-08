import { describe, expect, test } from 'vitest'

import type { ConditionFieldCatalogue, ConditionRule } from '@/lib/types'

import { conditionProblem, describeRule, isRuleComplete, normalizeRule, operatorsFor, ruleFromLegacy, ruleProblem, summarizeRule } from './conditionModel'

const catalogue: ConditionFieldCatalogue = {
  customer: [{ key: 'customer:country', label: 'Country', type: 'text' }, { key: 'customer:last_purchase_at', label: 'Last Purchase Date', type: 'date' }, { key: 'customer:purchase_count', label: 'Number of Purchases', type: 'number' }],
  attributes: [{ key: 'attr:loyalty_tier', label: 'Loyalty Tier', type: 'text', customers: 100, values: ['Gold', 'Platinum'] }, { key: 'attr:renewal_date', label: 'Renewal Date', type: 'date', customers: 40, values: null }],
  events: [{ key: 'event:STORE_VISIT', label: 'Store Visit', seen: 12, properties: ['store'] }],
  lists: [{ key: 'list:cl-1', label: 'Do Not Contact' }],
  segments: [{ key: 'segment:seg-1', label: 'VIP Customers' }],
}
const steps = [{ key: 'email-1', label: 'Welcome', type: 'EMAIL' as const }, { key: 'cond-1', label: 'Worth a second email?', type: 'CONDITION' as const }]

const rule: ConditionRule = {
  all: true,
  conditions: [
    { field: 'attr:loyalty_tier', op: 'in', value: ['Gold', 'Platinum'] },
    { field: 'customer:last_purchase_at', op: 'older_than_days', value: 90 },
    { field: 'message:email-1', op: 'delivered_not_opened' },
    { all: false, conditions: [{ field: 'list:cl-1', op: 'not_in' }, { field: 'event:STORE_VISIT', op: 'happened', days: 14, props: [{ key: 'store', op: 'is', value: 'Lakeside Mall' }] }] },
  ],
}

describe('the condition model', () => {
  test('each field kind offers its own operators; an attribute offers its type first and the rest after', () => {
    expect(operatorsFor('customer:purchase_count', catalogue).map((op) => op.value)).toEqual(['eq', 'neq', 'gte', 'lte', 'between', 'is_set', 'is_not_set'])
    expect(operatorsFor('message:email-1', catalogue).map((op) => op.value)).toContain('delivered_not_opened')
    expect(operatorsFor('list:cl-1', catalogue).map((op) => op.value)).toEqual(['in', 'not_in'])
    const attribute = operatorsFor('attr:renewal_date', catalogue).map((op) => op.value)
    expect(attribute.slice(0, 2)).toEqual(['within_days', 'older_than_days'])
    expect(attribute).toContain('contains')
  })

  test('a row says what it still needs, and journey fields are refused at entry', () => {
    expect(conditionProblem({ field: '', op: '' }, catalogue, false)).toBe('Choose a field.')
    expect(conditionProblem({ field: 'attr:loyalty_tier', op: '' }, catalogue, false)).toBe('Choose how to compare.')
    expect(conditionProblem({ field: 'attr:loyalty_tier', op: 'in', value: [] }, catalogue, false)).toBe('Add at least one value.')
    expect(conditionProblem({ field: 'customer:last_purchase_at', op: 'before', value: 'soon' }, catalogue, false)).toBe('Choose a date.')
    expect(conditionProblem({ field: 'customer:purchase_count', op: 'between', value: [1] }, catalogue, false)).toBe('Enter both numbers.')
    expect(conditionProblem({ field: 'attr:renewal_date', op: 'within_days', value: 0 }, catalogue, false)).toContain('from 1 to 3,650')
    expect(conditionProblem({ field: 'message:email-1', op: 'opened' }, catalogue, true)).toBe('Fields about this journey can only be checked inside it.')
    expect(conditionProblem({ field: 'message:email-1', op: 'opened' }, catalogue, false)).toBeNull()
    expect(ruleProblem(rule, catalogue, false)).toBeNull()
    expect(isRuleComplete({ all: true, conditions: [] }, catalogue, false)).toBe(false)
    expect(isRuleComplete(rule, catalogue, false)).toBe(true)
  })

  test('the rule reads back as a sentence, and the card shows two conditions and a count', () => {
    expect(describeRule(rule, catalogue, steps)).toBe(
      'their Loyalty Tier is any of Gold or Platinum, their last purchase date is more than 90 days ago, the Welcome email was delivered and not opened, '
      + 'and either they are not on Do Not Contact or Store Visit happened in the last 14 days with store is Lakeside Mall',
    )
    expect(summarizeRule(rule, catalogue, steps)).toBe('Their Loyalty Tier is any of Gold or Platinum and their last purchase date is more than 90 days ago + 3 more')
    expect(summarizeRule({ all: true, conditions: [] }, catalogue, steps)).toBe('No condition set')
  })

  test('typed-as-text numbers are sent as numbers, blank days are dropped', () => {
    const typed: ConditionRule = { all: true, conditions: [{ field: 'customer:purchase_count', op: 'gte', value: '3' }, { field: 'event:STORE_VISIT', op: 'happened', days: '', props: [] }, { field: 'attr:renewal_date', op: 'within_days', value: '30' }] }
    expect(normalizeRule(typed, catalogue)).toEqual({ all: true, conditions: [{ field: 'customer:purchase_count', op: 'gte', value: 3 }, { field: 'event:STORE_VISIT', op: 'happened' }, { field: 'attr:renewal_date', op: 'within_days', value: 30 }] })
  })

  test('a Condition saved before the builder opens as the rule it meant', () => {
    expect(ruleFromLegacy({ check: 'PURCHASED', days: 30 })).toEqual({ all: true, conditions: [{ field: 'event:PURCHASE', op: 'happened', days: 30, props: [] }] })
    expect(ruleFromLegacy({ check: 'OPENED', message_step: 'email-1' })).toEqual({ all: true, conditions: [{ field: 'message:email-1', op: 'opened' }] })
    expect(ruleFromLegacy({ check: 'CLICKED' })).toEqual({ all: true, conditions: [{ field: 'message:*', op: 'clicked' }] })
    expect(ruleFromLegacy({ check: 'IN_SEGMENT', segment_id: 'seg-1' })).toEqual({ all: true, conditions: [{ field: 'segment:seg-1', op: 'in' }] })
    expect(ruleFromLegacy({ check: 'EVENT' })).toBeNull()
    expect(ruleFromLegacy({})).toBeNull()
  })
})
