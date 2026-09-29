import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Component } from 'grapesjs'
import { afterEach, expect, test, vi } from 'vitest'

import { CHOOSE_IMAGE_LABEL, InspectorFields, NO_IMAGE_NOTE } from './InspectorFields'
import { ADD_NETWORK_LABEL } from './fields/SocialNetworksField'
import { EMAIL_SETTINGS_NOTE, INHERITED_NOTE, RESET_LABEL } from './fields/types'
import {
  BORDER_COLOR_KEY, BORDER_STYLE_KEY, BORDER_WIDTH_KEY, CANVAS_TEXT_NOTE, HIDE_DESKTOP_KEY, HIDE_MOBILE_KEY, HIDE_MOBILE_LABEL, MARGIN_KEY, SHADOW_KEY, STACK_NOTE, readSetting,
} from './settings'
import { HIDE_MOBILE_CLASS } from '../blocks/register'
import { BARCODE_DEFAULTS, CODE_TYPE, codeRegion } from '../blocks/codes'
import { STACKING_KEY } from './stacking'

afterEach(cleanup)

interface Options {
  children?: Component[]
  parent?: Component
  content?: string
}

function make(type: string, attributes: Record<string, unknown> = {}, options: Options = {}) {
  const state: Record<string, unknown> = { type, tagName: type, content: options.content }
  let attrs: Record<string, unknown> = { ...attributes }
  const children = options.children ?? []
  const calls: string[] = []
  const component = {
    calls,
    get: (key: string) => state[key],
    set: (key: string, value: unknown) => {
      calls.push(`set:${key}`)
      if (key === 'attributes') attrs = { ...(value as Record<string, unknown>) }
      else state[key] = value
    },
    parent: () => options.parent,
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
        return children
      }
      return { map: <T,>(fn: (child: Component) => T) => children.map(fn) }
    },
  }
  return component as unknown as Component & { calls: string[] }
}

const editor = () => ({ UndoManager: { stop: vi.fn(), start: vi.fn() } })

function renderFields(component: Component, over: Partial<React.ComponentProps<typeof InspectorFields>> = {}) {
  const onChooseImage = vi.fn()
  const onRecentUse = vi.fn()
  const result = render(
    <InspectorFields component={component} editor={editor()} onChooseImage={onChooseImage} onRecentUse={onRecentUse} {...over} />,
  )
  return { onChooseImage, onRecentUse, ...result }
}

const sections = () => screen.getAllByRole('button', { expanded: true }).map((node) => node.textContent?.trim())

test('a section groups its own fields and nothing else', () => {
  renderFields(make('mj-button'))
  expect(sections()).toEqual(['Content', 'Layout', 'Appearance'])

  const content = screen.getByRole('button', { name: /^Content/ }).closest('section') as HTMLElement
  expect([...content.querySelectorAll('[data-setting]')].map((node) => node.getAttribute('data-setting')))
    .toEqual(['label', 'href'])
})

test('each block kind offers its own settings', () => {
  const keys = () => [...document.querySelectorAll('[data-setting]')].map((node) => node.getAttribute('data-setting'))

  renderFields(make('mj-spacer'))
  expect(keys()).toEqual(['height', MARGIN_KEY, 'padding', HIDE_MOBILE_KEY, HIDE_DESKTOP_KEY, 'container-background-color'])
  expect(sections()).toEqual(['Layout', 'Appearance'])

  cleanup()
  renderFields(make('mj-divider'))
  expect(keys()).toEqual(['width', 'align', MARGIN_KEY, 'padding', HIDE_MOBILE_KEY, HIDE_DESKTOP_KEY, 'border-color', 'border-width', 'container-background-color'])

  cleanup()
  renderFields(make('mj-social-element'))
  expect(keys()).toEqual(['name', 'href', 'label', 'icon-size', MARGIN_KEY, 'padding', 'background-color', 'border-radius', 'color'])

  cleanup()
  renderFields(make('mj-section'))
  expect(keys()).toEqual([MARGIN_KEY, 'padding', 'full-width', STACKING_KEY, HIDE_MOBILE_KEY, HIDE_DESKTOP_KEY, 'background-color', BORDER_WIDTH_KEY, BORDER_STYLE_KEY, BORDER_COLOR_KEY, SHADOW_KEY, 'border-radius'])
})

test('a text block says its words are edited on the canvas instead of offering a field', () => {
  renderFields(make('mj-text'))
  expect(screen.getByText(CANVAS_TEXT_NOTE)).toBeTruthy()
  expect(sections()).toEqual(['Content', 'Layout', 'Appearance'])

  const content = screen.getByRole('button', { name: /^Content/ }).closest('section') as HTMLElement
  expect(content.querySelectorAll('[data-setting]')).toHaveLength(0)
})

test('a section collapses and opens again', async () => {
  const user = userEvent.setup()
  renderFields(make('mj-section'))
  const layout = screen.getByRole('button', { name: /^Layout/ })

  expect(layout.getAttribute('aria-expanded')).toBe('true')
  await user.click(layout)
  expect(layout.getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector('[data-setting="padding"]')).toBeNull()

  await user.click(layout)
  expect(layout.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('[data-setting="padding"]')).toBeTruthy()
})

test('a value the block sets carries no note; one it inherits says where it came from', () => {
  const wrapper = make('wrapper', {}, {
    children: [make('mj-head', {}, { children: [make('mj-attributes', {}, { children: [make('mj-text', { 'font-size': '15px' })] })] })],
  })
  renderFields(make('mj-text', { color: '#111111' }), { wrapper })

  expect(screen.getByText(EMAIL_SETTINGS_NOTE)).toBeTruthy() // font-size, from mj-attributes
  expect(screen.getAllByText(INHERITED_NOTE).length).toBeGreaterThan(0) // alignment, from MJML itself
  const colour = document.querySelector('[data-setting="color"]') as HTMLElement
  expect(colour.textContent).not.toContain(EMAIL_SETTINGS_NOTE)
  expect(colour.textContent).not.toContain(INHERITED_NOTE)
})

test('committing a field writes it to the component', async () => {
  const user = userEvent.setup()
  const spacer = make('mj-spacer')
  renderFields(spacer)

  await user.type(screen.getByLabelText('Height'), '40{Enter}')
  expect(readSetting(spacer, 'height')).toBe('40px')
})

test('a unit MJML refuses shows the error, and leaves nothing written once the field is left', async () => {
  const user = userEvent.setup()
  const text = make('mj-text')
  renderFields(text)

  await user.type(screen.getByLabelText('Font Size'), '2em')
  expect(screen.getByText('Use a number in px, or em / rem (written as px)')).toBeTruthy()
  await user.keyboard('{Enter}')

  // "2" previewed on the way to "2em"; leaving the field (past its unit buttons) abandons that preview rather than keeping it
  ;(document.activeElement as HTMLElement).blur()
  expect(readSetting(text, 'font-size')).toBe(null)
})

test('em on a block means its font size, and on the Font Size field the size it inherits, so a preview cannot move the base', async () => {
  const user = userEvent.setup()
  const wrapper = make('wrapper', {}, {
    children: [make('mj-head', {}, { children: [make('mj-attributes', {}, { children: [make('mj-text', { 'font-size': '20px' })] })] })],
  })
  const text = make('mj-text', { 'font-size': '15px' })
  renderFields(text, { wrapper })

  await user.click(within(screen.getByRole('radiogroup', { name: 'Font Size Unit' })).getByRole('radio', { name: 'em' }))
  expect((screen.getByLabelText('Font Size') as HTMLInputElement).value).toBe('0.75')              // 15px of the inherited 20px
  await user.clear(screen.getByLabelText('Font Size'))
  await user.type(screen.getByLabelText('Font Size'), '1.5{Enter}')
  expect(readSetting(text, 'font-size')).toBe('30px')

  cleanup()
  const sized = make('mj-text', { 'font-size': '30px' })
  renderFields(sized, { wrapper })
  const padding = within(screen.getByRole('group', { name: 'Padding' }))
  await user.type(padding.getByLabelText('Top Padding'), '1em{Enter}')                              // 1em of the block's own 30px
  expect(readSetting(sized, 'padding')).toBe('30px')
})

test('a length offers the units MJML accepts for that setting, plus em and rem that are written as px', () => {
  renderFields(make('mj-text'))
  const radios = (name: string) => within(screen.getByRole('radiogroup', { name })).getAllByRole('radio').map((radio) => radio.textContent)
  // font-size is px only in MJML: no %, but em and rem can be typed and become px
  expect(radios('Font Size Unit')).toEqual(['px', 'em', 'rem'])

  cleanup()
  renderFields(make('mj-spacer'))
  expect(radios('Height Unit')).toEqual(['px', '%', 'em', 'rem'])
})

test('a margin on a block is added to its padding in the email, and the panel keeps the two apart', async () => {
  const user = userEvent.setup()
  const text = make('mj-text')
  renderFields(text)
  const margin = within(screen.getByRole('group', { name: 'Margin' }))
  await user.type(margin.getByLabelText('Top Padding'), '10{Enter}')
  expect(readSetting(text, MARGIN_KEY)).toBe('10px')
  expect(text.getAttributes().padding).toBe('20px 35px')                                              // 10 on top of MJML's own 10px 25px
  expect(readSetting(text, 'padding')).toBe('10px 25px')                                             // the inner part, shown by the Padding group once the editor re-reads
  expect(screen.getByText('Space outside the block. The email gets margin and padding added together.')).toBeTruthy()
})

test('Reset clears the setting', async () => {
  const user = userEvent.setup()
  const spacer = make('mj-spacer', { height: '40px' })
  renderFields(spacer)

  await user.click(screen.getByRole('button', { name: RESET_LABEL }))
  expect('height' in spacer.getAttributes()).toBe(false)
})

test('font weight is a list of named weights, not free text', async () => {
  const user = userEvent.setup()
  const text = make('mj-text')
  renderFields(text)

  const select = screen.getByLabelText('Font Weight') as HTMLSelectElement
  expect([...select.options].map((option) => option.textContent))
    .toEqual(['Default', 'Light', 'Regular', 'Medium', 'Semibold', 'Bold'])

  await user.selectOptions(select, '700')
  expect(readSetting(text, 'font-weight')).toBe('700')
})

test('font family is a list of email-safe families, the default row naming the email’s own', async () => {
  const user = userEvent.setup()
  const wrapper = make('wrapper', {}, {
    children: [make('mj-head', {}, { children: [make('mj-attributes', {}, { children: [make('mj-all', { 'font-family': 'Georgia, serif' })] })] })],
  })
  const text = make('mj-text')
  renderFields(text, { wrapper })

  const select = screen.getByLabelText('Font Family') as HTMLSelectElement
  expect(select.options[0].textContent).toBe('Default (Georgia)')
  expect([...select.options].map((option) => option.textContent)).toEqual(expect.arrayContaining(['Arial', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']))

  await user.selectOptions(select, 'Arial, Helvetica, sans-serif')
  expect(readSetting(text, 'font-family')).toBe('Arial, Helvetica, sans-serif')
})

test('a font the design carries that the list does not offer is still shown, as itself', () => {
  renderFields(make('mj-text', { 'font-family': 'Lato, sans-serif' }))
  const select = screen.getByLabelText('Font Family') as HTMLSelectElement
  expect(select.value).toBe('Lato, sans-serif')
  expect(select.options[select.selectedIndex].textContent).toBe('Lato, sans-serif')
})

test('the social block adds a network from a list, which appends an icon that links straight to the profile', async () => {
  const user = userEvent.setup()
  const appended: string[] = []
  const social = make('mj-social')
  ;(social as unknown as { append: (content: string) => void }).append = (content) => {
    appended.push(content)
  }
  renderFields(social)

  const add = screen.getByLabelText(ADD_NETWORK_LABEL) as HTMLSelectElement
  expect([...add.options].map((option) => option.textContent)).toEqual(expect.arrayContaining(['YouTube', 'Instagram', 'LinkedIn', 'X']))
  await user.selectOptions(add, 'linkedin')
  expect(appended).toEqual(['<mj-social-element name="linkedin-noshare" href=""></mj-social-element>'])
  expect(add.value).toBe('') // back on the prompt: it is an action, not a setting
  expect(screen.getByLabelText('Layout')).toBeTruthy()
  expect(screen.getByLabelText('Icon Size')).toBeTruthy()
})

test('a social icon names its network from the same list, with no empty row', () => {
  renderFields(make('mj-social-element', { name: 'facebook-noshare' }))
  const network = screen.getByLabelText('Network') as HTMLSelectElement
  expect(network.value).toBe('facebook')
  expect(network.options[0].textContent).toBe('Facebook')
  expect(screen.getByLabelText('Label')).toBeTruthy()
  expect(screen.getByLabelText('Icon Background')).toBeTruthy()
})

test('a custom HTML block takes markup in a text area, refusing what the server would refuse', async () => {
  const user = userEvent.setup()
  const raw = make('mj-raw')
  renderFields(raw)

  const field = screen.getByLabelText('HTML')
  expect(field.tagName).toBe('TEXTAREA')
  await user.type(field, '<script>alert(1)</script>')
  await user.tab()
  expect(screen.getByText('Scripts aren’t allowed in an email. Remove the <script> tag.')).toBeTruthy()
  expect(raw.calls).toEqual([])

  await user.clear(field)
  await user.type(field, '<p>Hello</p>')
  await user.tab()
  expect(raw.calls).toEqual(['content:<p>Hello</p>'])
})

test('a column offers the vertical alignment choices, a section the horizontal ones', () => {
  const choices = (key: string) =>
    [...(document.querySelector(`[data-setting="${key}"]`) as HTMLElement).querySelectorAll('[role=radio]')]
      .map((node) => node.getAttribute('aria-label'))

  renderFields(make('mj-column'))
  expect(choices('vertical-align')).toEqual(['Top', 'Middle', 'Bottom'])

  cleanup()
  renderFields(make('mj-social'))
  expect(choices('align')).toEqual(['Left', 'Center', 'Right'])
})

test('the image block shows the picture, its file name and the way to change it', async () => {
  const user = userEvent.setup()
  const image = make('mj-image', { src: 'https://cdn.test/photos/hero.png' })
  const { onChooseImage } = renderFields(image)

  expect((document.querySelector('[data-setting="src"] img') as HTMLImageElement).src).toBe('https://cdn.test/photos/hero.png')
  expect(screen.getByTitle('hero.png')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: CHOOSE_IMAGE_LABEL }))
  expect(onChooseImage).toHaveBeenCalledTimes(1)
})

test('a source with no file name in it reads as a plain image, not as its last path segment', () => {
  renderFields(make('mj-image', { src: 'https://placehold.co/300x120/png' }))
  expect(screen.getByTitle('Image')).toBeTruthy()
})

test('an image with no picture yet says so rather than showing a broken one', () => {
  renderFields(make('mj-image'))
  expect(screen.getByText(NO_IMAGE_NOTE)).toBeTruthy()
  expect(document.querySelector('[data-setting="src"] img')).toBeNull()
})

test('alt text and the link sit with the image, and an empty alt clears the setting', async () => {
  const user = userEvent.setup()
  const image = make('mj-image', { src: 'https://cdn.test/a.png', alt: 'A logo' })
  renderFields(image)

  await user.clear(screen.getByLabelText('Alt Text'))
  await user.keyboard('{Enter}')
  expect('alt' in image.getAttributes()).toBe(false)

  await user.type(screen.getByLabelText('Link'), 'https://example.com{Enter}')
  expect(readSetting(image, 'href')).toBe('https://example.com')
})

test('a link MJML would happily write but a reader should not click is refused', async () => {
  const user = userEvent.setup()
  const button = make('mj-button')
  renderFields(button)

  await user.type(screen.getByLabelText('Link'), 'javascript:alert(1){Enter}')
  expect(screen.getByText('Use a web address, mailto: or tel:')).toBeTruthy()
  expect(readSetting(button, 'href')).toBe(null)
})

test('the text colour is measured against the background it will be read on', () => {
  const section = make('mj-section', { 'background-color': '#808080' })
  const column = make('mj-column', {}, { parent: section })
  renderFields(make('mj-text', { color: '#8a8a8a' }, { parent: column }))
  expect(screen.getByText('Hard to read on this background')).toBeTruthy()

  cleanup()
  const white = make('mj-section', { 'background-color': '#ffffff' })
  const inWhite = make('mj-column', {}, { parent: white })
  renderFields(make('mj-text', { color: '#000000' }, { parent: inWhite }))
  expect(screen.queryByText('Hard to read on this background')).toBeNull()
})

test('read-only greys every control and offers no Reset', () => {
  renderFields(make('mj-section', { 'background-color': '#123456' }), { disabled: true })

  for (const control of [...document.querySelectorAll('input, select')]) {
    expect((control as HTMLInputElement).disabled, control.getAttribute('aria-label') ?? '').toBe(true)
    expect(control.className).not.toContain('opacity')
  }
  expect(screen.queryByRole('button', { name: RESET_LABEL })).toBeNull()
  expect(screen.getByRole('switch', { name: 'Full Width' }).className).toContain('bg-line-subtle')
})

test('read-only leaves the image chooser inert too', async () => {
  const user = userEvent.setup()
  const { onChooseImage } = renderFields(make('mj-image', { src: 'https://cdn.test/a.png' }), { disabled: true })

  const choose = screen.getByRole('button', { name: CHOOSE_IMAGE_LABEL })
  expect(choose.getAttribute('aria-disabled')).toBe('true')
  await user.click(choose)
  expect(onChooseImage).not.toHaveBeenCalled()
})

test('a setting named by an issue row is opened and focused', () => {
  const image = make('mj-image', { src: 'https://cdn.test/a.png' })
  renderFields(image, { focusKey: 'alt' })
  expect(document.activeElement).toBe(screen.getByLabelText('Alt Text'))
})

test('values re-read when the editor says the model moved', () => {
  const spacer = make('mj-spacer', { height: '20px' })
  const { rerender } = renderFields(spacer)
  expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('20')

  spacer.addAttributes({ height: '44px' }) // as an undo or a canvas edit would
  rerender(<InspectorFields component={spacer} editor={editor()} version={1} />)
  expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('44')
})

// ---- hide on phones ------------------------------------------------------

const phoneSwitch = () => screen.getByRole('switch', { name: HIDE_MOBILE_LABEL })

test('a section offers the hide-on-phones switch, off until the class is there', () => {
  renderFields(make('mj-section'))
  expect(phoneSwitch().getAttribute('aria-checked')).toBe('false')

  cleanup()
  renderFields(make('mj-section', { 'css-class': HIDE_MOBILE_CLASS }))
  expect(phoneSwitch().getAttribute('aria-checked')).toBe('true')
})

test('the switch writes the class on, and takes it off again', async () => {
  const section = make('mj-section')
  renderFields(section)

  await userEvent.click(phoneSwitch())
  expect(section.getAttributes()['css-class']).toBe(HIDE_MOBILE_CLASS)
  expect(readSetting(section, HIDE_MOBILE_KEY)).toBe(HIDE_MOBILE_CLASS)

  cleanup()
  renderFields(section)
  await userEvent.click(phoneSwitch())
  expect(section.getAttributes()['css-class']).toBeUndefined()
})

test('the switch leaves the footer class alone', async () => {
  const footer = make('mj-section', { 'css-class': 'cep-footer' })
  renderFields(footer)

  await userEvent.click(phoneSwitch())
  expect(footer.getAttributes()['css-class']).toBe(`cep-footer ${HIDE_MOBILE_CLASS}`)
})

test('view-only shows the switch, greyed and inert, with no opacity', async () => {
  const section = make('mj-section')
  renderFields(section, { disabled: true })

  const control = phoneSwitch()
  expect(control.hasAttribute('disabled')).toBe(true)
  expect(control.className).toContain('bg-line-subtle')
  expect(control.className).not.toMatch(/\bopacity-/)

  await userEvent.click(control)
  expect(section.getAttributes()['css-class']).toBeUndefined()
})

test('a section says that columns stack on phones by themselves', () => {
  renderFields(make('mj-section'))
  expect(screen.getByText(STACK_NOTE)).toBeTruthy()

  cleanup()
  renderFields(make('mj-button'))
  expect(screen.queryByText(STACK_NOTE)).toBeNull()
})

test('view-only: typing, clicking and choosing in every field of a button writes nothing', async () => {
  const user = userEvent.setup()
  const button = make('mj-button', { href: 'https://shop.test', 'background-color': '#123456', width: '200px', align: 'left' })
  renderFields(button, { disabled: true })
  const before = JSON.stringify(button.getAttributes())

  for (const input of [...document.querySelectorAll('input')]) await user.type(input, '9{Enter}')
  for (const select of [...document.querySelectorAll('select')]) await user.selectOptions(select, select.options[1]?.value ?? '')
  for (const radio of screen.queryAllByRole('radio')) await user.click(radio)
  for (const toggle of screen.queryAllByRole('switch')) await user.click(toggle)

  expect(JSON.stringify(button.getAttributes())).toBe(before)
  expect(button.calls.filter((call) => call.startsWith('write') || call.startsWith('clear') || call.startsWith('content'))).toEqual([])
})

test('view-only values stay readable: grey fill, darker grey text, never faded', () => {
  renderFields(make('mj-button', { href: 'https://shop.test' }), { disabled: true })
  const link = screen.getByLabelText('Link')
  expect(link.className).toContain('bg-line-subtle')
  expect(link.className).toContain('text-ink-700')
  expect(link.className).not.toContain('text-ink-300')
  expect(link.className).not.toMatch(/\bopacity-/)
})

test('view-only still shows which way a switch is set', () => {
  renderFields(make('mj-section', { 'css-class': HIDE_MOBILE_CLASS }), { disabled: true })
  const on = screen.getByRole('switch', { name: HIDE_MOBILE_LABEL })
  const off = screen.getByRole('switch', { name: 'Full Width' })
  expect(on.getAttribute('aria-checked')).toBe('true')
  expect(on.className).not.toBe(off.className)
})

// ---- E-Receipt ------------------------------------------------------------

const swatches = () => screen.getByRole('radiogroup', { name: 'Brand Bar Color' })

test('the brand bar colour is four named swatches, the chosen one marked', () => {
  renderFields(make('cep-receipt-brand-header', { 'background-color': '#20265d' }))

  const options = [...swatches().querySelectorAll('[role=radio]')]
  expect(options.map((option) => option.getAttribute('aria-label'))).toEqual(['Navy 700', 'Navy 900', 'Teal 600', 'Gray 900'])
  expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false'])
  expect(screen.getByRole('radio', { name: 'Navy 900' }).className).toContain('ring-brand-600')
  expect(screen.getByRole('radio', { name: 'Teal 600' }).className).not.toContain('ring-2')
})

test('choosing a swatch writes its colour', async () => {
  const user = userEvent.setup()
  const header = make('cep-receipt-brand-header', { 'background-color': '#20265d' })
  renderFields(header)

  await user.click(screen.getByRole('radio', { name: 'Teal 600' }))
  expect(header.getAttributes()['background-color']).toBe('#418eae')
})

test('the brand header aligns left or center only', () => {
  renderFields(make('cep-receipt-brand-header'))
  const align = document.querySelector('[data-setting="align"]') as HTMLElement
  expect([...align.querySelectorAll('[role=radio]')].map((option) => option.getAttribute('aria-label'))).toEqual(['Left', 'Center'])
})

test('a receipt button takes its destination and style from fixed lists, with no empty row', () => {
  renderFields(make('cep-receipt-button'))
  const options = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((option) => option.textContent)

  expect(options('Destination')).toEqual(['Order Status Page', 'Outerwear Category', 'Loyalty Hub', 'Start a Return'])
  expect(options('Style')).toEqual(['Primary', 'Outline'])
  expect(screen.queryByRole('textbox', { name: 'Link' })).toBeNull()
})

test('the marketing body is a text area with the four tag chips', () => {
  renderFields(make('cep-marketing'))
  expect(screen.getByLabelText('Body').tagName).toBe('TEXTAREA')
  for (const name of ['First Name', 'Order Number', 'Order Total', 'Store Name']) expect(screen.getByRole('button', { name: `Insert ${name}` })).toBeTruthy()
  expect([...(screen.getByLabelText('Treatment') as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(['Plain', 'Accent'])
})

test('a divider has nothing to set and says why; a footer says what it cannot carry', () => {
  const { unmount } = renderFields(make('cep-receipt-divider'))
  expect(screen.getByText(/Spacing is fixed by the design system/)).toBeTruthy()
  expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0)
  unmount()

  renderFields(make('cep-receipt-footer'))
  expect(screen.getByText(/no unsubscribe link/)).toBeTruthy()
  expect(screen.getByLabelText('Sender Address').tagName).toBe('TEXTAREA')
})

test('a barcode block opens its configuration box: the coupon tags first as its data source, the types, and what went wrong', () => {
  const tag = (tag_key: string, label: string) => ({
    id: tag_key, tag_key, label, tag_kind: 'CUSTOM', data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null, sample_value: null,
    default_value: null, static_value: null, is_active: true,
  })
  const code = make(CODE_TYPE, {}, { content: codeRegion(BARCODE_DEFAULTS, 'CPN1', 'https://x.example/c.png') })
  code.set('cep-code-problem', 'The sample value cannot be drawn: no value.')
  renderFields(code, { tagPicker: { tags: [tag('first_name', 'First Name'), tag('coupon_barcode_value', 'Coupon Barcode Value')], channel: 'EMAIL', recent: [] } })

  const source = screen.getByLabelText('Data Source') as HTMLSelectElement
  expect([...source.options].map((option) => option.textContent)).toEqual(['Coupon Barcode Value', 'First Name'])        // required: no empty row
  expect(source.value).toBe('coupon_barcode_value')
  expect([...(screen.getByLabelText('Barcode Type') as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(['Code 128', 'Code 39', 'EAN-13', 'UPC-A'])
  expect(screen.getByText('The sample value cannot be drawn: no value.')).toBeTruthy()
  expect(screen.getByText('Drawn for each recipient when the email is sent. A recipient without a value gets the email without this block.')).toBeTruthy()
  expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('300')
})
