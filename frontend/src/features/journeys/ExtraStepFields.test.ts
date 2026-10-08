import { describe, expect, test } from 'vitest'

import { extraProblem, isExtraConfigured, normalizeExtra, splitBranchKeys, splitBranchLabels, summarizeExtra } from './ExtraStepFields'

describe('the smaller steps', () => {
  const split = { by: 'ATTRIBUTE', attribute: 'home_store', paths: [{ key: 'P1', label: 'Lakeside', values: ['Lakeside Mall'] }, { key: 'P2', label: '', values: ['Downtown', 'Airport'] }] }

  test('a split by an attribute opens one branch per path and Everyone Else, labelled', () => {
    expect(splitBranchKeys(split)).toEqual(['P1', 'P2', 'OTHERWISE'])
    expect(splitBranchLabels(split)).toEqual({ P1: 'LAKESIDE', P2: 'P2', OTHERWISE: 'EVERYONE ELSE' })
    expect(splitBranchKeys({ by: 'RANDOM', paths: [{ key: 'A', label: 'A', share: 50 }, { key: 'B', label: 'B', share: 50 }] })).toEqual(['A', 'B'])
    expect(summarizeExtra('SPLIT', split)).toBe('Split by Home Store, 3 paths')
    expect(summarizeExtra('SPLIT', { by: 'RANDOM', paths: [{ key: 'A', share: 50 }, { key: 'B', share: 50 }] })).toBe('Split at random, 2 paths')
  })

  test('what a split still needs, and what the graph stores', () => {
    expect(extraProblem('SPLIT', split)).toBeNull()
    expect(isExtraConfigured('SPLIT', split)).toBe(true)
    expect(isExtraConfigured('SPLIT', { ...split, attribute: '' })).toBe(false)
    expect(extraProblem('SPLIT', { by: 'ATTRIBUTE', attribute: 'a', paths: [{ key: 'P1', label: 'x', values: [] }] })).toBe('Add the values that take the x path.')
    expect(extraProblem('SPLIT', { by: 'RANDOM', paths: [{ key: 'A', share: 60 }, { key: 'B', share: 30 }] })).toBe('The shares add up to 90, not 100.')
    expect(extraProblem('SPLIT', { by: 'ATTRIBUTE', attribute: 'a', paths: [{ key: 'P1', values: ['x'] }, { key: 'P1', values: ['y'] }] })).toBe('Each path needs its own key.')
    expect(normalizeExtra('SPLIT', { by: 'RANDOM', paths: [{ key: 'a', label: ' Half ', share: '50' }, { key: 'b', label: '', share: '50' }] }))
      .toEqual({ by: 'RANDOM', paths: [{ key: 'A', label: 'Half', share: 50 }, { key: 'B', label: 'Path 2', share: 50 }] })
  })

  test('Update Profile and the lists', () => {
    expect(summarizeExtra('PROFILE_UPDATE', { attribute: 'customer_status', value: 'Welcomed' })).toBe('Set Customer Status to Welcomed')
    expect(isExtraConfigured('PROFILE_UPDATE', { attribute: 'customer_status', value: '' })).toBe(false)
    expect(extraProblem('PROFILE_UPDATE', { attribute: 'no/slash', value: 'x' })).toContain('letters, digits')
    expect(summarizeExtra('LIST_ADD', { contact_list_id: 'cl-1', contact_list_name: 'VIP' })).toBe('Add to VIP')
    expect(summarizeExtra('LIST_REMOVE', {})).toBe('No list chosen')
    expect(isExtraConfigured('LIST_REMOVE', { contact_list_id: 'cl-1' })).toBe(true)
  })
})
