import grapesjs, { type Component, type Editor } from 'grapesjs'
import { afterEach, expect, test, vi } from 'vitest'

import { IMAGE_SLOT_BODY, IMAGE_SLOT_BUTTON, SELECT_IMAGE_EVENT, hasNoPicture, registerImageSlot } from './imageSlot'

let editor: Editor | null = null

/** An editor whose mj-image is a plain image type with the one view method the slot builds on. */
function editorWithImages(readOnly = false): Editor {
  const made = grapesjs.init({ container: document.createElement('div'), headless: true, storageManager: false })
  made.Components.addType('mj-image', {
    extend: 'image',
    isComponent: (el: HTMLElement) => el.tagName === 'MJ-IMAGE',
    model: { getMjmlAttributes(this: Component) { return { ...this.getAttributes() } } },
    view: { getInnerMjmlTemplate: () => ({ start: '<mj-image src="real">', end: '</mj-image>' }) },
  })
  registerImageSlot(made, { readOnly: () => readOnly })
  editor = made
  return made
}

const image = (made: Editor, markup: string) => made.getWrapper()!.append(markup)[0]

/** The block as the plugin draws it: a row, a cell and the image, handed to the view's own onRender. */
function draw(made: Editor, component: Component): HTMLElement {
  const row = document.createElement('tr')
  row.innerHTML = '<td><table style="width:1px"><tbody><tr><td style="width:1px"><img alt=""></td></tr></tbody></table></td>'
  const view = made.Components.getType('mj-image')!.view.prototype as { onRender: (given: { el: HTMLElement; model: Component }) => void }
  view.onRender({ el: row, model: component })
  return row
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

test('an image with no address, or with the editor’s stand-in drawing for one, has no picture', () => {
  const made = editorWithImages()
  expect(hasNoPicture(image(made, '<mj-image src=""></mj-image>'))).toBe(true)
  expect(hasNoPicture(image(made, '<mj-image></mj-image>'))).toBe(true)
  expect(hasNoPicture(image(made, '<mj-image src="https://cdn.example/bag.jpg"></mj-image>'))).toBe(false)
  const old = image(made, '<mj-image></mj-image>')
  old.addAttributes({ src: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })       // what a design saved before carries
  expect(hasNoPicture(old)).toBe(true)
})

test('an image dropped without a picture carries no address into the design: never the editor’s stand-in drawing', () => {
  const made = editorWithImages()
  const waiting = image(made, '<mj-image src="" alt=""></mj-image>')
  expect(waiting.get('src')).toBe('')
  expect(made.getHtml()).not.toContain('<svg')
})

test('on the canvas it waits as a slot that fills its column, with a Select Image button that asks for the picture', () => {
  const made = editorWithImages()
  const waiting = image(made, '<mj-image src=""></mj-image>')
  const asked = vi.fn()
  made.on(SELECT_IMAGE_EVENT, asked)

  const row = draw(made, waiting)
  const slot = row.querySelector(`[${IMAGE_SLOT_BODY}]`)
  expect(slot?.nextElementSibling?.tagName).toBe('IMG')            // the skin hides the image that follows the slot
  expect(slot?.querySelector('svg')).toBeTruthy()
  expect(slot?.closest('table')?.style.width).toBe('100%')
  const button = row.querySelector<HTMLElement>(`[${IMAGE_SLOT_BUTTON}]`)
  expect(button?.textContent).toBe('Select Image')
  expect(button?.getAttribute('role')).toBe('button')
  button?.click()
  expect(asked).toHaveBeenCalledWith(waiting)
})

test('an image that has its picture is drawn as it is; a design that cannot change shows the slot without the button', () => {
  const made = editorWithImages()
  const row = draw(made, image(made, '<mj-image src="https://cdn.example/bag.jpg"></mj-image>'))
  expect(row.querySelector(`[${IMAGE_SLOT_BODY}]`)).toBeNull()
  made.destroy()

  const locked = editorWithImages(true)
  const waiting = draw(locked, image(locked, '<mj-image src=""></mj-image>'))
  expect(waiting.querySelector(`[${IMAGE_SLOT_BODY}]`)).toBeTruthy()
  expect(waiting.querySelector(`[${IMAGE_SLOT_BUTTON}]`)).toBeNull()
})

test('the waiting block is compiled for the canvas around a blank pixel, so it has a cell to stand in; a real picture is left alone', () => {
  const made = editorWithImages()
  const view = made.Components.getType('mj-image')!.view.prototype as { getInnerMjmlTemplate: (this: { model: Component }) => { start: string; end: string } }
  const waiting = view.getInnerMjmlTemplate.call({ model: image(made, '<mj-image src="" padding="12px 25px"></mj-image>') })
  expect(waiting.start).toMatch(/^<mj-image [^>]*src="data:image\/gif;base64,[^"]+"[^>]*>$/)
  expect(waiting.start).toContain(' padding="12px 25px"')
  expect(waiting.end).toBe('</mj-image>')
  expect(view.getInnerMjmlTemplate.call({ model: image(made, '<mj-image src="https://cdn.example/bag.jpg"></mj-image>') }).start).toBe('<mj-image src="real">')
})
