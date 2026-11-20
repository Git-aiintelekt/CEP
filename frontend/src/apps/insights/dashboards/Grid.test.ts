/** The grid's flow, pure: sizes, lines, a page of rows as a grid, moving and sizing (phase D5). */
import { expect, test } from 'vitest'

import type { DashboardCell } from '../types'
import { duplicateCell, isPacked, isTall, moveTo, nextPlace, pack, rowsToCells, setSize, setTall, sizeOf } from './canvas'

const cell = (id: string, w: number, h = 2, show: DashboardCell['show'] = 'figure'): DashboardCell => ({ id, report_id: 'r', show, x: 0, y: 0, w, h })

test('tiles flow left to right; a line is as tall as its tallest tile, and the next starts below it', () => {
  const flowed = pack([cell('a', 3), cell('b', 3), cell('c', 6, 5, 'chart'), cell('d', 8, 5, 'chart'), cell('e', 4)])
  expect(flowed.map((c) => [c.id, c.x, c.y])).toEqual([['a', 0, 0], ['b', 3, 0], ['c', 6, 0], ['d', 0, 5], ['e', 8, 5]])
  expect(isPacked(flowed)).toBe(true)
  expect(isPacked(flowed.map((c) => (c.id === 'e' ? { ...c, y: 9 } : c)))).toBe(false)
})

test('a page of rows becomes the same grid: four across, wide and narrow', () => {
  const cells = rowsToCells([{ width: '4', tiles: ['a', 'b', 'c', 'd'].map((id) => ({ id, report_id: 'r', show: 'figure' })) }, { width: '2-1', tiles: [{ id: 'e', report_id: 'r', show: 'chart' }, { id: 'f', report_id: 'r', show: 'chart' }] }])
  expect(isPacked(cells)).toBe(true)
  expect(cells.map((c) => sizeOf(c).label)).toEqual(['Small', 'Small', 'Small', 'Small', 'Two Thirds', 'One Third'])
})

test('sizes, Tall, moving, duplicating and the next free place', () => {
  const cells = pack([cell('a', 3), cell('b', 3), cell('c', 6, 5, 'chart')])
  expect(setSize(cells, 'a', 12).map((c) => [c.id, c.x, c.y])).toEqual([['a', 0, 0], ['b', 0, 2], ['c', 3, 2]])
  const tall = setTall(cells, 'c', true)
  expect(isTall(tall[2])).toBe(true)
  expect(tall[2].h).toBe(10)
  expect(moveTo(cells, 'c', 0).map((c) => c.id)).toEqual(['c', 'a', 'b'])
  expect(duplicateCell(cells, 'a', 'a2').map((c) => c.id)).toEqual(['a', 'a2', 'b', 'c'])
  expect(nextPlace(cells, 6)).toEqual({ x: 0, y: 5 })
  expect(nextPlace(pack([cell('a', 3)]), 6)).toEqual({ x: 3, y: 0 })
})
