import { expect, test } from 'vitest'

import { HEADER_MAX, insertIntoHeader, noRoomNote } from './insertIntoHeader'

test('the tag goes in at the caret when there is room', () => {
  expect(insertIntoHeader('subject', 'Hello, your offer', 5, 5, '{{first_name}}')).toEqual({ value: 'Hello{{first_name}}, your offer', caret: 19 })
})

test('a selection is replaced', () => {
  expect(insertIntoHeader('preheader', 'Hello world', 0, 5, '{{x}}')).toEqual({ value: '{{x}} world', caret: 5 })
})

test('the server cap is 300, and exactly 300 still fits', () => {
  expect(HEADER_MAX).toBe(300)
  const room = 'a'.repeat(300 - '{{x}}'.length)
  const fit = insertIntoHeader('subject', room, room.length, room.length, '{{x}}')
  expect('value' in fit && fit.value.length).toBe(300)
})

test('a tag that would push past the cap is refused whole, with a reason naming the field', () => {
  const full = 'a'.repeat(298)
  expect(insertIntoHeader('subject', full, 298, 298, '{{first_name}}')).toEqual({ refused: noRoomNote('{{first_name}}', 'subject') })
  expect(noRoomNote('{{x}}', 'subject')).toBe('No room for {{x}}: the subject line is limited to 300 characters.')
  expect(noRoomNote('{{x}}', 'preheader')).toBe('No room for {{x}}: the preheader is limited to 300 characters.')
})

test('replacing a selection can make room where inserting would not', () => {
  const full = 'a'.repeat(300)
  expect('refused' in insertIntoHeader('subject', full, 300, 300, '{{x}}')).toBe(true)
  const replaced = insertIntoHeader('subject', full, 0, 10, '{{x}}')
  expect('value' in replaced && replaced.value.length).toBe(295)
})
