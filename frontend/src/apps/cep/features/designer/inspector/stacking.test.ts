/** A section's columns on a phone: stacked left first (MJML's way), kept side by side (an mj-group), or stacked right first (rtl). */
import type { Component } from 'grapesjs'
import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { STACKING_KEY, STACKING_OPTIONS, readStacking, writeStacking } from './stacking'
import { readSetting, writeSetting } from './settings'

/** Enough of a GrapesJS component tree to move columns about: components(), move, append, remove, attributes. */
interface Node {
  type: string
  name: string
  kids: Node[]
  parent: Node | null
  attrs: Record<string, string>
  get: (key: string) => string | undefined
  getAttributes: () => Record<string, string>
  addAttributes: (next: Record<string, string>) => void
  removeAttributes: (key: string) => void
  components: () => Node[]
  move: (target: Node, opts: { at: number }) => void
  append: (html: string, opts?: { at?: number }) => Node[]
  remove: () => void
}

function node(type: string, name = type, kids: Node[] = []): Node {
  const self: Node = {
    type, name, kids: [], parent: null, attrs: {},
    get: (key) => (key === 'type' || key === 'tagName' ? type : undefined),
    getAttributes: () => self.attrs,
    addAttributes: (next) => Object.assign(self.attrs, next),
    removeAttributes: (key) => { delete self.attrs[key] },
    components: () => self.kids,
    move: (target, { at }) => {
      if (self.parent) self.parent.kids.splice(self.parent.kids.indexOf(self), 1)
      target.kids.splice(at, 0, self)
      self.parent = target
    },
    append: (html, opts) => {
      const made = node(/^<(mj-[a-z-]+)>/.exec(html)?.[1] ?? 'default')
      made.parent = self
      self.kids.splice(opts?.at ?? self.kids.length, 0, made)
      return [made]
    },
    remove: () => { if (self.parent) self.parent.kids.splice(self.parent.kids.indexOf(self), 1) },
  }
  for (const kid of kids) { kid.parent = self; self.kids.push(kid) }
  return self
}
const as = (n: Node) => n as unknown as Component
const shape = (section: Node) => section.kids.map((kid) => (kid.type === 'mj-group' ? `group(${kid.kids.map((c) => c.name).join(',')})` : kid.name)).join(' ')

test('the three answers, and each one back to plain stacking', () => {
  const section = node('mj-section', 'section', [node('mj-column', 'left'), node('mj-column', 'right')])
  expect(readStacking(as(section))).toBe('stack')

  expect(writeStacking(as(section), 'keep')).toBe(true)
  expect(shape(section)).toBe('group(left,right)')
  expect(readStacking(as(section))).toBe('keep')

  expect(writeStacking(as(section), 'reverse')).toBe(true)                        // from keep: unwrapped, then reversed
  expect(shape(section)).toBe('right left')
  expect(section.attrs.direction).toBe('rtl')
  expect(readStacking(as(section))).toBe('reverse')

  expect(writeStacking(as(section), 'keep')).toBe(true)                           // from reverse: order and direction restored, then grouped
  expect(shape(section)).toBe('group(left,right)')
  expect(section.attrs.direction).toBeUndefined()

  expect(writeStacking(as(section), 'stack')).toBe(true)
  expect(shape(section)).toBe('left right')
  expect(readStacking(as(section))).toBe('stack')
  expect(writeStacking(as(section), 'stack')).toBe(true)                          // a no-op stays a no-op
  expect(shape(section)).toBe('left right')
})

test('three columns keep their order through a round trip, and a section with no columns is refused', () => {
  const section = node('mj-section', 'section', [node('mj-column', 'a'), node('mj-column', 'b'), node('mj-column', 'c')])
  writeStacking(as(section), 'reverse')
  expect(shape(section)).toBe('c b a')
  writeStacking(as(section), 'stack')
  expect(shape(section)).toBe('a b c')
  expect(writeStacking(as(node('mj-section', 'empty')), 'keep')).toBe(false)
})

test('through the panel: the select is a section setting with three options, and never on a column', () => {
  expect(STACKING_OPTIONS.map((option) => option.value)).toEqual(['stack', 'keep', 'reverse'])
  const section = node('mj-section', 'section', [node('mj-column', 'left'), node('mj-column', 'right')])
  expect(readSetting(as(section), STACKING_KEY)).toBe('stack')
  expect(writeSetting(as(section), STACKING_KEY, 'keep')).toBe(true)
  expect(readSetting(as(section), STACKING_KEY)).toBe('keep')
  expect(readSetting(as(node('mj-column')), STACKING_KEY)).toBeNull()
  expect(writeSetting(as(node('mj-column')), STACKING_KEY, 'keep')).toBe(false)
})

test('MJML compiles both answers: columns with padding inside a group, and a right-to-left section whose columns stay left-to-right inside', () => {
  const grouped = mjml2html('<mjml><mj-body><mj-section><mj-group><mj-column padding="8px"><mj-text>Left</mj-text></mj-column><mj-column padding="8px"><mj-text>Right</mj-text></mj-column></mj-group></mj-section></mj-body></mjml>')
  expect(grouped.errors).toEqual([])
  expect(grouped.html).toContain('mj-column-per-50')

  const reversed = mjml2html('<mjml><mj-body><mj-section direction="rtl"><mj-column><mj-text>Right</mj-text></mj-column><mj-column><mj-text>Left</mj-text></mj-column></mj-section></mj-body></mjml>')
  expect(reversed.errors).toEqual([])
  expect(reversed.html).toMatch(/direction:rtl/)
  expect(reversed.html).toMatch(/direction:ltr/)
})
