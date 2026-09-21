import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Component } from 'grapesjs'
import { afterEach, expect, test, vi } from 'vitest'

import { CHOOSE_IMAGE_LABEL, InspectorFields, NO_IMAGE_NOTE } from './InspectorFields'
import { EMAIL_SETTINGS_NOTE, INHERITED_NOTE, RESET_LABEL } from './fields/types'
import { CANVAS_TEXT_NOTE, HIDE_MOBILE_KEY, HIDE_MOBILE_LABEL, STACK_NOTE, readSetting } from './settings'
import { HIDE_MOBILE_CLASS } from '../blocks/register'

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
  expect(keys()).toEqual(['height'])
  expect(sections()).toEqual(['Layout'])

  cleanup()
  renderFields(make('mj-divider'))
  expect(keys()).toEqual(['padding', 'border-color', 'border-width'])

  cleanup()
  renderFields(make('mj-social-element'))
  expect(keys()).toEqual(['href'])

  cleanup()
  renderFields(make('mj-section'))
  expect(keys()).toEqual(['padding', 'full-width', HIDE_MOBILE_KEY, 'background-color', 'border-radius'])
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

  await user.type(screen.getByLabelText('Font size'), '2em')
  expect(screen.getByText('Use a number in px')).toBeTruthy()
  await user.keyboard('{Enter}')

  // "2" previewed on the way to "2em"; leaving the field abandons that preview rather than keeping it
  await user.tab()
  expect(readSetting(text, 'font-size')).toBe(null)
})

test('a length offers only the units MJML accepts for that setting', () => {
  renderFields(make('mj-text'))
  // font-size is px only, so there is no unit switch to offer
  expect(screen.queryByRole('radiogroup', { name: 'Font size unit' })).toBeNull()

  cleanup()
  renderFields(make('mj-spacer'))
  expect(screen.getByRole('radiogroup', { name: 'Height unit' })).toBeTruthy()
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

  const select = screen.getByLabelText('Font weight') as HTMLSelectElement
  expect([...select.options].map((option) => option.textContent))
    .toEqual(['Default', 'Light', 'Regular', 'Medium', 'Semibold', 'Bold'])

  await user.selectOptions(select, '700')
  expect(readSetting(text, 'font-weight')).toBe('700')
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

  await user.clear(screen.getByLabelText('Alt text'))
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
  expect(screen.getByRole('switch', { name: 'Full width' }).className).toContain('bg-line-subtle')
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
  expect(document.activeElement).toBe(screen.getByLabelText('Alt text'))
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
  const off = screen.getByRole('switch', { name: 'Full width' })
  expect(on.getAttribute('aria-checked')).toBe('true')
  expect(on.className).not.toBe(off.className)
})
