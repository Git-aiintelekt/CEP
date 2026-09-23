import type { Editor } from 'grapesjs'
import mjml2html from 'mjml-browser'
import { expect, test, vi } from 'vitest'

import {
  RECEIPT_BLOCKS, RECEIPT_BLOCK_TYPES, RECEIPT_FOOTER_CLASS, hasReceiptFooter, registerReceiptBlockTypes,
} from './receiptBlocks'

interface TypeDefinition {
  extend?: string
  isComponent?: (el: HTMLElement) => boolean
  model: { defaults: Record<string, unknown> }
}

/** Only what registerReceiptBlockTypes touches: addType, and getType for the plugin's own mj-body. */
function mockEditor() {
  const added = new Map<string, TypeDefinition>()
  const addType = vi.fn((type: string, definition: TypeDefinition) => added.set(type, definition))
  const bodyDefaults = { droppable: '[data-gjs-type="mj-section"], [data-gjs-type="mj-raw"]' }
  const getType = (type: string) => (type === 'mj-body' ? { model: { prototype: { defaults: bodyDefaults } } } : undefined)
  return { editor: { Components: { addType, getType } } as unknown as Editor, addType, added }
}

const element = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.firstElementChild as HTMLElement
}

test('all six block types register for a receipt, as sections', () => {
  const { editor, added } = mockEditor()
  registerReceiptBlockTypes(editor, { channel: 'E_RECEIPT' })

  for (const type of RECEIPT_BLOCK_TYPES) {
    expect(added.get(type)?.extend, type).toBe('mj-section')
    expect(added.get(type)?.model.defaults, type).toMatchObject({ droppable: false })
  }
})

test('nothing registers for any other channel', () => {
  for (const channel of ['EMAIL', 'SMS', '']) {
    const { editor, addType } = mockEditor()
    registerReceiptBlockTypes(editor, { channel })
    expect(addType, channel).not.toHaveBeenCalled()
  }
})

test('the body takes the receipt blocks as well as everything it already took', () => {
  const { editor, added } = mockEditor()
  registerReceiptBlockTypes(editor, { channel: 'E_RECEIPT' })

  const droppable = String(added.get('mj-body')?.model.defaults.droppable)
  expect(droppable).toContain('[data-gjs-type="mj-section"]')
  expect(droppable).toContain('[data-gjs-type="mj-raw"]')
  for (const type of RECEIPT_BLOCK_TYPES) expect(droppable).toContain(`[data-gjs-type="${type}"]`)
})

test('each type claims only a section carrying its own class', () => {
  const { editor, added } = mockEditor()
  registerReceiptBlockTypes(editor, { channel: 'E_RECEIPT' })

  for (const type of RECEIPT_BLOCK_TYPES) {
    const isComponent = added.get(type)?.isComponent as (el: HTMLElement) => boolean
    const own = RECEIPT_BLOCKS.find((block) => block.mjml.includes(`css-class="${type}`)) ?? { mjml: '' }
    expect(isComponent(element(own.mjml)), type).toBe(true)
    expect(isComponent(element('<mj-section><mj-column></mj-column></mj-section>')), type).toBe(false)
    expect(isComponent(element(`<mj-text css-class="${type}">x</mj-text>`)), type).toBe(false)
    for (const other of RECEIPT_BLOCK_TYPES.filter((item) => item !== type)) {
      expect(isComponent(element(`<mj-section css-class="${other}"></mj-section>`)), `${type} vs ${other}`).toBe(false)
    }
  }
})

test('every block compiles on its own without a warning', () => {
  for (const block of RECEIPT_BLOCKS) {
    const { errors } = mjml2html(`<mjml><mj-body>${block.mjml.replace('__ASSET_IMAGE__', 'https://cdn.example.com/a.png')}</mj-body></mjml>`, { validationLevel: 'soft' })
    expect(errors, block.id).toEqual([])
  }
})

test('the footer is found by its class; a design without it is not', () => {
  const footer = RECEIPT_BLOCKS.find((block) => block.id === 'receipt-footer')?.mjml ?? ''
  expect(hasReceiptFooter(footer)).toBe(true)
  expect(footer).toContain('This is a transactional receipt for a purchase you made.')
  expect(footer).not.toMatch(/unsubscribe/i)
  expect(hasReceiptFooter('<mj-section css-class="cep-footer"></mj-section>')).toBe(false)
  expect(RECEIPT_FOOTER_CLASS).toBe('cep-receipt-footer')
})

test('no block is interactive: no script, no handlers', () => {
  for (const block of RECEIPT_BLOCKS) expect(block.mjml, block.id).not.toMatch(/<script|\son[a-z]+=|javascript:/i)
})
