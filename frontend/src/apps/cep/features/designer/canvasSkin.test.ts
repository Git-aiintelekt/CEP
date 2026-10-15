import { afterEach, expect, test } from 'vitest'

import { HIDE_MOBILE_CLASS, SHADOW_LEVELS, shadowClass } from './blocks/register'
import { HIDDEN_ATTRIBUTE } from './layers/hidden'
import { CANVAS_SKIN_ID, DESIGN_RULES_ID, DESKTOP_ATTRIBUTE, PHONE_ATTRIBUTE, canvasSkin, designRules, injectCanvasSkin, paintPhoneWidth } from './canvasSkin'

/** The app's tokens live on :root; the test supplies them the way index.css does. */
function themed(
  values: Record<string, string> = { '--color-line': '#e7e8ef', '--color-brand-600': '#3863db', '--color-ink-300': '#9ea2ad', '--color-surface-subtle': '#f9fafb' },
) {
  const host = document.createElement('div')
  for (const [name, value] of Object.entries(values)) host.style.setProperty(name, value)
  document.body.appendChild(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

test('the skin resolves the tokens instead of carrying colours of its own', () => {
  const css = canvasSkin(themed())

  expect(css).toContain('#3863db')
  expect(css).toContain('#e7e8ef')
  expect(css).toContain('#9ea2ad')
  expect(css).toContain('#f9fafb')
  // no colour that did not come from a token
  expect(css).not.toMatch(/#(?!3863db|e7e8ef|9ea2ad|f9fafb)[0-9a-f]{3,8}\b/i)
  expect(css).not.toMatch(/\brgb|\bhsl/i)
})

test('a different theme produces a different skin, so nothing is baked in', () => {
  const css = canvasSkin(themed({ '--color-line': '#111111', '--color-brand-600': '#222222', '--color-ink-300': '#333333' }))

  expect(css).toContain('#222222')
  expect(css).not.toContain('#3863db')
})

test('selected is the action colour and hover is not', () => {
  const css = canvasSkin(themed())
  const rule = (name: string) => css.slice(css.indexOf(name)).split('}')[0]

  expect(rule('.gjs-selected.gjs-selected')).toContain('#3863db')
  expect(rule('.gjs-hovered')).toContain('#9ea2ad')
  expect(rule('.gjs-hovered')).not.toContain('#3863db')
})

test('both outlines are 1px, hug the element and carry no fill or glow', () => {
  const css = canvasSkin(themed())
  const rule = (name: string) => css.slice(css.indexOf(name)).split('}')[0]

  for (const name of ['.gjs-hovered', '.gjs-selected.gjs-selected']) {
    expect(rule(name), name).toMatch(/outline: 1px solid/)
    expect(rule(name), name).toMatch(/outline-offset: 0/)
  }
  expect(rule('.gjs-selected.gjs-selected')).toContain('box-shadow: none')
  expect(rule('.gjs-hovered')).toContain('background-color: transparent')
})

test('it answers GrapesJS in kind, or its own !important rules would win', () => {
  const css = canvasSkin(themed())
  expect(css.match(/!important/g)?.length).toBeGreaterThanOrEqual(4)
})

test('it styles only the editing chrome, never the email', () => {
  const selectors = canvasSkin(themed())
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((block) => block.split('{')[0].trim())
    .filter(Boolean)

  expect(selectors.length).toBeGreaterThan(0)
  // GrapesJS's own chrome classes, the attribute the layers panel paints on the frame's DOM, or the phone-width
  // preview — which does name a class of ours in the email, and so is only ever reached through that attribute.
  // The frame's root scroller, whose scrollbar is hidden, is the one exception: it is the page around the email.
  // Nothing else: the email's own tags, classes and styles are never targeted.
  for (const selector of selectors.filter((s) => !/^html(::-webkit-scrollbar)?$/.test(s))) {
    expect(selector, selector).toMatch(new RegExp(`gjs-|\\[${HIDDEN_ATTRIBUTE}\\]|^\\[${PHONE_ATTRIBUTE}\\] |^\\[${DESKTOP_ATTRIBUTE}\\] `))
  }
})

test('it hides the frame scrollbar without stopping the frame from scrolling', () => {
  const css = canvasSkin(themed())
  expect(css).toMatch(/html \{\s*scrollbar-width: none;/)
  expect(css).toContain('html::-webkit-scrollbar')
  expect(css).not.toMatch(/overflow:\s*hidden/)
})

test('the hidden rule matches only the attribute we paint, and only inside the frame', () => {
  const css = canvasSkin(themed())
  expect(HIDDEN_ATTRIBUTE).toMatch(/^data-/)
  expect(css).toContain(`[${HIDDEN_ATTRIBUTE}][${HIDDEN_ATTRIBUTE}] {`)
  expect(css).toMatch(/display: none !important/)
})

test('an unreadable token leaves an invalid declaration rather than a wrong colour', () => {
  const css = canvasSkin(document.createElement('div')) // no tokens set
  // an empty colour makes the whole declaration invalid, so the browser drops it and GrapesJS's default stands
  expect(css).toMatch(/outline: 1px solid\s+!important/)
  expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
})

test('injecting puts one tagged style in the frame head', () => {
  const frame = document.implementation.createHTMLDocument()
  injectCanvasSkin(frame, canvasSkin(themed()))

  const tag = frame.getElementById(CANVAS_SKIN_ID)
  expect(tag?.tagName).toBe('STYLE')
  expect(tag?.parentElement).toBe(frame.head)
  expect(tag?.textContent).toContain('#3863db')
})

test('re-injecting replaces the old copy instead of stacking', () => {
  const frame = document.implementation.createHTMLDocument()
  injectCanvasSkin(frame, canvasSkin(themed()))
  injectCanvasSkin(frame, canvasSkin(themed({ '--color-brand-600': '#000fff' })))

  expect(frame.querySelectorAll(`#${CANVAS_SKIN_ID}`)).toHaveLength(1)
  expect(frame.getElementById(CANVAS_SKIN_ID)?.textContent).toContain('#000fff')
})

test('a frame that is not ready is left alone', () => {
  expect(() => injectCanvasSkin(null, 'x')).not.toThrow()
  expect(() => injectCanvasSkin(undefined, 'x')).not.toThrow()
})

test('an image with no source reads as a waiting slot, not a warning', () => {
  const css = canvasSkin(themed())
  const placeholder = /\.gjs-plh-image[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(placeholder).toContain('#9ea2ad')
  expect(placeholder).toContain('#f9fafb')
  expect(placeholder).toMatch(/outline:\s*1px/)
  // GrapesJS writes 3px solid #ffca6f into the frame; doubling the class is what beats it
  expect(css).toContain('.gjs-plh-image.gjs-plh-image')
  expect(css).not.toContain('ffca6f')
})

// ---- hidden on phones ----------------------------------------------------

test('the rule always ships, scoped so it bites only at the phone width', () => {
  const css = canvasSkin(themed())

  expect(css).toContain(`[${PHONE_ATTRIBUTE}] .${HIDE_MOBILE_CLASS}`)
  // css-class only becomes a real class once MJML compiles the email, so the attribute is matched as well
  expect(css).toContain(`[${PHONE_ATTRIBUTE}] [css-class~="${HIDE_MOBILE_CLASS}"]`)
  expect(css).toContain('display: none !important')
  // never unscoped: an unscoped selector would hide the block at every width
  expect(css).not.toMatch(new RegExp(`^\\.${HIDE_MOBILE_CLASS}`, 'm'))
})

test('the phone width is one attribute on the frame, which a re-render can put straight back', () => {
  const frame = document.implementation.createHTMLDocument('frame')

  paintPhoneWidth(frame, true)
  expect(frame.documentElement.hasAttribute(PHONE_ATTRIBUTE)).toBe(true)
  expect(frame.documentElement.hasAttribute(DESKTOP_ATTRIBUTE)).toBe(false)

  paintPhoneWidth(frame, false)
  expect(frame.documentElement.hasAttribute(PHONE_ATTRIBUTE)).toBe(false)
  expect(frame.documentElement.hasAttribute(DESKTOP_ATTRIBUTE)).toBe(true)                      // a block hidden on desktop is hidden at this width

  expect(() => paintPhoneWidth(null, true)).not.toThrow()
})

test('the shadow rules travel beside the skin, not in it: the email has its own classes and its own colours', () => {
  const rules = designRules()
  for (const level of SHADOW_LEVELS) expect(rules).toContain(`[css-class~="${shadowClass(level)}"]`)
  expect(rules).toContain('box-shadow: 0 4px 12px rgba(15,23,42,0.16)')
  expect(canvasSkin(themed())).not.toContain('cep-shadow')

  const frame = document.implementation.createHTMLDocument('frame')
  injectCanvasSkin(frame, canvasSkin(themed()))
  injectCanvasSkin(frame, canvasSkin(themed()))                                                      // replaced, never doubled
  expect(frame.querySelectorAll('style').length).toBe(2)
  expect(frame.getElementById(DESIGN_RULES_ID)?.textContent).toBe(rules)
})
