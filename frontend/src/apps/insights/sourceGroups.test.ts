import { describe, expect, test } from 'vitest'

import { groupSources, matches, prefixOf } from './sourceGroups'
import type { SourceInfo } from './types'

const s = (name: string, kind: 'table' | 'view' = 'table'): SourceInfo => ({ name, kind, rows: null, columns: null, mappable: true, mapped_as: null })

describe('finding a table among 1,000+', () => {
  test('a prefix is the name up to its first underscore', () => {
    expect(prefixOf('sales_lines')).toBe('sales_')
    expect(prefixOf('Sales_Lines')).toBe('sales_')
    expect(prefixOf('orders')).toBeNull()
    expect(prefixOf('_tmp')).toBeNull()
  })

  test('the search matches anywhere in the name, ignoring case', () => {
    expect(matches(s('rpt_daily_SALES'), 'sales')).toBe(true)
    expect(matches(s('orders'), 'sales')).toBe(false)
    expect(matches(s('orders'), '  ')).toBe(true)
  })

  test('under 50 tables: one plain list, no groups', () => {
    const few = [s('stores'), s('sales_lines'), s('v_daily', 'view')]
    expect(groupSources(few, [], few.length)).toEqual([{ key: 'all', label: null, items: few }])
  })

  test('a big database: Pinned in the order pinned, Views, each prefix of 5 or more, then Other', () => {
    const many = [
      ...Array.from({ length: 30 }, (_, n) => s(`sales_${n}`)), ...Array.from({ length: 6 }, (_, n) => s(`inv_${n}`)),
      ...Array.from({ length: 4 }, (_, n) => s(`tmp_${n}`)), s('orders'), s('v_daily', 'view'), ...Array.from({ length: 10 }, (_, n) => s(`cust_${n}`)),
    ]
    const groups = groupSources(many, ['sales_3', 'orders', 'gone'], many.length)
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([['Pinned', 2], ['Views', 1], ['cust_', 10], ['inv_', 6], ['sales_', 30], ['Other', 5]])
    expect(groups[0].items.map((i) => i.name)).toEqual(['sales_3', 'orders'])      // a pin no longer in the database is left out
    expect(groups.at(-1)?.items.map((i) => i.name)).toEqual(['tmp_0', 'tmp_1', 'tmp_2', 'tmp_3', 'orders'])
  })
})
