import { expect, test } from 'vitest'

import { RECENT_LIMIT, rememberTag } from './useRecentTags'

test('the newest comes first', () => {
  expect(rememberTag(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
})

test('choosing a tag again moves it to the front instead of listing it twice', () => {
  expect(rememberTag(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  expect(rememberTag(['a'], 'a')).toEqual(['a'])
})

test('never more than five, and it is the oldest that drops off', () => {
  expect(RECENT_LIMIT).toBe(5)
  let recent: string[] = []
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) recent = rememberTag(recent, key)
  expect(recent).toEqual(['g', 'f', 'e', 'd', 'c'])
  expect(recent).toHaveLength(5)
})

test('the list handed in is not changed', () => {
  const was = ['a', 'b']
  rememberTag(was, 'c')
  expect(was).toEqual(['a', 'b'])
})
