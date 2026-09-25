/**
 * The locked "Receipt slot" of an E-Receipt design: where the itemized receipt built in Receipt layout is inserted.
 * An mj-raw, because the formatter and the compiler copy its content byte for byte, so the marker never reflows.
 * Static markup only: nothing in it may depend on script running in an inbox.
 */
import type { Component, Editor } from 'grapesjs'

export const RECEIPT_SLOT_TYPE = 'cep-receipt-slot'
export const RECEIPT_SLOT_CSS_CLASS = 'cep-receipt-slot'

/**
 * Bracket the placeholder in the compiled HTML. mj-raw content is copied byte for byte, so the comments survive
 * compiling and the receipt can later be put in their place without parsing the email.
 */
export const RECEIPT_SLOT_MARKER_START = '<!-- CEP:RECEIPT_SLOT_START -->'
export const RECEIPT_SLOT_MARKER_END = '<!-- CEP:RECEIPT_SLOT_END -->'

export const RECEIPT_SLOT_MJML = `<mj-raw css-class="${RECEIPT_SLOT_CSS_CLASS}">
  ${RECEIPT_SLOT_MARKER_START}
  <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background-color:#ffffff">
    <tr>
      <td style="padding:8px 24px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed #94a3b8;border-radius:8px">
          <tr>
            <td align="center" style="padding:32px 16px;font-family:Helvetica, Arial, sans-serif;font-size:15px;line-height:24px;color:#334155">Receipt content injects here</td>
          </tr>
        </table>
        <p style="margin:8px 0 0;font-family:Helvetica, Arial, sans-serif;font-size:12px;line-height:18px;color:#64748b;text-align:center">Configured in Receipt layout</p>
      </td>
    </tr>
  </table>
  ${RECEIPT_SLOT_MARKER_END}
</mj-raw>`

/** The slot is the one selectable thing: its markup is not blocks, so none of it can be picked, edited or dropped into. */
const INERT = {
  draggable: false, removable: false, copyable: false, editable: false, droppable: false,
  selectable: false, hoverable: false, highlightable: false, layerable: false,
}

/** Everything inside a receipt block: part of the block, never a block of its own. */
export function makeInert(component: Component): void {
  component.set(INERT)
  component.components().forEach(makeInert)
}

export function registerReceiptSlotType(editor: Editor, { channel }: { channel: string }): void {
  if (channel !== 'E_RECEIPT') return
  const raw = editor.Components.getType('mj-raw')?.model.prototype as { init?: (this: Component) => void } | undefined
  editor.Components.addType(RECEIPT_SLOT_TYPE, {
    extend: 'mj-raw',
    isComponent: (el: HTMLElement) => el.tagName === 'MJ-RAW' && el.getAttribute('css-class') === RECEIPT_SLOT_CSS_CLASS,
    model: {
      defaults: { name: 'Receipt Slot', draggable: false, removable: false, copyable: false, editable: false, droppable: false, highlightable: true, layerable: true },
      init(this: Component) {
        raw?.init?.call(this)
        this.components().forEach(makeInert)
        this.listenTo(this.components(), 'add', makeInert)
      },
    },
  })
}
