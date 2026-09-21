/**
 * View-only mode on the canvas: a block can still be hovered, clicked, selected and walked up to its parent, so
 * its settings can be read, but nothing about it can change.
 */
import type { Component, Editor } from 'grapesjs'

export const VIEW_ONLY_NOTE = 'You can view this template but not edit it.'

/** What a component gives up. selectable, hoverable and highlightable are deliberately left alone. */
export const LOCKED = { editable: false, draggable: false, droppable: false, removable: false, copyable: false, resizable: false } as const

/** The toolbar's edit tools. Select parent is a function command, so it is kept by leaving it off this list. */
const EDIT_TOOLS = new Set(['tlb-move', 'tlb-clone', 'tlb-delete', 'image-editor'])

/** The keyboard's edit shortcuts; moving the selection with the arrow keys stays. */
export const EDIT_KEYMAPS = ['core:undo', 'core:redo', 'core:copy', 'core:paste', 'core:component-delete'] as const

export function lockComponent(component: Component): void {
  component.set(LOCKED)
  const toolbar = component.get('toolbar')
  if (Array.isArray(toolbar)) {
    component.set(
      'toolbar',
      toolbar.filter((item) => !EDIT_TOOLS.has(String((item as { command?: unknown }).command ?? ''))),
    )
  }
}

/**
 * Locks every component and the shortcuts. The undo stack is stopped first and never restarted: the locks are
 * model changes too, and an undo that could take them back off would be a way to edit.
 */
export function lockEditor(editor: Editor): void {
  editor.UndoManager.stop()
  editor.getWrapper()?.onAll(lockComponent)
  editor.UndoManager.clear()
  for (const id of EDIT_KEYMAPS) editor.Keymaps.remove(id)
}
