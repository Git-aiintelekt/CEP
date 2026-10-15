import { describe, expect, test } from 'vitest'

import { goalContinues, goalProblem, isGoalConfigured, normalizeGoal, summarizeGoal } from './GoalFields'

describe('the Goal step', () => {
  test('what it still needs, and when it counts as configured', () => {
    expect(goalProblem({})).toBeNull()
    expect(isGoalConfigured({})).toBe(false)
    expect(isGoalConfigured({ event_type: 'PURCHASE' })).toBe(true)
    expect(goalProblem({ event_type: 'purchase now' })).toContain('capital letters')
    expect(goalProblem({ event_type: 'PURCHASE', window_days: 0 })).toContain('from 1 to 365')
    expect(goalProblem({ event_type: 'PURCHASE', props: [{ key: '', op: 'is', value: 'x' }] })).toBe('Name the event property to filter on.')
    expect(goalProblem({ event_type: 'PURCHASE', props: [{ key: 'amount', op: 'gte' }] })).toBe('Enter the property value.')
    expect(goalProblem({ event_type: 'PURCHASE', props: [{ key: 'amount', op: 'gte', value: '25' }] })).toBeNull()
  })

  test("the card's line, and what the graph stores", () => {
    expect(summarizeGoal({})).toBe('No goal event chosen')
    expect(summarizeGoal({ event_type: 'PURCHASE', window_days: 14, props: [{ key: 'amount', op: 'gte', value: 25 }] })).toBe('Purchase with 1 filter within 14 days of entering')
    expect(summarizeGoal({ event_type: 'COUPON_REDEEMED' }, 'Coupon Redemption')).toBe('Coupon Redemption within 30 days of entering')
    expect(normalizeGoal({ event_type: 'purchase', window_days: '14', props: [{ key: ' amount ', op: 'gte', value: '25' }] }))
      .toEqual({ event_type: 'PURCHASE', window_days: 14, when_reached: 'EXIT', props: [{ key: 'amount', op: 'gte', value: 25 }] })
    expect(normalizeGoal({ event_type: 'PURCHASE', when_reached: 'CONTINUE', props: [] })).toEqual({ event_type: 'PURCHASE', window_days: 30, when_reached: 'CONTINUE' })
    expect(goalContinues({ when_reached: 'CONTINUE' })).toBe(true)
    expect(goalContinues({})).toBe(false)
  })
})
