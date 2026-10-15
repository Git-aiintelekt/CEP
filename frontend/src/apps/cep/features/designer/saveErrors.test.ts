import { expect, test } from 'vitest'

import { UNREADABLE_CODE, saveErrorDetail } from './saveErrors'

test('a compile failure on the server is said in plain words, never as the compiler’s own message', () => {
  expect(saveErrorDetail({ mjml_source: 'The design could not be rendered: unexpected end of stream in root template' })).toBe(UNREADABLE_CODE)
})

test('the server’s other refusals are already plain, so they are passed on as they are', () => {
  for (const message of [
    'Scripts are not allowed in email content.',
    'mj-include is not allowed.',
    'Inline event handlers (onclick, onload, ...) are not allowed.',
    'javascript: links are not allowed.',
    'The design is too large (over 512 KB of MJML).',
  ]) {
    expect(saveErrorDetail({ mjml_source: message })).toBe(message)
  }
})

test('a problem with the code is named before any other field, and nothing at all means no detail', () => {
  expect(saveErrorDetail({ editor_state: 'The editor state is too large (over 3 MB).', mjml_source: 'mj-include is not allowed.' })).toBe('mj-include is not allowed.')
  expect(saveErrorDetail({ editor_state: 'The editor state is too large (over 3 MB).' })).toBe('The editor state is too large (over 3 MB).')
  expect(saveErrorDetail({})).toBeUndefined()
})
