import { expect, test } from 'vitest'

import { rankTopBottom, type RankCandidate } from './rankTopBottom'

/** a campaign at `percent` of a $10,000 target */
const at = (id: string, percent: number, extra: Partial<RankCandidate> = {}): RankCandidate => ({
  id, name: `Campaign ${id}`, channel: 'EMAIL', delivered: 1000, clicked: 30, revenue: percent * 100, target: 10_000, previousRevenue: null, previousClickRate: null, ...extra,
})
const percents = (count: number) => [118, 112, 109, 108, 96, 91, 88, 65, 64, 45, 28].slice(0, count)
const rank = (count: number) => rankTopBottom({ mode: 'target', candidates: percents(count).map((percent, index) => at(`c${index}`, percent)).reverse() })
const values = (rows: { value: number }[]) => rows.map((row) => row.value)

test('eleven: the best three first, the weakest three last (weakest last), and the five between summed up', () => {
  const ranked = rank(11)
  expect(values(ranked.top)).toEqual([118, 112, 109])
  expect(values(ranked.bottom)).toEqual([64, 45, 28])
  expect(ranked.middle).toEqual({ count: 5, min: 65, max: 108 })
  expect(ranked.mode).toBe('target')
})

test('six fill both groups with nothing between; under six, the better half (rounded up) and the rest', () => {
  expect([values(rank(6).top), values(rank(6).bottom), rank(6).middle.count]).toEqual([[118, 112, 109], [108, 96, 91], 0])
  expect([values(rank(5).top), values(rank(5).bottom)]).toEqual([[118, 112, 109], [108, 96]])
  expect([values(rank(2).top), values(rank(2).bottom)]).toEqual([[118], [112]])
  expect([values(rank(1).top), values(rank(1).bottom)]).toEqual([[118], []])
  expect(rank(0)).toMatchObject({ top: [], bottom: [], middle: { count: 0 } })
})

test('a campaign needs a target above zero and a result in the period', () => {
  const ranked = rankTopBottom({ mode: 'target', candidates: [
    at('ok', 90), at('no-target', 90, { target: null }), at('zero-target', 90, { target: 0 }), at('no-revenue', 90, { revenue: null }), at('not-sent', 90, { delivered: 0 }),
  ] })
  expect([...ranked.top, ...ranked.bottom].map((row) => row.id)).toEqual(['ok'])
})

test('bars: the deviation from 100%, scaled to the widest shown; the direction follows the value, whatever the group', () => {
  const ranked = rankTopBottom({ mode: 'target', candidates: [at('a', 118), at('b', 96), at('c', 28)] })
  expect(ranked.top.map((row) => [row.id, row.deviation, row.scale])).toEqual([['a', 18, 0.25], ['b', -4, 4 / 72]])      // a best-group row under 100% still goes left
  expect(ranked.bottom.map((row) => [row.deviation, row.scale])).toEqual([[-72, 1]])
})

test('revenue change on the previous period, in percent', () => {
  const ranked = rankTopBottom({ mode: 'target', candidates: [at('a', 118, { previousRevenue: 10_000 }), at('b', 50)] })
  expect(ranked.top[0]).toMatchObject({ figure: 11_800, change: 18 })
  expect(ranked.bottom[0].change).toBeNull()
})

test('click-rate mode: 50+ delivered only, around the account average, changes in points', () => {
  const ranked = rankTopBottom({ mode: 'clickRate', average: 3.9, candidates: [
    at('high', 0, { delivered: 1000, clicked: 51, previousClickRate: 4.7, target: null, revenue: null }),
    at('low', 0, { delivered: 1000, clicked: 20, target: null, revenue: null }),
    at('tiny', 0, { delivered: 49, clicked: 40, target: null, revenue: null }),
  ] })
  expect(ranked).toMatchObject({ mode: 'clickRate', average: 3.9, middle: { count: 0 } })
  expect(ranked.top[0]).toMatchObject({ id: 'high', value: 5.1, figure: 5.1, deviation: 1.2, change: 0.4 })
  expect(ranked.bottom[0]).toMatchObject({ id: 'low', value: 2, deviation: -1.9, scale: 1 })
  expect([...ranked.top, ...ranked.bottom].some((row) => row.id === 'tiny')).toBe(false)
})
