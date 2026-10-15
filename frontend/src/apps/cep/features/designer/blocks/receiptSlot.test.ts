import type { Editor } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import { RECEIPT_SLOT_CSS_CLASS, RECEIPT_SLOT_MJML, RECEIPT_SLOT_TYPE, registerReceiptSlotType } from './receiptSlot'

interface TypeDefinition {
  extend: string
  isComponent: (el: HTMLElement) => boolean
  model: { defaults: Record<string, unknown> }
}

/** Only the two methods registerReceiptSlotType touches. */
function mockEditor(): { editor: Editor; addType: ReturnType<typeof vi.fn> } {
  const addType = vi.fn()
  return { editor: { Components: { addType, getType: () => undefined } } as unknown as Editor, addType }
}

const element = (html: string) => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.firstElementChild as HTMLElement
}

test('registers the slot type once for a receipt', () => {
  const { editor, addType } = mockEditor()
  registerReceiptSlotType(editor, { channel: 'E_RECEIPT' })

  expect(addType).toHaveBeenCalledTimes(1)
  expect(addType.mock.calls[0][0]).toBe(RECEIPT_SLOT_TYPE)
  expect((addType.mock.calls[0][1] as TypeDefinition).extend).toBe('mj-raw')
})

test('registers nothing for any other channel', () => {
  for (const channel of ['EMAIL', 'SMS', 'MMS', '']) {
    const { editor, addType } = mockEditor()
    registerReceiptSlotType(editor, { channel })
    expect(addType, channel).not.toHaveBeenCalled()
  }
})

test('the slot cannot be dragged, deleted, duplicated or edited, but can be selected and seen in Layers', () => {
  const { editor, addType } = mockEditor()
  registerReceiptSlotType(editor, { channel: 'E_RECEIPT' })

  expect((addType.mock.calls[0][1] as TypeDefinition).model.defaults).toMatchObject({
    draggable: false, removable: false, copyable: false, editable: false, highlightable: true, layerable: true,
  })
})

test('only an mj-raw carrying the slot class becomes the slot', () => {
  const { editor, addType } = mockEditor()
  registerReceiptSlotType(editor, { channel: 'E_RECEIPT' })
  const { isComponent } = addType.mock.calls[0][1] as TypeDefinition

  expect(isComponent(element(RECEIPT_SLOT_MJML))).toBe(true)
  expect(isComponent(element('<mj-raw><p>raw</p></mj-raw>'))).toBe(false)
  expect(isComponent(element(`<mj-section css-class="${RECEIPT_SLOT_CSS_CLASS}"></mj-section>`))).toBe(false)
})

test('the slot markup is a static marker with nothing interactive in it', () => {
  expect(RECEIPT_SLOT_MJML).toContain(RECEIPT_SLOT_CSS_CLASS)
  expect(RECEIPT_SLOT_MJML).not.toMatch(/<button|onclick|<script/i)
})
