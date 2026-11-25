/**
 * An Image block with no picture yet. On the canvas it is a waiting slot: a dashed box with a picture mark and a
 * Select Image button that opens the image picker. It is drawn into the block's view only, never into the component,
 * so the MJML, the compiled email and the saved design hold nothing of it: an image with no source and nothing else.
 */
import type { Component, Editor } from 'grapesjs'

const IMAGE_TYPE = 'mj-image'
/** the slot itself, which the canvas skin styles; the image after it is hidden while it stands there */
export const IMAGE_SLOT_BODY = 'data-cep-image-slot-body'
export const IMAGE_SLOT_BUTTON = 'data-cep-select-image'
/** raised on the editor with the image component when Select Image is pressed */
export const SELECT_IMAGE_EVENT = 'cep:select-image'
export const SELECT_IMAGE_LABEL = 'Select Image'

// Lucide's "image", as the palette tile draws it
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'

// MJML draws nothing at all for an image with no source, so on the canvas the waiting block is compiled with this
// one transparent pixel: the block then has its cell to put the slot in. The view's MJML only, never the design's.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

interface ImageView {
  model: Component & { getMjmlAttributes: () => Record<string, unknown> }
  getInnerMjmlTemplate: () => { start: string; end: string }
}

/** No address, or the drawing GrapesJS gives an image that has none (markup, never an address): designs saved before carry it. */
export function hasNoPicture(component: Component): boolean {
  const src = String(component.getAttributes().src || component.get('src') || '').trim()
  return src === '' || src.startsWith('<')
}

/** `readOnly`: asked at each draw; a design that cannot be changed shows the slot without its button. */
export function registerImageSlot(editor: Editor, { readOnly }: { readOnly: () => boolean }): void {
  const drawn = editor.Components.getType(IMAGE_TYPE)?.view.prototype as ImageView | undefined
  editor.Components.addType(IMAGE_TYPE, {
    extend: IMAGE_TYPE,
    // re-adding a type does not carry its recogniser over
    isComponent: (el: HTMLElement) => el.tagName === 'MJ-IMAGE',
    // GrapesJS starts every image on a stand-in drawing, which the plugin then writes into the MJML as the image's
    // address: broken markup in the email. An image with no picture has no address at all.
    model: { defaults: { src: '' } },
    view: {
      getInnerMjmlTemplate(this: ImageView) {
        if (!hasNoPicture(this.model) && drawn) return drawn.getInnerMjmlTemplate.call(this)
        const attributes = Object.entries({ ...this.model.getMjmlAttributes(), src: BLANK })
        const written = attributes.filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => ` ${name}="${String(value)}"`).join('')
        return { start: `<${IMAGE_TYPE}${written}>`, end: `</${IMAGE_TYPE}>` }
      },
      // the plugin redraws the block from its MJML on every change, so the slot is put back (or left out) each time
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        const image = el.querySelector('img')
        const cell = image?.parentElement
        if (!hasNoPicture(model) || !image || !cell) return
        // the slot fills the column: the cell and its table are sized for the blank pixel they were compiled around
        cell.style.width = 'auto'
        const table = cell.closest('table')
        if (table) table.style.width = '100%'
        const doc = el.ownerDocument
        const slot = doc.createElement('div')
        slot.setAttribute(IMAGE_SLOT_BODY, '')
        slot.innerHTML = MARK
        if (!readOnly()) {
          const button = doc.createElement('span')
          button.setAttribute(IMAGE_SLOT_BUTTON, '')
          button.setAttribute('role', 'button')
          button.textContent = SELECT_IMAGE_LABEL
          // the press also reaches the canvas, which selects the block as any click on it does
          button.addEventListener('click', () => editor.trigger(SELECT_IMAGE_EVENT, model))
          slot.appendChild(button)
        }
        cell.insertBefore(slot, image)
      },
    },
  })
}
