import type { Component, Editor } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import { buildNodes, moveLayer } from './layersAdapter'

/** A section-like component: only the members the adapter reads. */
function part(id: string, draggable = true): Component {
  const props: Record<string, unknown> = { type: 'mj-section', draggable }
  return {
    get: (key: string) => props[key],
    getId: () => id,
    getAttributes: () => ({}),
    getClasses: () => [],
    parent: () => body,
    move: vi.fn(),
  } as unknown as Component
}

let body: Component

/** A body holding the given sections, and an editor that sees only that. */
function editorWith(sections: Component[]): Editor {
  body = { get: () => 'mj-body', getId: () => 'body' } as unknown as Component
  return {
    getWrapper: () => ({ findType: (type: string) => (type === 'mj-body' ? [body] : []) }),
    getSelected: () => undefined,
    select: vi.fn(),
    Canvas: { scrollTo: vi.fn() },
    Layers: { getComponents: (component: Component) => (component === body ? sections : []), isOpen: () => false },
  } as unknown as Editor
}

const moves = (editor: Editor) => buildNodes(editor, new Set()).map(({ id, draggable, canMoveUp, canMoveDown }) => ({ id, draggable, canMoveUp, canMoveDown }))

test('ordinary sections move past each other', () => {
  expect(moves(editorWith([part('a'), part('b'), part('c')]))).toEqual([
    { id: 'a', draggable: true, canMoveUp: false, canMoveDown: true },
    { id: 'b', draggable: true, canMoveUp: true, canMoveDown: true },
    { id: 'c', draggable: true, canMoveUp: true, canMoveDown: false },
  ])
})

test('a locked block does not move', () => {
  const [, locked] = moves(editorWith([part('a'), part('slot', false), part('c')]))
  expect(locked).toEqual({ id: 'slot', draggable: false, canMoveUp: false, canMoveDown: false })
})

test('a block is not moved past a locked block above or below it', () => {
  const [above, , below] = moves(editorWith([part('a'), part('slot', false), part('c')]))
  expect(above.canMoveDown).toBe(false)
  expect(below.canMoveUp).toBe(false)
  expect(above.canMoveUp).toBe(false)
  expect(below.canMoveDown).toBe(false)
})

test('moveLayer leaves a locked block, and its neighbours, where they are', () => {
  const sections = [part('a'), part('slot', false), part('c')]
  const editor = editorWith(sections)

  moveLayer(editor, 'slot', 'up')
  moveLayer(editor, 'slot', 'down')
  moveLayer(editor, 'a', 'down')
  moveLayer(editor, 'c', 'up')

  for (const section of sections) expect(section.move, String(section.getId())).not.toHaveBeenCalled()
})

test('moveLayer still moves an unlocked block', () => {
  const sections = [part('a'), part('b')]
  const editor = editorWith(sections)

  moveLayer(editor, 'a', 'down')
  expect(sections[0].move).toHaveBeenCalledWith(body, { at: 2 })
})
