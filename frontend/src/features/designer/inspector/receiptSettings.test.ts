import type { Component } from 'grapesjs'
import { expect, test } from 'vitest'

import { hasReceiptFooter } from '../blocks/receiptBlocks'
import { readSetting, writeSetting } from './settings'
import { NO_IMAGE_CALLOUT, DIVIDER_NOTE, FOOTER_NOTE, receiptCallout } from './receiptSettings'

/** A small component tree: enough for the accessors, which walk parts by tag and css-class. */
function node(tagName: string, attributes: Record<string, unknown> = {}, kids: Component[] = [], content = '', type = tagName): Component {
  let attrs = { ...attributes }
  let children = kids
  const state: Record<string, unknown> = { type, tagName, content }
  const self = {
    get: (key: string) => state[key],
    set: (key: string, value: unknown) => {
      state[key] = value
    },
    getAttributes: () => attrs,
    addAttributes: (next: Record<string, unknown>) => {
      attrs = { ...attrs, ...next }
    },
    removeAttributes: (keys: string | string[]) => {
      for (const key of [keys].flat()) delete attrs[key]
    },
    components: (value?: string) => {
      if (value !== undefined) children = [node('textnode', {}, [], value)]
      return { map: <T,>(fn: (child: Component) => T) => children.map(fn), forEach: (fn: (child: Component) => void) => children.forEach(fn) }
    },
  }
  return self as unknown as Component
}

const marketing = () =>
  node('mj-section', { 'css-class': 'cep-marketing' }, [
    node('mj-column', { padding: '0' }, [
      node('mj-text', { 'css-class': 'cep-headline', 'font-size': '24px', align: 'left' }, [node('textnode', {}, [], 'Hello')]),
      node('mj-text', { 'css-class': 'cep-body', align: 'left' }, [node('textnode', {}, [], 'Body')]),
    ]),
  ], '', 'cep-marketing')

const kids = (component: Component) => (component.components() as unknown as { map: (fn: (child: Component) => Component) => Component[] }).map((child) => child)
const partOf = (block: Component, path: number[]): Component => path.reduce<Component>((at, index) => kids(at)[index], block)

test('the marketing headline and body read and write their own parts', () => {
  const block = marketing()
  expect(readSetting(block, 'headline')).toBe('Hello')
  writeSetting(block, 'body', 'Line one\nLine two & more')
  expect(String(partOf(block, [0, 1, 0]).get('content'))).toBe('Line one<br />Line two &amp; more')
})

test('Accent puts the headline in a brand-tag card; Plain takes the card away again', () => {
  const block = marketing()
  expect(readSetting(block, 'treatment')).toBe('plain')

  writeSetting(block, 'treatment', 'accent')
  expect(readSetting(block, 'treatment')).toBe('accent')
  expect(partOf(block, [0]).getAttributes()).toMatchObject({ 'background-color': '#dee9fc', 'border-radius': '8px', padding: '20px' })
  expect(partOf(block, [0, 0]).getAttributes()).toMatchObject({ 'font-size': '18px', color: '#2b4dd0' })

  writeSetting(block, 'treatment', 'plain')
  expect(partOf(block, [0]).getAttributes()['background-color']).toBeUndefined()
  expect(partOf(block, [0, 0]).getAttributes()['font-size']).toBe('24px')
})

test('alignment moves the headline and the body together', () => {
  const block = marketing()
  writeSetting(block, 'align', 'center')
  expect(partOf(block, [0, 0]).getAttributes().align).toBe('center')
  expect(partOf(block, [0, 1]).getAttributes().align).toBe('center')
  expect(readSetting(block, 'align')).toBe('center')
})

test('the button destination is one of the fixed choices, never a typed address', () => {
  const button = node('mj-button', { href: '#order-status' }, [node('textnode', {}, [], 'Go')])
  const block = node('mj-section', { 'css-class': 'cep-receipt-button' }, [node('mj-column', {}, [button])], '', 'cep-receipt-button')

  expect(readSetting(block, 'destination')).toBe('order-status')
  writeSetting(block, 'destination', 'returns')
  expect(button.getAttributes().href).toBe('#returns')

  writeSetting(block, 'button-style', 'outline')
  expect(readSetting(block, 'button-style')).toBe('outline')
  expect(button.getAttributes()).toMatchObject({ 'background-color': '#ffffff', color: '#2753e4' })
})

test('the image ratio is one class on the block, replacing the last', () => {
  const block = node('mj-section', { 'css-class': 'cep-receipt-image cep-ratio-16x9' }, [node('mj-column', {}, [node('mj-image', { src: '', alt: '' })])], '', 'cep-receipt-image')
  expect(readSetting(block, 'ratio')).toBe('16x9')
  writeSetting(block, 'ratio', '1x1')
  expect(block.getAttributes()['css-class']).toBe('cep-receipt-image cep-ratio-1x1')
})

test('the callouts: a divider and a footer always, an image only until it has a picture', () => {
  const image = (src: string) =>
    node('mj-section', { 'css-class': 'cep-receipt-image' }, [node('mj-column', {}, [node('mj-image', { src })])], '', 'cep-receipt-image')
  expect(receiptCallout('cep-receipt-divider', node('mj-section'))).toBe(DIVIDER_NOTE)
  expect(receiptCallout('cep-receipt-footer', node('mj-section'))).toBe(FOOTER_NOTE)
  expect(receiptCallout('cep-receipt-image', image(''))).toBe(NO_IMAGE_CALLOUT)
  expect(receiptCallout('cep-receipt-image', image('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(NO_IMAGE_CALLOUT)
  expect(receiptCallout('cep-receipt-image', image('https://cdn.example.com/a.png'))).toBeNull()
  expect(receiptCallout('mj-section', node('mj-section'))).toBeNull()
  expect(hasReceiptFooter('')).toBe(false)
})
