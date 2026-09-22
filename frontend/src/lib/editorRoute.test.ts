import { expect, test } from 'vitest'

import { editorRouteFor } from './editorRoute'

test('each channel opens its own editor, and anything else the message editor', () => {
  expect(editorRouteFor('E_RECEIPT')).toBe('receipt')
  expect(editorRouteFor('EMAIL')).toBe('design')
  expect(editorRouteFor('SMS')).toBe('message')
  expect(editorRouteFor('MMS')).toBe('message')
  expect(editorRouteFor('PUSH')).toBe('message')
})
