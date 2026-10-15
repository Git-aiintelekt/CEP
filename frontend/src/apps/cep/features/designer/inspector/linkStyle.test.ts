/** A link inside a text block: its colour and underline live in its own style attribute, which is what the email carries. */
import type { Component } from 'grapesjs'
import { expect, test } from 'vitest'

import { LINK_COLOR_KEY, LINK_UNDERLINE_KEY, UNDERLINE_OPTIONS, parseStyle, readLinkStyle, serialiseStyle, writeLinkStyle } from './linkStyle'
import { fieldsFor, readEffective, readSetting, writeSetting } from './settings'

function link(style?: string) {
  let attrs: Record<string, string> = { href: 'https://example.com', ...(style ? { style } : {}) }
  const removed: string[] = []
  return {
    get: (key: string) => (key === 'type' ? 'link' : key === 'tagName' ? 'a' : undefined),
    getAttributes: () => attrs,
    addAttributes: (next: Record<string, string>) => { attrs = { ...attrs, ...next } },
    removeAttributes: (key: string) => { removed.push(key); delete attrs[key] },
    removed,
  } as unknown as Component & { removed: string[] }
}

test('a style attribute is read as declarations and written back in the same order, tidy', () => {
  expect(parseStyle('color:#64748b; text-decoration : none;;font-weight:bold')).toEqual([['color', '#64748b'], ['text-decoration', 'none'], ['font-weight', 'bold']])
  expect(serialiseStyle([['color', '#64748b'], ['text-decoration', 'none']])).toBe('color:#64748b;text-decoration:none;')
  expect(serialiseStyle([])).toBe('')
})

test('colour and underline are read from the link, and written without touching its other declarations', () => {
  const a = link('font-weight:bold;color:#64748B;')
  expect(readLinkStyle(a, LINK_COLOR_KEY)).toBe('#64748b')
  expect(readLinkStyle(a, LINK_UNDERLINE_KEY)).toBeNull()                                          // nothing said: the email app underlines
  expect(writeLinkStyle(a, LINK_UNDERLINE_KEY, 'none')).toBe(true)
  expect(a.getAttributes().style).toBe('font-weight:bold;color:#64748B;text-decoration:none;')          // the colour is left exactly as it was typed
  expect(writeLinkStyle(a, LINK_COLOR_KEY, '#F00')).toBe(true)
  expect(a.getAttributes().style).toBe('font-weight:bold;color:#ff0000;text-decoration:none;')
  expect(readLinkStyle(a, LINK_UNDERLINE_KEY)).toBe('none')
  expect(writeLinkStyle(a, LINK_UNDERLINE_KEY, 'underline')).toBe(true)
  expect(readLinkStyle(a, LINK_UNDERLINE_KEY)).toBe('underline')
  expect(writeLinkStyle(a, LINK_UNDERLINE_KEY, null)).toBe(true)
  expect(writeLinkStyle(a, LINK_COLOR_KEY, null)).toBe(true)
  expect(a.getAttributes().style).toBe('font-weight:bold;')                                       // only what was there before
})

test('the last declaration gone takes the attribute with it; a colour that is not hex or an unknown underline is refused', () => {
  const a = link()
  expect(writeLinkStyle(a, LINK_COLOR_KEY, '#123456')).toBe(true)
  expect(writeLinkStyle(a, LINK_COLOR_KEY, null)).toBe(true)
  expect(a.getAttributes().style).toBeUndefined()
  expect(a.removed).toContain('style')
  expect(writeLinkStyle(a, LINK_COLOR_KEY, 'red')).toBe(false)
  expect(writeLinkStyle(a, LINK_UNDERLINE_KEY, 'dotted')).toBe(false)
  expect(readLinkStyle(link('color:rgb(1, 2, 3);'), LINK_COLOR_KEY)).toBe('rgb(1, 2, 3)')         // a pasted link's colour still reads
})

test('through the panel: two appearance fields on a link, the block’s own, and nothing on a text block', () => {
  expect(fieldsFor(link()).map((field) => field.key)).toEqual(['href', 'title', LINK_COLOR_KEY, LINK_UNDERLINE_KEY])
  expect(UNDERLINE_OPTIONS.map((option) => option.value)).toEqual(['none', 'underline'])
  const a = link('color:#112233;')
  expect(readSetting(a, LINK_COLOR_KEY)).toBe('#112233')
  expect(readEffective(a, LINK_UNDERLINE_KEY, null)).toEqual({ value: null, source: 'block' })
  expect(writeSetting(a, LINK_UNDERLINE_KEY, 'none')).toBe(true)
  expect(readSetting(a, LINK_UNDERLINE_KEY)).toBe('none')
  const text = { ...link('color:#112233;'), get: (key: string) => (key === 'type' ? 'mj-text' : undefined) } as unknown as Component
  expect(readSetting(text, LINK_COLOR_KEY)).toBeNull()
  expect(writeSetting(text, LINK_COLOR_KEY, '#ff0000')).toBe(false)
})
