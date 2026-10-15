import { expect, test } from 'vitest'

import { HIDDEN_ATTRIBUTE, pruneHidden, sameHidden, toggleHidden } from './hidden'

test('toggling adds an id and toggling again removes it, without mutating the original', () => {
  const empty = new Set<string>()
  const one = toggleHidden(empty, 'a')

  expect([...one]).toEqual(['a'])
  expect(empty.size).toBe(0)
  expect([...toggleHidden(one, 'a')]).toEqual([])
  expect([...toggleHidden(one, 'b')].sort()).toEqual(['a', 'b'])
})

test('pruning drops ids whose component has gone and keeps the rest', () => {
  const hidden = new Set(['a', 'b', 'c'])
  expect([...pruneHidden(hidden, ['a', 'c', 'd'])].sort()).toEqual(['a', 'c'])
  expect([...pruneHidden(hidden, [])]).toEqual([])
  expect([...pruneHidden(new Set<string>(), ['a'])]).toEqual([])
})

test('sameHidden compares contents, not identity', () => {
  expect(sameHidden(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
  expect(sameHidden(new Set(['a']), new Set(['b']))).toBe(false)
  expect(sameHidden(new Set(['a']), new Set(['a', 'b']))).toBe(false)
  expect(sameHidden(new Set<string>(), new Set<string>())).toBe(true)
})

test('the attribute is a data attribute, so it can never collide with an MJML attribute', () => {
  expect(HIDDEN_ATTRIBUTE).toMatch(/^data-/)
})
