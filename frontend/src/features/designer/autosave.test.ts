import { expect, test } from 'vitest'

import { AUTOSAVE_MS, autosaveDue, type AutosaveState } from './autosave'

const editing: AutosaveState = { dirty: true, readOnly: false, conflict: false, restored: false, busy: false, stamp: '3|Subject|', failedStamp: null }

test('unsaved edits are saved on their own after half a minute of quiet', () => {
  expect(autosaveDue(editing)).toBe(true)
  expect(AUTOSAVE_MS).toBe(30_000)
})

test('nothing to save, nothing saved', () => {
  expect(autosaveDue({ ...editing, dirty: false })).toBe(false)
})

test('never while viewing, while another save runs, after a version conflict, or with an older version on the canvas', () => {
  expect(autosaveDue({ ...editing, readOnly: true })).toBe(false)
  expect(autosaveDue({ ...editing, busy: true })).toBe(false)
  expect(autosaveDue({ ...editing, conflict: true })).toBe(false)
  expect(autosaveDue({ ...editing, restored: true })).toBe(false)
})

test('a failed automatic save is not retried until the edits change', () => {
  expect(autosaveDue({ ...editing, failedStamp: '3|Subject|' })).toBe(false)
  expect(autosaveDue({ ...editing, stamp: '4|Subject|', failedStamp: '3|Subject|' })).toBe(true)
  expect(autosaveDue({ ...editing, stamp: '3|Subject!|', failedStamp: '3|Subject|' })).toBe(true)
})
