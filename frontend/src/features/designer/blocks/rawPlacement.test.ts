/** Where a raw block may go, and how a parent that names its children learns a new one. */
import type { Editor } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import { RAW_PARENTS, RAW_PARENT_TYPES, allowChildIn } from './rawPlacement'

function editorWith(droppable: unknown) {
  const addType = vi.fn()
  const editor = { Components: { addType, getType: () => ({ model: { prototype: { defaults: { droppable } } } }) } } as unknown as Editor
  return { editor, addType }
}

test('a raw block may enter a column, the body, a wrapper and a hero: never a section (between columns) or the head', () => {
  expect(RAW_PARENT_TYPES).toEqual(['mj-body', 'mj-column', 'mj-wrapper', 'mj-hero'])
  expect(RAW_PARENTS).toBe('[data-gjs-type="mj-body"], [data-gjs-type="mj-column"], [data-gjs-type="mj-wrapper"], [data-gjs-type="mj-hero"]')
})

test('a parent that lists its children gets the new type appended; one that takes anything, or already names it, is left alone', () => {
  const listed = editorWith('[data-gjs-type="mj-section"], [data-gjs-type="mj-raw"]')
  allowChildIn(listed.editor, 'mj-body', 'cep-code')
  expect(listed.addType).toHaveBeenCalledWith('mj-body', { model: { defaults: { droppable: '[data-gjs-type="mj-section"], [data-gjs-type="mj-raw"], [data-gjs-type="cep-code"]' } } })

  const open = editorWith(true)
  allowChildIn(open.editor, 'mj-column', 'cep-code')
  expect(open.addType).not.toHaveBeenCalled()

  const already = editorWith('[data-gjs-type="cep-code"]')
  allowChildIn(already.editor, 'mj-body', 'cep-code')
  expect(already.addType).not.toHaveBeenCalled()

  const unknown = { Components: { addType: vi.fn(), getType: () => undefined } } as unknown as Editor
  allowChildIn(unknown, 'mj-hero', 'cep-code')
  expect(unknown.Components.addType).toHaveBeenCalledWith('mj-hero', { model: { defaults: { droppable: '[data-gjs-type="cep-code"]' } } })
})
