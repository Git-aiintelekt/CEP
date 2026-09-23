import type { Component } from 'grapesjs'
import { afterEach, expect, test, vi } from 'vitest'

import { readSetting } from './settings'
import { createSettingBinder } from './useSettingBinding'

/** A component and an editor the binder can work with: no GrapesJS, which hangs under jsdom. */
function make(type: string, attributes: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { type, tagName: type }
  let attrs: Record<string, unknown> = { ...attributes }
  const children: { content: string }[] = []
  const calls: string[] = []
  const component = {
    calls,
    children,
    get: (key: string) => state[key],
    set: (key: string, value: unknown) => {
      calls.push(`set:${key}`)
      if (key === 'attributes') attrs = { ...(value as Record<string, unknown>) }
      else state[key] = value
    },
    parent: () => undefined,
    getAttributes: () => attrs,
    addAttributes: (next: Record<string, unknown>) => {
      calls.push(`write:${JSON.stringify(next)}`)
      attrs = { ...attrs, ...next }
    },
    removeAttributes: (key: string) => {
      calls.push(`clear:${key}`)
      delete attrs[key]
    },
    components: (value?: string) => {
      if (value !== undefined) {
        calls.push(`content:${value}`)
        children.splice(0, children.length, { content: value })
        return children
      }
      return { map: <T,>(fn: (child: Component) => T) => children.map((child) => fn(child as unknown as Component)) }
    },
  }
  return component as unknown as Component & { calls: string[] }
}

function editor() {
  const order: string[] = []
  return { order, UndoManager: { stop: () => order.push('stop'), start: () => order.push('start') } }
}

let open: (() => void) | null = null
afterEach(() => {
  open?.()
  open = null
})

test('a drag is one grouped edit: begin once, and the final value written once', () => {
  const host = editor()
  const section = make('mj-section', { 'background-color': '#000000' })
  const binder = createSettingBinder(host, section)
  const handlers = binder.handlers('background-color')

  for (const shade of ['#111111', '#222222', '#333333']) handlers.onPreview(shade)
  handlers.onCommit('#444444')

  expect(host.order).toEqual(['stop', 'start'])
  expect(readSetting(section, 'background-color')).toBe('#444444')
  // the restore lands between start and the final write, so only that last write can reach the undo stack
  expect(section.calls.at(-2)).toBe('set:attributes')
  expect(section.calls.at(-1)).toBe('write:{"background-color":"#444444"}')
  expect(binder.previewing()).toBe(false)
})

test('every preview reaches the model, so the canvas keeps up with the drag', () => {
  const host = editor()
  const section = make('mj-section')
  const handlers = createSettingBinder(host, section).handlers('background-color')

  handlers.onPreview('#111111')
  expect(readSetting(section, 'background-color')).toBe('#111111')
  handlers.onPreview('#222222')
  expect(readSetting(section, 'background-color')).toBe('#222222')
  handlers.onCommit('#222222')
})

test('cancelling a drag puts the value back and writes nothing', () => {
  const host = editor()
  const section = make('mj-section', { 'background-color': '#000000' })
  const binder = createSettingBinder(host, section)
  const handlers = binder.handlers('background-color')

  handlers.onPreview('#111111')
  handlers.onCancel()

  expect(readSetting(section, 'background-color')).toBe('#000000')
  expect(host.order).toEqual(['stop', 'start'])
  expect(section.calls.filter((call) => call.startsWith('write:'))).toEqual(['write:{"background-color":"#111111"}'])
  expect(binder.previewing()).toBe(false)
})

test('a discrete commit writes once and never opens a group', () => {
  const host = editor()
  const section = make('mj-section')
  createSettingBinder(host, section).handlers('padding').onCommit('10px')

  expect(host.order).toEqual([])
  expect(section.calls).toEqual(['write:{"padding":"10px"}'])
})

test('Reset clears the setting rather than writing an empty one', () => {
  const host = editor()
  const section = make('mj-section', { 'background-color': '#123456' })
  createSettingBinder(host, section).handlers('background-color').onCommit(null)

  expect('background-color' in section.getAttributes()).toBe(false)
  expect(section.calls).toEqual(['clear:background-color'])
})

test('a value MJML would refuse is not written', () => {
  const host = editor()
  const text = make('mj-text')
  const handlers = createSettingBinder(host, text).handlers('font-size')

  handlers.onCommit('2em')
  expect(readSetting(text, 'font-size')).toBe(null)
  expect(text.calls).toEqual([])
})

test('a refused value at the end of a drag still closes the group and rolls the previews back', () => {
  const host = editor()
  const text = make('mj-text', { 'font-size': '15px' })
  const binder = createSettingBinder(host, text)
  const handlers = binder.handlers('font-size')

  handlers.onPreview('20px')
  handlers.onCommit('2em')

  expect(readSetting(text, 'font-size')).toBe('15px')
  expect(host.order).toEqual(['stop', 'start'])
  expect(binder.previewing()).toBe(false)
})

test('releasing mid-drag, as the selection moving does, restores and re-arms undo', () => {
  const host = editor()
  const section = make('mj-section', { padding: '10px' })
  const binder = createSettingBinder(host, section)

  binder.handlers('padding').onPreview('40px')
  expect(binder.previewing()).toBe(true)
  binder.release()

  expect(readSetting(section, 'padding')).toBe('10px')
  expect(host.order).toEqual(['stop', 'start'])
  expect(binder.previewing()).toBe(false)
})

test('releasing when nothing is open does nothing at all', () => {
  const host = editor()
  const binder = createSettingBinder(host, make('mj-section'))
  binder.release()
  expect(host.order).toEqual([])
})

test('a second field starting a drag closes the first rather than losing its snapshot', () => {
  const host = editor()
  const section = make('mj-section', { padding: '10px', 'background-color': '#000000' })
  const binder = createSettingBinder(host, section)

  binder.handlers('padding').onPreview('40px')
  binder.handlers('background-color').onPreview('#111111')

  expect(readSetting(section, 'padding')).toBe('10px') // the abandoned drag was rolled back
  expect(host.order).toEqual(['stop', 'start', 'stop'])
  binder.handlers('background-color').onCommit('#111111')
  expect(host.order).toEqual(['stop', 'start', 'stop', 'start'])
})

test("a button's label is written as content, and clearing it is refused", () => {
  const host = editor()
  const button = make('mj-button')
  const handlers = createSettingBinder(host, button).handlers('label')

  handlers.onCommit('Shop now')
  expect(button.calls).toEqual(['content:Shop now'])

  handlers.onCommit(null)
  expect(button.calls).toEqual(['content:Shop now']) // a button with no words is not something to write
})

test('the binder reports the setting being dragged, so a caller can tell a preview from a value', () => {
  const host = editor()
  const section = make('mj-section')
  const binder = createSettingBinder(host, section)
  expect(binder.previewing()).toBe(false)
  binder.handlers('padding').onPreview('4px')
  expect(binder.previewing()).toBe(true)
  open = () => binder.release()
})

test('the handlers for one setting do not touch another', () => {
  const host = editor()
  const section = make('mj-section', { padding: '10px' })
  createSettingBinder(host, section).handlers('background-color').onCommit('#abcdef')

  expect(readSetting(section, 'padding')).toBe('10px')
  expect(readSetting(section, 'background-color')).toBe('#abcdef')
})

test('a hex is normalised on its way to the model', () => {
  const host = editor()
  const section = make('mj-section')
  createSettingBinder(host, section).handlers('background-color').onCommit('#ABC')
  expect(readSetting(section, 'background-color')).toBe('#aabbcc')
})

test('a stray onCommit from a field that never previewed is still one write', () => {
  const host = editor()
  const section = make('mj-section')
  const binder = createSettingBinder(host, section)
  const spy = vi.spyOn(section, 'addAttributes')

  binder.handlers('padding').onCommit('8px')
  expect(spy).toHaveBeenCalledTimes(1)
})
