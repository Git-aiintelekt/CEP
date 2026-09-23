import type { Component, Editor } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import { EDIT_KEYMAPS, LOCKED, lockComponent, lockEditor } from './readOnly'

const selectParent = { command: (editor: Editor) => editor.runCommand('core:component-exit', { force: 1 }) }
const TOOLBAR = [selectParent, { command: 'tlb-move' }, { command: 'tlb-clone' }, { command: 'tlb-delete' }, { command: 'image-editor' }]

/** A component the lock can work with: no GrapesJS, which hangs under jsdom. */
function make(toolbar: unknown[] | undefined = [...TOOLBAR]) {
  const state: Record<string, unknown> = { toolbar, selectable: true, hoverable: true, highlightable: true }
  return {
    state,
    get: (key: string) => state[key],
    set: vi.fn((key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === 'string') state[key] = value
      else Object.assign(state, key)
    }),
  }
}

const asComponent = (fake: ReturnType<typeof make>) => fake as unknown as Component

test('a locked block can be neither typed into, dragged, dropped into, deleted, duplicated nor resized', () => {
  const block = make()
  lockComponent(asComponent(block))
  for (const [flag, value] of Object.entries(LOCKED)) expect(block.state[flag], flag).toBe(value)
  expect(Object.keys(LOCKED).sort()).toEqual(['copyable', 'draggable', 'droppable', 'editable', 'removable', 'resizable'])
})

test('a locked block can still be selected, hovered and outlined', () => {
  const block = make()
  lockComponent(asComponent(block))
  expect(block.state.selectable).toBe(true)
  expect(block.state.hoverable).toBe(true)
  expect(block.state.highlightable).toBe(true)
})

test('the toolbar keeps select parent and loses every edit tool', () => {
  const block = make()
  lockComponent(asComponent(block))
  expect(block.state.toolbar).toEqual([selectParent])
})

test('a block with no toolbar yet is locked all the same', () => {
  const block = make(undefined)
  expect(() => lockComponent(asComponent(block))).not.toThrow()
  expect(block.state.removable).toBe(false)
})

function editorWith(blocks: ReturnType<typeof make>[]) {
  const order: string[] = []
  const editor = {
    UndoManager: { stop: vi.fn(() => order.push('stop')), start: vi.fn(() => order.push('start')), clear: vi.fn(() => order.push('clear')) },
    Keymaps: { remove: vi.fn((id: string) => order.push(`remove:${id}`)) },
    getWrapper: () => ({
      onAll: (visit: (component: Component) => void) => {
        order.push('lock')
        blocks.forEach((block) => visit(asComponent(block)))
      },
    }),
  }
  return { editor: editor as unknown as Editor, order, raw: editor }
}

test('the whole design is locked, with the undo stack stopped first and never restarted', () => {
  const blocks = [make(), make(), make()]
  const { editor, order, raw } = editorWith(blocks)

  lockEditor(editor)

  for (const block of blocks) expect(block.state.editable).toBe(false)
  // the locks are model changes: recorded, an undo could take them back off
  expect(order.slice(0, 3)).toEqual(['stop', 'lock', 'clear'])
  expect(raw.UndoManager.start).not.toHaveBeenCalled()
})

test('the keyboard can no longer undo, redo, copy, paste or delete', () => {
  const { editor, raw } = editorWith([])
  lockEditor(editor)
  expect(raw.Keymaps.remove.mock.calls.map(([id]) => id)).toEqual([...EDIT_KEYMAPS])
  expect(EDIT_KEYMAPS).toEqual(['core:undo', 'core:redo', 'core:copy', 'core:paste', 'core:component-delete'])
})
