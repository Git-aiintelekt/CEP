/**
 * Where a raw-HTML block may land. The MJML plugin lets an mj-raw be dragged into the body or the head only, and
 * a block that extends it inherits that, so Custom HTML could only sit between sections and the barcode and QR code
 * blocks (a type of their own, which no parent's list named) could not be dropped anywhere. MJML itself takes an
 * mj-raw inside a column, a wrapper and a hero as well as the body, and that is where a designer expects to put one.
 */
import type { Editor } from 'grapesjs'

const selector = (types: readonly string[]) => types.map((type) => `[data-gjs-type="${type}"]`).join(', ')

/** The parents a raw block may be dragged into: every place MJML accepts an mj-raw that holds body content. */
export const RAW_PARENT_TYPES = ['mj-body', 'mj-column', 'mj-wrapper', 'mj-hero'] as const
export const RAW_PARENTS = selector(RAW_PARENT_TYPES)

/** Adds a child type to a parent type's accept-list; a parent that accepts anything is left alone. */
export function allowChildIn(editor: Editor, parentType: string, childType: string): void {
  const parent = editor.Components.getType(parentType)?.model.prototype as { defaults?: unknown } | undefined
  const defaults = (typeof parent?.defaults === 'function' ? parent.defaults() : parent?.defaults) as { droppable?: unknown } | undefined
  const current = defaults?.droppable
  if (current === true) return
  const wanted = `[data-gjs-type="${childType}"]`
  if (typeof current === 'string' && current.includes(wanted)) return
  editor.Components.addType(parentType, { model: { defaults: { droppable: typeof current === 'string' && current !== '' ? `${current}, ${wanted}` : wanted } } })
}
