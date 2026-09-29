import type { Component, Editor } from 'grapesjs'
import { expect, test, vi, type Mock } from 'vitest'

import {
  FOOTER_CLASS, HIDE_DESKTOP_CLASS, HIDE_DESKTOP_RULE, HIDE_MOBILE_CLASS, HIDE_MOBILE_RULE, SHADOW_RULE, hasCssClass, hiddenOnDesktopIn, hiddenOnPhonesIn, hideDesktopStylesIn, hideMobileStylesIn, isHiddenOnDesktop, isHiddenOnPhones, setCssClass, setShadow, shadowClass, shadowOf, syncHideDesktopStyle, syncHideMobileStyle, syncShadowStyle,
} from './register'

/** A component the class helpers can work with: no GrapesJS, which hangs under jsdom. */
interface Fake {
  tag: string
  children: Fake[]
  parent: Fake | undefined
  removed: boolean
  get: (key: string) => string | undefined
  getAttributes: () => Record<string, unknown>
  getClasses: () => string[]
  addAttributes: (next: Record<string, unknown>) => void
  removeAttributes: (key: string) => void
  toHTML: () => string
  remove: () => void
  append: Mock<(html: string, options?: { at?: number }) => Fake[]>
  onAll: (visit: (node: Component) => void) => void
  findType: (type: string) => Component[]
}

/** The helpers take GrapesJS components; the fake carries only the handful of members they reach for. */
const asComponent = (fake: Fake): Component => fake as unknown as Component

function make(tag: string, attributes: Record<string, unknown> = {}, classes: string[] = []): Fake {
  let attrs = { ...attributes }
  const children: Fake[] = []
  const component: Fake = {
    tag,
    children,
    parent: undefined,
    removed: false,
    get: (key: string) => (key === 'tagName' || key === 'type' ? tag : undefined),
    getAttributes: () => attrs,
    getClasses: () => classes,
    addAttributes: (next: Record<string, unknown>) => {
      attrs = { ...attrs, ...next }
    },
    removeAttributes: (key: string) => {
      delete attrs[key]
    },
    // an mj-style keeps its rule as its content, which is what tells one style apart from another
    toHTML: () => `<${tag}>${String(attrs.content ?? '')}</${tag}>`,
    remove: () => {
      component.removed = true
      const index = component.parent?.children.indexOf(component) ?? -1
      if (index >= 0) component.parent?.children.splice(index, 1)
    },
    append: vi.fn((html: string, options?: { at?: number }) => {
      const parsed = /^<(mj-[a-z-]+)>([\s\S]*)<\/mj-[a-z-]+>$/.exec(html)
      const added = make(parsed?.[1] ?? 'default', parsed?.[2] ? { content: parsed[2] } : {})
      added.parent = component
      children.splice(options?.at ?? children.length, 0, added)
      return [added]
    }),
    onAll: () => {},
    findType: () => [],
  }
  return component
}

function nest(parent: Fake, ...kids: Fake[]): Fake {
  for (const kid of kids) {
    kid.parent = parent
    parent.children.push(kid)
  }
  return parent
}

function walk(node: Fake, visit: (node: Fake) => void): void {
  for (const kid of node.children) {
    visit(kid)
    walk(kid, visit)
  }
}

function editorFor(wrapper: Fake) {
  const undo = { stop: vi.fn(), start: vi.fn() }
  const editor = {
    UndoManager: undo,
    getWrapper: () => asComponent(wrapper),
    undo,
  }
  wrapper.onAll = (visit: (node: Component) => void) => walk(wrapper, (node) => visit(asComponent(node)))
  wrapper.findType = (type: string) => {
    const found: Fake[] = []
    walk(wrapper, (node) => {
      if (node.tag === type) found.push(node)
    })
    return found.map(asComponent)
  }
  return editor as unknown as Editor & { undo: typeof undo }
}

// ---- the class on a block ------------------------------------------------

test('the switch adds the class and taking it off removes it again', () => {
  const section = make('mj-section')
  expect(isHiddenOnPhones(asComponent(section))).toBe(false)

  setCssClass(asComponent(section), HIDE_MOBILE_CLASS, true)
  expect(section.getAttributes()['css-class']).toBe(HIDE_MOBILE_CLASS)
  expect(isHiddenOnPhones(asComponent(section))).toBe(true)

  setCssClass(asComponent(section), HIDE_MOBILE_CLASS, false)
  expect(section.getAttributes()['css-class']).toBeUndefined()
  expect(isHiddenOnPhones(asComponent(section))).toBe(false)
})

test('the footer class, and any other class, is left exactly as it was', () => {
  const footer = make('mj-section', { 'css-class': `${FOOTER_CLASS} brand-band` })

  setCssClass(asComponent(footer), HIDE_MOBILE_CLASS, true)
  expect(footer.getAttributes()['css-class']).toBe(`${FOOTER_CLASS} brand-band ${HIDE_MOBILE_CLASS}`)

  setCssClass(asComponent(footer), HIDE_MOBILE_CLASS, false)
  expect(footer.getAttributes()['css-class']).toBe(`${FOOTER_CLASS} brand-band`)
  expect(hasCssClass(asComponent(footer), FOOTER_CLASS)).toBe(true)
})

test('turning it on twice leaves one copy of the class', () => {
  const section = make('mj-section')
  setCssClass(asComponent(section), HIDE_MOBILE_CLASS, true)
  setCssClass(asComponent(section), HIDE_MOBILE_CLASS, true)
  expect(section.getAttributes()['css-class']).toBe(HIDE_MOBILE_CLASS)
})

test('the class is read from a real class list too, not only from the attribute', () => {
  const section = make('mj-section', {}, [HIDE_MOBILE_CLASS])
  expect(isHiddenOnPhones(asComponent(section))).toBe(true)
})

test('the class lives in the attribute map, which is what a saved project carries', () => {
  const section = make('mj-section')
  setCssClass(asComponent(section), HIDE_MOBILE_CLASS, true)

  // getProjectData serialises the attribute map; anything kept off it would not survive a save and reload
  const reloaded = make('mj-section', JSON.parse(JSON.stringify(section.getAttributes())))
  expect(isHiddenOnPhones(asComponent(reloaded))).toBe(true)
})

// ---- the rule in mj-head -------------------------------------------------

test('the rule is added to mj-head as soon as one block uses the class', () => {
  const head = make('mj-head')
  const section = make('mj-section', { 'css-class': HIDE_MOBILE_CLASS })
  const wrapper = nest(make('wrapper'), nest(make('mjml'), head, nest(make('mj-body'), section)))
  const editor = editorFor(wrapper)

  syncHideMobileStyle(editor)

  const styles = hideMobileStylesIn(editor)
  expect(styles).toHaveLength(1)
  expect(head.append).toHaveBeenCalledWith(`<mj-style>${HIDE_MOBILE_RULE}</mj-style>`)
})

test('the rule names the class and never asks MJML to inline it', () => {
  expect(HIDE_MOBILE_RULE).toContain(`.${HIDE_MOBILE_CLASS}`)
  expect(HIDE_MOBILE_RULE).toContain('max-width:480px')
  expect(HIDE_MOBILE_RULE).toContain('display:none!important')
  expect(HIDE_MOBILE_RULE).not.toContain('inline')
})

test('the rule goes away again when the last block stops using the class', () => {
  const style = make('mj-style', { content: HIDE_MOBILE_RULE })
  const section = make('mj-section', { 'css-class': HIDE_MOBILE_CLASS })
  const wrapper = nest(make('wrapper'), nest(make('mjml'), nest(make('mj-head'), style), nest(make('mj-body'), section)))
  const editor = editorFor(wrapper)

  setCssClass(asComponent(section), HIDE_MOBILE_CLASS, false)
  syncHideMobileStyle(editor)

  expect(hiddenOnPhonesIn(editor)).toHaveLength(0)
  expect(hideMobileStylesIn(editor)).toHaveLength(0)
  expect(style.removed).toBe(true)
})

test('two blocks hidden on phones still share one copy of the rule', () => {
  const head = make('mj-head')
  const first = make('mj-section', { 'css-class': HIDE_MOBILE_CLASS })
  const second = make('mj-section', { 'css-class': HIDE_MOBILE_CLASS })
  const wrapper = nest(make('wrapper'), nest(make('mjml'), head, nest(make('mj-body'), first, second)))
  const editor = editorFor(wrapper)

  syncHideMobileStyle(editor)
  syncHideMobileStyle(editor)

  expect(hideMobileStylesIn(editor)).toHaveLength(1)
  expect(head.append).toHaveBeenCalledTimes(1)
})

test('a duplicate rule that somehow arrived is trimmed back to one', () => {
  const head = nest(make('mj-head'), make('mj-style', { content: HIDE_MOBILE_RULE }), make('mj-style', { content: HIDE_MOBILE_RULE }))
  const section = make('mj-section', { 'css-class': HIDE_MOBILE_CLASS })
  const editor = editorFor(nest(make('wrapper'), nest(make('mjml'), head, nest(make('mj-body'), section))))

  syncHideMobileStyle(editor)

  expect(hideMobileStylesIn(editor)).toHaveLength(1)
})

test("another design's mj-style is left alone", () => {
  const brand = make('mj-style', { content: '.brand-band{background:#fff}' })
  const head = nest(make('mj-head'), brand)
  const editor = editorFor(nest(make('wrapper'), nest(make('mjml'), head, make('mj-body'))))

  syncHideMobileStyle(editor)

  expect(brand.removed).toBe(false)
  expect(hideMobileStylesIn(editor)).toHaveLength(0)
})

test('the head is put right outside the undo stack, so one undo moves only the class', () => {
  const head = make('mj-head')
  const section = make('mj-section', { 'css-class': HIDE_MOBILE_CLASS })
  const editor = editorFor(nest(make('wrapper'), nest(make('mjml'), head, nest(make('mj-body'), section))))

  syncHideMobileStyle(editor)

  expect(editor.undo.stop).toHaveBeenCalledTimes(1)
  expect(editor.undo.start).toHaveBeenCalledTimes(1)
})

test('nothing to do means the undo stack is never touched at all', () => {
  const editor = editorFor(nest(make('wrapper'), nest(make('mjml'), make('mj-head'), make('mj-body'))))

  syncHideMobileStyle(editor)

  expect(editor.undo.stop).not.toHaveBeenCalled()
  expect(editor.undo.start).not.toHaveBeenCalled()
})

test('a design that arrived without an mj-head gets one, before mj-body', () => {
  const root = make('mjml')
  const section = make('mj-section', { 'css-class': HIDE_MOBILE_CLASS })
  const editor = editorFor(nest(make('wrapper'), nest(root, nest(make('mj-body'), section))))

  syncHideMobileStyle(editor)

  expect(root.append).toHaveBeenCalledWith('<mj-head></mj-head>', { at: 0 })
})

// ---- the shadow: one class among three, and its own head rule ---------------

test('a shadow is one class among three, and its rule follows the blocks into the head and out again', () => {
  const section = make('mj-section', { 'css-class': 'brand-band' })
  setShadow(asComponent(section), 'soft')
  expect(section.getAttributes()['css-class']).toBe(`brand-band ${shadowClass('soft')}`)
  expect(shadowOf(asComponent(section))).toBe('soft')
  setShadow(asComponent(section), 'strong')
  expect(section.getAttributes()['css-class']).toBe(`brand-band ${shadowClass('strong')}`)

  const head = make('mj-head')
  const wrapper = nest(make('wrapper'), nest(make('mjml'), head, nest(make('mj-body'), section)))
  const editor = editorFor(wrapper)
  syncShadowStyle(editor)
  expect(head.children.map((child) => child.getAttributes().content)).toEqual([SHADOW_RULE])
  syncShadowStyle(editor)                                                                             // settled: nothing added twice
  expect(head.children).toHaveLength(1)
  expect(editor.undo.stop).toHaveBeenCalledTimes(1)                                                    // the head is kept outside the undo stack

  setShadow(asComponent(section), null)
  expect(section.getAttributes()['css-class']).toBe('brand-band')
  syncShadowStyle(editor)
  expect(head.children).toHaveLength(0)
})

// ---- the same, the other side of the breakpoint ---------------------------

test('hide on desktop is its own class with its own rule, kept in mj-head the same way', () => {
  expect(HIDE_DESKTOP_RULE.startsWith(`.${HIDE_DESKTOP_CLASS}{display:none!important;mso-hide:all!important;}`)).toBe(true)   // hidden everywhere first: Outlook reads this
  expect(HIDE_DESKTOP_RULE).toContain('@media only screen and (max-width:480px)')                                            // then shown on a phone
  expect(HIDE_DESKTOP_RULE).toContain(`td.${HIDE_DESKTOP_CLASS}{display:table-cell!important;}`)
  expect(HIDE_DESKTOP_RULE).toContain(`div.${HIDE_DESKTOP_CLASS}[class*="mj-column-per"]{display:inline-block!important;}`)
  expect(HIDE_DESKTOP_RULE).not.toContain('min-width')
  expect(HIDE_DESKTOP_RULE).not.toContain('inline=')

  const text = make('mj-text', { 'css-class': HIDE_MOBILE_CLASS })
  expect(isHiddenOnDesktop(asComponent(text))).toBe(false)
  setCssClass(asComponent(text), HIDE_DESKTOP_CLASS, true)
  expect(text.getAttributes()['css-class']).toBe(`${HIDE_MOBILE_CLASS} ${HIDE_DESKTOP_CLASS}`)    // both may be on: the block hides everywhere
  expect(isHiddenOnDesktop(asComponent(text))).toBe(true)
  expect(isHiddenOnPhones(asComponent(text))).toBe(true)

  const head = make('mj-head')
  const wrapper = nest(make('wrapper'), nest(make('mjml'), head, nest(make('mj-body'), nest(make('mj-section'), nest(make('mj-column'), text)))))
  const editor = editorFor(wrapper)
  syncHideDesktopStyle(editor)
  syncHideDesktopStyle(editor)
  expect(hiddenOnDesktopIn(editor)).toHaveLength(1)
  expect(hideDesktopStylesIn(editor)).toHaveLength(1)
  expect(head.append).toHaveBeenCalledTimes(1)
  expect(head.append).toHaveBeenCalledWith(`<mj-style>${HIDE_DESKTOP_RULE}</mj-style>`)
  expect(hideMobileStylesIn(editor)).toHaveLength(0)                                               // the phones rule is a separate style

  setCssClass(asComponent(text), HIDE_DESKTOP_CLASS, false)
  syncHideDesktopStyle(editor)
  expect(hideDesktopStylesIn(editor)).toHaveLength(0)
})
