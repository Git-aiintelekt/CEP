import type { Component } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import {
  ATTRIBUTE_RULES, BORDER_COLOR_KEY, BORDER_STYLE_KEY, BORDER_WIDTH_KEY, HIDE_MOBILE_KEY, SHADOW_KEY, parseBorder, HTML_KEY, LABEL_KEY, MARGIN_KEY, SETTINGS_BY_BLOCK, addSocialElement, beginGroupedEdit, blockType, endGroupedEdit, fieldsFor,
  normaliseHex, readEffective, readSetting, sectionFields, unitsFor, writeContent, writeSetting,
} from './settings'
import { FOOTER_CLASS, HIDE_MOBILE_CLASS } from '../blocks/register'
import { createSettingBinder } from './useSettingBinding'

/** A component the helper can work with: no GrapesJS, which hangs under jsdom. */
function make(
  type: string,
  attributes: Record<string, unknown> = {},
  extra: { children?: Component[]; styleDefault?: Record<string, string>; content?: string; src?: string } = {},
) {
  const state: Record<string, unknown> = {
    type, tagName: type, 'style-default': extra.styleDefault, content: extra.content, src: extra.src,
  }
  let attrs = { ...attributes }
  const children = extra.children ?? []
  const calls: string[] = []
  const component = {
    calls,
    get: (key: string) => state[key],
    set: vi.fn((key: string, value: unknown) => {
      calls.push(`set:${key}=${JSON.stringify(value)}`)
      if (key === 'attributes') attrs = { ...(value as Record<string, unknown>) }
      else state[key] = value
    }),
    getAttributes: () => attrs,
    addAttributes: vi.fn((next: Record<string, unknown>) => {
      calls.push(`addAttributes:${JSON.stringify(next)}`)
      attrs = { ...attrs, ...next }
    }),
    removeAttributes: vi.fn((key: string) => {
      calls.push(`removeAttributes:${key}`)
      delete attrs[key]
    }),
    components: vi.fn((value?: string) => {
      if (value !== undefined) {
        calls.push(`components:${value}`)
        return children
      }
      return { map: <T,>(fn: (child: Component) => T) => children.map(fn) }
    }),
  }
  return component as unknown as Component & { calls: string[] }
}

/** mj-head -> mj-attributes -> mj-all / mj-text, as the starter template carries them. */
function wrapperWith(head: Record<string, Record<string, string>>): Component {
  const tags = Object.entries(head).map(([tag, attributes]) => make(tag, attributes))
  return make('wrapper', {}, { children: [make('mj-head', {}, { children: [make('mj-attributes', {}, { children: tags })] })] })
}

test('a block kind maps to its ordered fields, and a heading is an mj-text', () => {
  expect(fieldsFor(make('mj-button')).map((field) => field.key)).toEqual([
    LABEL_KEY, 'href', 'align', 'width', 'height', 'padding', 'inner-padding', 'font-family', 'font-size', 'background-color',
    BORDER_WIDTH_KEY, BORDER_STYLE_KEY, BORDER_COLOR_KEY, SHADOW_KEY, 'color', 'border-radius',
  ])
  expect(fieldsFor(make('mj-button')).filter((field) => field.kind === 'padding').map((field) => field.label)).toEqual(['Margin', 'Padding'])   // a button's MJML padding is its margin
  expect(fieldsFor(make('mj-spacer')).map((field) => field.key)).toEqual(['height', MARGIN_KEY, 'padding', 'container-background-color'])
  expect(fieldsFor(make('mj-raw')).map((field) => field.key)).toEqual([HTML_KEY])
  expect(fieldsFor(make('mj-navbar'))).toEqual([])
  expect(blockType(make('mj-text'))).toBe('mj-text')
})

test('every block that can be selected has something to set: the body, a heading or text, and a link inside it', () => {
  expect(fieldsFor(make('mj-body')).map((field) => field.key)).toEqual(['width', 'background-color'])
  expect(fieldsFor(make('mj-text')).map((field) => field.key)).toContain('font-family')
  // a text block's background is MJML's container-background-color, offered under the plain name
  expect(fieldsFor(make('mj-text')).filter((field) => field.kind === 'color').map((field) => [field.key, field.label]))
    .toEqual([['container-background-color', 'Background Color'], ['color', 'Text Color']])
  const text = make('mj-text')
  expect(readEffective(text, 'container-background-color', null)).toEqual({ value: null, source: 'mjml-default' })
  expect(writeSetting(text, 'container-background-color', '#FFF')).toBe(true)
  expect(text.getAttributes()['container-background-color']).toBe('#ffffff')
  expect(writeSetting(text, 'container-background-color', 'white')).toBe(false)
  // the cell behind an image, a divider, a spacer and a social row takes the same attribute
  for (const type of ['mj-image', 'mj-divider', 'mj-spacer', 'mj-social']) {
    expect(fieldsFor(make(type)).filter((field) => field.key === 'container-background-color').map((field) => field.label), type).toEqual(['Background Color'])
    expect(writeSetting(make(type), 'container-background-color', 'white'), type).toBe(false)
  }
  expect(fieldsFor(make('link')).map((field) => field.key)).toEqual(['href', 'title'])
})

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'as', 'via', 'per', 'vs'])

test('every field label is title case and every kind is one we render', () => {
  const kinds = new Set(['color', 'length', 'padding', 'align', 'valign', 'toggle', 'select', 'text', 'link', 'image', 'swatch', 'html', 'networks'])
  for (const [type, fields] of Object.entries(SETTINGS_BY_BLOCK)) {
    for (const field of fields) {
      expect(kinds.has(field.kind), `${type} ${field.key}`).toBe(true)
      // title case: every word capitalised except a small word inside the label; an acronym such as HTML stays as it is
      const words = field.label.split(' ')
      const cased = words.every((word, index) => /^[A-Z]/.test(word) || (SMALL_WORDS.has(word) && index > 0 && index < words.length - 1))
      expect(cased, `${type} ${field.key}: ${field.label}`).toBe(true)
    }
  }
})

test('every setting belongs to a section, and every section has a field or a reason not to', () => {
  const sections = new Set(['content', 'layout', 'appearance'])
  for (const [type, fields] of Object.entries(SETTINGS_BY_BLOCK)) {
    for (const field of fields) expect(sections.has(field.section), `${type} ${field.key}`).toBe(true)
  }
  expect(sectionFields(make('mj-button'), 'content').map((field) => field.key)).toEqual([LABEL_KEY, 'href'])
  expect(sectionFields(make('mj-spacer'), 'appearance').map((field) => field.label)).toEqual(['Background Color'])
})

test('a length field offers exactly the units mjml accepts for that setting', () => {
  for (const [type, fields] of Object.entries(SETTINGS_BY_BLOCK)) {
    for (const field of fields) {
      if (field.kind !== 'length' && field.kind !== 'padding') continue
      const units = unitsFor(type, field.key)
      expect(units.length, `${type} ${field.key}`).toBeGreaterThan(0)

      const rule = ATTRIBUTE_RULES[type]?.[field.key]
      // where mjml validates the unit, the field must offer that set and nothing wider
      if (rule !== undefined && rule !== 'free' && rule !== 'color') {
        expect([...units], `${type} ${field.key}`).toEqual(rule.units.filter((unit) => unit === 'px' || unit === '%'))
      } else {
        expect([...units], `${type} ${field.key}`).toEqual(['px', '%'])
      }
    }
  }
})

test('the units reach the field itself, so it cannot drift from what mjml takes', () => {
  const byKey = new Map(fieldsFor(make('mj-image')).map((field) => [field.key, field]))
  expect(byKey.get('width')?.units).toEqual(['px']) // mjml takes px only for an image width
  expect(byKey.get('padding')?.units).toEqual(['px', '%'])
  expect(fieldsFor(make('mj-text')).find((field) => field.key === 'font-size')?.units).toEqual(['px'])
  expect(fieldsFor(make('mj-spacer'))[0].units).toEqual(['px', '%'])
})

test('readSetting gives what the block sets, and null when it sets nothing', () => {
  const text = make('mj-text', { 'font-size': '19px', color: '' })
  expect(readSetting(text, 'font-size')).toBe('19px')
  expect(readSetting(text, 'color')).toBe(null)
  expect(readSetting(text, 'align')).toBe(null)
})

test('an image src is found whether it sits in the attributes or on the property', () => {
  expect(readSetting(make('mj-image', { src: 'https://a.test/a.png' }), 'src')).toBe('https://a.test/a.png')
  expect(readSetting(make('mj-image', {}, { src: 'https://b.test/b.png' }), 'src')).toBe('https://b.test/b.png')
})

test('the effective value comes from the block first', () => {
  const wrapper = wrapperWith({ 'mj-text': { 'font-size': '15px' } })
  expect(readEffective(make('mj-text', { 'font-size': '19px' }), 'font-size', wrapper)).toEqual({ value: '19px', source: 'block' })
})

test('a value equal to style-default is not the block value: the plugin would strip it before the email', () => {
  const text = make('mj-text', { 'font-size': '13px' }, { styleDefault: { 'font-size': '13px' } })
  const wrapper = wrapperWith({ 'mj-text': { 'font-size': '15px' } })
  // this is exactly the trap keepChosenValues removes: the reader picked 13px and the inbox would render 15px
  expect(readEffective(text, 'font-size', wrapper)).toEqual({ value: '15px', source: 'mj-attributes' })
  // with style-default emptied the same choice is the block's own
  const kept = make('mj-text', { 'font-size': '13px' }, { styleDefault: {} })
  expect(readEffective(kept, 'font-size', wrapper)).toEqual({ value: '13px', source: 'block' })
})

test('then mj-attributes for the tag, then mj-all, then mjml own default', () => {
  const both = wrapperWith({ 'mj-text': { 'font-size': '15px' }, 'mj-all': { 'font-size': '11px', color: '#111111' } })
  expect(readEffective(make('mj-text'), 'font-size', both)).toEqual({ value: '15px', source: 'mj-attributes' })
  expect(readEffective(make('mj-text'), 'color', both)).toEqual({ value: '#111111', source: 'mj-all' })
  expect(readEffective(make('mj-text'), 'align', both)).toEqual({ value: 'left', source: 'mjml-default' })
  expect(readEffective(make('mj-text'), 'font-weight', both)).toEqual({ value: null, source: 'mjml-default' })
})

test("an mjml default that is the empty string reads as nothing set, not as a value", () => {
  // mjml declares alt="" for mj-image; an empty alt is not something to show as inherited
  expect(readEffective(make('mj-image'), 'alt', null)).toEqual({ value: null, source: 'mjml-default' })
})

test('with no head at all every unset setting falls through to mjml own default', () => {
  expect(readEffective(make('mj-divider'), 'border-color', null)).toEqual({ value: '#000000', source: 'mjml-default' })
  expect(readEffective(make('mj-spacer'), 'height', undefined)).toEqual({ value: '20px', source: 'mjml-default' })
})

test('a label is read from the content and never inherited', () => {
  const button = make('mj-button', {}, { children: [make('textnode', {}, { content: 'Shop now' })] })
  expect(readSetting(button, LABEL_KEY)).toBe('Shop now')
  expect(readEffective(button, LABEL_KEY, wrapperWith({ 'mj-all': { label: 'nope' } }))).toEqual({ value: 'Shop now', source: 'block' })
})

test('writing goes through addAttributes, never set', () => {
  const section = make('mj-section')
  expect(writeSetting(section, 'background-color', '#123456')).toBe(true)
  expect(section.getAttributes()['background-color']).toBe('#123456')
  expect(section.calls).toEqual(['addAttributes:{"background-color":"#123456"}'])
})

test('null clears the setting with removeAttributes, leaving no empty value behind', () => {
  const section = make('mj-section', { 'background-color': '#123456' })
  expect(writeSetting(section, 'background-color', null)).toBe(true)
  expect('background-color' in section.getAttributes()).toBe(false)
  expect(section.calls).toEqual(['removeAttributes:background-color'])
})

test('hex is normalised to six lowercase digits before it is written', () => {
  expect(normaliseHex('#ABC')).toBe('#aabbcc')
  expect(normaliseHex('#AABBCC')).toBe('#aabbcc')
  expect(normaliseHex('rgb(1,2,3)')).toBe(null)
  const text = make('mj-text')
  expect(writeSetting(text, 'color', '#ABC')).toBe(true)
  expect(text.getAttributes().color).toBe('#aabbcc')
})

test('a colour that is not hex is refused rather than written', () => {
  const text = make('mj-text')
  for (const value of ['rgb(1, 2, 3)', 'red', 'transparent', '#12345']) {
    expect(writeSetting(text, 'color', value), value).toBe(false)
  }
  expect(text.calls).toEqual([])
})

test('em, rem and a missing unit are refused without writing', () => {
  const text = make('mj-text')
  for (const value of ['1.2rem', '2em', '19', '19pt']) {
    expect(writeSetting(text, 'font-size', value), value).toBe(false)
  }
  expect(text.calls).toEqual([])
  expect(writeSetting(text, 'font-size', '19px')).toBe(true)
})

test('a percentage is accepted only where mjml accepts one', () => {
  expect(writeSetting(make('mj-spacer'), 'height', '5%')).toBe(true)
  expect(writeSetting(make('mj-text'), 'font-size', '50%')).toBe(false) // mjml takes px only here
  expect(writeSetting(make('mj-image'), 'width', '50%')).toBe(false)
  expect(writeSetting(make('mj-button'), 'width', '50%')).toBe(true)
})

test('line-height may carry no unit, which is how mjml writes it', () => {
  expect(writeSetting(make('mj-text'), 'line-height', '1')).toBe(true)
  expect(writeSetting(make('mj-text'), 'line-height', '24px')).toBe(true)
  expect(writeSetting(make('mj-text'), 'line-height', '1.5em')).toBe(false)
})

test('padding takes up to four values and refuses a fifth', () => {
  expect(writeSetting(make('mj-section'), 'padding', '10px')).toBe(true)
  expect(writeSetting(make('mj-section'), 'padding', '10px 20px 30px 40px')).toBe(true)
  expect(writeSetting(make('mj-section'), 'padding', '10px 20px 30px 40px 50px')).toBe(false)
  expect(writeSetting(make('mj-section'), 'padding', '10px 2em')).toBe(false)
})

test('an image src clears the property first, then writes the attribute, in that order', () => {
  const image = make('mj-image', { src: 'https://old.test/a.png' }, { src: 'https://old.test/a.png' })
  expect(writeSetting(image, 'src', 'https://new.test/b.png')).toBe(true)
  expect(image.calls).toEqual(['set:src=""', 'addAttributes:{"src":"https://new.test/b.png"}'])
  expect(image.getAttributes().src).toBe('https://new.test/b.png')
})

test('a label is written as content through components(), never set(content)', () => {
  const button = make('mj-button')
  expect(writeSetting(button, LABEL_KEY, 'Shop now')).toBe(true)
  expect(button.calls).toEqual(['components:Shop now'])
  expect(button.set).not.toHaveBeenCalled()
})

test('content is written as plain text, so markup cannot ride in', () => {
  const button = make('mj-button')
  writeContent(button, 'Save <b>50%</b> & more')
  expect(button.calls).toEqual(['components:Save &lt;b&gt;50%&lt;/b&gt; &amp; more'])
})

test('a grouped edit puts the model back and writes once, so the drag is a single undo step', () => {
  const order: string[] = []
  const editor = {
    UndoManager: { stop: () => order.push('stop'), start: () => order.push('start') },
  }
  const section = make('mj-section', { 'background-color': '#000000' })

  beginGroupedEdit(editor, section)
  for (const shade of ['#111111', '#222222', '#333333']) writeSetting(section, 'background-color', shade)
  expect(endGroupedEdit(editor, section, 'background-color', '#444444')).toBe(true)

  expect(order).toEqual(['stop', 'start'])
  expect(section.getAttributes()['background-color']).toBe('#444444')
  // the restore lands between start and the final write, so only that last write is on the stack
  expect(section.calls.at(-2)).toBe('set:attributes={"background-color":"#000000"}')
  expect(section.calls.at(-1)).toBe('addAttributes:{"background-color":"#444444"}')
})

test('a refused final value still closes the group rather than leaving undo switched off', () => {
  const order: string[] = []
  const editor = { UndoManager: { stop: () => order.push('stop'), start: () => order.push('start') } }
  const text = make('mj-text')
  beginGroupedEdit(editor, text)
  expect(endGroupedEdit(editor, text, 'font-size', '2em')).toBe(false)
  expect(order).toEqual(['stop', 'start'])
})

// ---- hide on phones ------------------------------------------------------

test('a section offers the switch in its layout settings, and no other block does', () => {
  expect(sectionFields(make('mj-section'), 'layout').map((field) => field.key)).toContain(HIDE_MOBILE_KEY)
  for (const type of ['mj-column', 'mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-spacer']) {
    expect(fieldsFor(make(type)).map((field) => field.key), type).not.toContain(HIDE_MOBILE_KEY)
  }
})

test('the switch reads the class off the block rather than an attribute of its own', () => {
  expect(readSetting(make('mj-section'), HIDE_MOBILE_KEY)).toBeNull()
  expect(readSetting(make('mj-section', { 'css-class': HIDE_MOBILE_CLASS }), HIDE_MOBILE_KEY)).toBe(HIDE_MOBILE_CLASS)
  expect(readSetting(make('mj-section', { 'css-class': `${FOOTER_CLASS} ${HIDE_MOBILE_CLASS}` }), HIDE_MOBILE_KEY)).toBe(HIDE_MOBILE_CLASS)
})

test('turning the switch on writes the class, and off takes it away', () => {
  const section = make('mj-section')

  expect(writeSetting(section, HIDE_MOBILE_KEY, HIDE_MOBILE_CLASS)).toBe(true)
  expect(section.getAttributes()['css-class']).toBe(HIDE_MOBILE_CLASS)
  expect(section.getAttributes()[HIDE_MOBILE_KEY]).toBeUndefined()

  expect(writeSetting(section, HIDE_MOBILE_KEY, null)).toBe(true)
  expect(section.getAttributes()['css-class']).toBeUndefined()
})

test('the switch never disturbs the footer class', () => {
  const footer = make('mj-section', { 'css-class': FOOTER_CLASS })
  writeSetting(footer, HIDE_MOBILE_KEY, HIDE_MOBILE_CLASS)
  writeSetting(footer, HIDE_MOBILE_KEY, null)
  expect(footer.getAttributes()['css-class']).toBe(FOOTER_CLASS)
})

test('hiding on phones is the block own choice, never inherited from mj-head', () => {
  const wrapper = wrapperWith({ 'mj-all': { [HIDE_MOBILE_KEY]: HIDE_MOBILE_CLASS } })
  expect(readEffective(make('mj-section'), HIDE_MOBILE_KEY, wrapper)).toEqual({ value: null, source: 'block' })
  expect(readEffective(make('mj-section', { 'css-class': HIDE_MOBILE_CLASS }), HIDE_MOBILE_KEY, wrapper)).toEqual({
    value: HIDE_MOBILE_CLASS,
    source: 'block',
  })
})

test('the switch commits once, so one undo takes the class off again', () => {
  const order: string[] = []
  const editor = { UndoManager: { stop: () => order.push('stop'), start: () => order.push('start') } }
  const section = make('mj-section')
  const binder = createSettingBinder(editor, section)

  binder.handlers(HIDE_MOBILE_KEY).onCommit(HIDE_MOBILE_CLASS)

  // no grouped edit was ever opened: a switch is one write, which is one step on the undo stack
  expect(order).toEqual([])
  expect(binder.previewing()).toBe(false)
  expect(section.calls.filter((call) => call.startsWith('addAttributes'))).toEqual([`addAttributes:{"css-class":"${HIDE_MOBILE_CLASS}"}`])

  binder.handlers(HIDE_MOBILE_KEY).onCommit(null)
  expect(section.getAttributes()['css-class']).toBeUndefined()
})

test('a swatch setting carries its fixed colours, and a receipt block offers only its own settings', () => {
  const header = fieldsFor(make('cep-receipt-brand-header'))
  expect(header.map((field) => field.key)).toEqual(['wordmark', 'tagline', 'align', 'background-color'])
  const swatch = header.find((field) => field.kind === 'swatch')
  expect(swatch?.swatches?.map((item) => item.label)).toEqual(['Navy 700', 'Navy 900', 'Teal 600', 'Gray 900'])
  expect(header.find((field) => field.key === 'align')?.only).toEqual(['left', 'center'])

  expect(fieldsFor(make('cep-marketing')).map((field) => field.key)).toEqual(['headline', 'body', 'align', 'treatment'])
  expect(fieldsFor(make('cep-receipt-button')).map((field) => field.key)).toEqual(['button-label', 'destination', 'align', 'button-style'])
  expect(fieldsFor(make('cep-receipt-image')).map((field) => field.key)).toEqual(['src', 'alt', 'ratio'])
  expect(fieldsFor(make('cep-receipt-divider'))).toEqual([])
  expect(fieldsFor(make('cep-receipt-footer')).map((field) => field.key)).toEqual(['sender-address'])
})

// ---- social icons and custom HTML ----------------------------------------

test('a social icon reads its network without MJML’s -noshare suffix and writes it back in the direct form', () => {
  const icon = make('mj-social-element', { name: 'facebook-noshare' })
  expect(readSetting(icon, 'name')).toBe('facebook')
  expect(readSetting(make('mj-social-element', { name: 'instagram' }), 'name')).toBe('instagram')

  expect(writeSetting(icon, 'name', 'youtube')).toBe(true)
  expect(icon.getAttributes().name).toBe('youtube') // no sharer page for YouTube: the plain name already links directly
  expect(writeSetting(icon, 'name', 'linkedin')).toBe(true)
  expect(icon.getAttributes().name).toBe('linkedin-noshare')
})

test('a social icon’s label is optional: clearing it leaves the icon on its own', () => {
  const icon = make('mj-social-element', {}, { children: [make('textnode', {}, { content: 'Facebook' })] })
  expect(readSetting(icon, LABEL_KEY)).toBe('Facebook')
  expect(writeSetting(icon, LABEL_KEY, null)).toBe(true)
  expect(icon.calls).toEqual(['components:'])
  // a button with no label is a button nobody can read
  expect(writeSetting(make('mj-button'), LABEL_KEY, null)).toBe(false)
})

test('a custom HTML block reads its markup as it is and writes it unescaped', () => {
  const raw = make('mj-raw')
  ;(raw as unknown as { getInnerHTML: () => string }).getInnerHTML = () => ' <table><tr><td>Hi</td></tr></table> '
  expect(readSetting(raw, HTML_KEY)).toBe('<table><tr><td>Hi</td></tr></table>')
  expect(readEffective(raw, HTML_KEY, wrapperWith({ 'mj-all': { html: 'x' } }))).toEqual({ value: '<table><tr><td>Hi</td></tr></table>', source: 'block' })
  expect(readSetting(make('mj-raw'), HTML_KEY)).toBe(null)

  expect(writeSetting(raw, HTML_KEY, '<p>&amp; <b>bold</b></p>')).toBe(true)
  expect(raw.calls).toEqual(['components:<p>&amp; <b>bold</b></p>'])
})

test('adding a network appends an icon in the direct form with no address yet', () => {
  const appended: string[] = []
  const social = make('mj-social')
  ;(social as unknown as { append: (content: string) => void }).append = (content) => {
    appended.push(content)
  }
  expect(addSocialElement(social, 'facebook')).toBe(true)
  expect(appended).toEqual(['<mj-social-element name="facebook-noshare" href=""></mj-social-element>'])
  expect(addSocialElement(make('mj-social'), 'facebook')).toBe(false)
})

test('the brand bar colour is written as the swatch value, straight onto the section', () => {
  const header = make('cep-receipt-brand-header', { 'background-color': '#20265d' })
  expect(readSetting(header, 'background-color')).toBe('#20265d')
  expect(writeSetting(header, 'background-color', '#418eae')).toBe(true)
  expect(header.getAttributes()['background-color']).toBe('#418eae')
})

test('margin: written as the sum with the padding into the MJML padding, read back as two; a mixed unit is refused; reset leaves the padding', () => {
  const text = make('mj-text')
  expect(readSetting(text, MARGIN_KEY)).toBe(null)
  expect(writeSetting(text, MARGIN_KEY, '10px')).toBe(true)
  expect(text.getAttributes().padding).toBe('20px 35px')                                              // 10 on top of MJML's own 10px 25px
  expect(readSetting(text, MARGIN_KEY)).toBe('10px')
  expect(readSetting(text, 'padding')).toBe('10px 25px')
  expect(readEffective(text, MARGIN_KEY)).toEqual({ value: '10px', source: 'block' })

  expect(writeSetting(text, 'padding', '5px')).toBe(true)                                              // the inner part alone
  expect(text.getAttributes().padding).toBe('15px')
  expect(readSetting(text, 'padding')).toBe('5px')
  expect(writeSetting(text, MARGIN_KEY, '5%')).toBe(false)                                             // px and % cannot be added up
  expect(text.getAttributes().padding).toBe('15px')

  expect(writeSetting(text, MARGIN_KEY, null)).toBe(true)
  expect(text.getAttributes().padding).toBe('5px')                                                     // the padding stands alone again
  expect(text.get('cep-spacing')).toBe(null)
  expect(readSetting(text, MARGIN_KEY)).toBe(null)

  const button = make('mj-button')
  expect(writeSetting(button, MARGIN_KEY, '10px')).toBe(false)                                          // a button's margin is its padding attribute
  expect(readSetting(button, MARGIN_KEY)).toBe(null)
})

test('border: three fields over one attribute, written whole; 0 or nothing clears it; a shadow is a class', () => {
  const section = make('mj-section')
  expect(readSetting(section, BORDER_WIDTH_KEY)).toBe(null)
  expect(writeSetting(section, BORDER_COLOR_KEY, '#CCC')).toBe(true)
  expect(section.getAttributes().border).toBe('1px solid #cccccc')                                  // the plainest width and style fill in
  expect(writeSetting(section, BORDER_WIDTH_KEY, '2px')).toBe(true)
  expect(writeSetting(section, BORDER_STYLE_KEY, 'dashed')).toBe(true)
  expect(section.getAttributes().border).toBe('2px dashed #cccccc')
  expect([BORDER_WIDTH_KEY, BORDER_STYLE_KEY, BORDER_COLOR_KEY].map((key) => readSetting(section, key))).toEqual(['2px', 'dashed', '#cccccc'])
  expect(readEffective(section, BORDER_STYLE_KEY, null)).toEqual({ value: 'dashed', source: 'block' })
  expect(writeSetting(section, BORDER_STYLE_KEY, 'wavy')).toBe(false)
  expect(writeSetting(section, BORDER_WIDTH_KEY, '2em')).toBe(false)
  expect(writeSetting(section, BORDER_WIDTH_KEY, '0px')).toBe(true)
  expect('border' in section.getAttributes()).toBe(false)
  expect(parseBorder('dotted #ff0000 3px')).toEqual({ width: '3px', style: 'dotted', color: '#ff0000' })
  expect(parseBorder('none')).toEqual({ width: null, style: null, color: null })
  expect(writeSetting(make('mj-text'), BORDER_WIDTH_KEY, '1px')).toBe(false)                          // mjml gives a text no border
  expect(fieldsFor(make('mj-section')).find((field) => field.key === BORDER_WIDTH_KEY)?.units).toEqual(['px'])

  const text = make('mj-text')
  expect(readSetting(text, SHADOW_KEY)).toBe(null)
  expect(writeSetting(text, SHADOW_KEY, 'medium')).toBe(true)
  expect(text.getAttributes()['css-class']).toBe('cep-shadow-medium')
  expect(readSetting(text, SHADOW_KEY)).toBe('medium')
  expect(readEffective(text, SHADOW_KEY, null)).toEqual({ value: 'medium', source: 'block' })
  expect(writeSetting(text, SHADOW_KEY, 'huge')).toBe(false)
  expect(writeSetting(text, SHADOW_KEY, null)).toBe(true)
  expect('css-class' in text.getAttributes()).toBe(false)
  expect(fieldsFor(make('mj-column')).map((field) => field.key)).toContain(SHADOW_KEY)
  expect(fieldsFor(make('mj-spacer')).map((field) => field.key)).not.toContain(SHADOW_KEY)
})
