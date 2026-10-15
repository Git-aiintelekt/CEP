import type { Component, Editor } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import { CUSTOM_HTML_TYPE, registerCustomHtmlType } from './customHtml'
import { RAW_PARENTS } from './rawPlacement'

interface TypeDefinition {
  extend: string
  isComponent: (el: HTMLElement) => boolean
  model: { defaults: Record<string, unknown>; init: (this: Component) => void }
}

interface Fake {
  set: ReturnType<typeof vi.fn>
  listenTo: ReturnType<typeof vi.fn>
  components: () => Fake[]
}

function fakeComponent(children: Fake[] = []): Fake {
  return { set: vi.fn(), listenTo: vi.fn(), components: () => children }
}

test('the Custom HTML block keeps its own type and makes everything inside it inert, now and whenever the panel rewrites it', () => {
  const addType = vi.fn()
  const originalInit = vi.fn()
  const editor = { Components: { addType, getType: () => ({ model: { prototype: { init: originalInit } } }) } } as unknown as Editor
  registerCustomHtmlType(editor)

  expect(addType).toHaveBeenCalledTimes(1)
  expect(addType.mock.calls[0][0]).toBe(CUSTOM_HTML_TYPE)
  const definition = addType.mock.calls[0][1] as TypeDefinition
  expect(definition.extend).toBe(CUSTOM_HTML_TYPE)
  expect(definition.isComponent(document.createElement('mj-raw'))).toBe(true)                        // still recognised after the re-add
  expect(definition.isComponent(document.createElement('mj-text'))).toBe(false)
  expect(definition.model.defaults).toEqual({ draggable: RAW_PARENTS, droppable: false })                // into a column too; nothing dropped into it

  const cell = fakeComponent()
  const row = fakeComponent([cell])
  const raw = fakeComponent([row])
  definition.model.init.call(raw as unknown as Component)

  expect(originalInit).toHaveBeenCalledTimes(1)                                                       // the plugin's own set-up still runs
  for (const inner of [row, cell]) {
    expect(inner.set).toHaveBeenCalledWith(expect.objectContaining({ selectable: false, hoverable: false, draggable: false, layerable: false, editable: false }))
  }
  expect(raw.set).not.toHaveBeenCalled()                                                              // the block itself stays selectable
  expect(raw.listenTo).toHaveBeenCalledWith(raw.components(), 'add', expect.any(Function))
})
