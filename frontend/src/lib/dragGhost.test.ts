import { afterEach, expect, test } from 'vitest'

import { carryCopy, carryLabel, dropGhost } from './dragGhost'

const ghost = () => document.querySelector<HTMLElement>('[data-drag-ghost]')
const pointer = (type: string, x = 0, y = 0) => {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { clientX: x, clientY: y })
  return event
}
const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

function tile(): HTMLElement {
  const scope = document.createElement('div')
  scope.className = 'editor-radii editor-type'
  const button = document.createElement('button')
  button.id = 'tile-text'
  button.title = 'Text'
  button.textContent = 'Text'
  button.getBoundingClientRect = () => box(20, 300, 76, 56)
  scope.appendChild(button)
  document.body.appendChild(scope)
  return button
}

afterEach(() => {
  dropGhost()
  document.body.innerHTML = ''
})

test('a copy of the tile follows the pointer, held where it was pressed, and shows only once the pointer moves', () => {
  const source = tile()
  carryCopy(source, { at: { x: 50, y: 320 } })

  const carried = ghost()
  expect(carried).toBeTruthy()
  expect(carried?.style.visibility).toBe('hidden') // a press that never travels is a click
  expect(carried?.getAttribute('aria-hidden')).toBe('true')
  expect(carried?.className).toContain('pointer-events-none')
  expect(carried?.className).toContain('editor-radii') // the editor's own corners, as on the tile
  const copy = carried?.firstElementChild as HTMLElement
  expect(copy.textContent).toBe('Text')
  expect(copy.id).toBe('') // never a second element with the tile's id
  expect(copy.style.width).toBe('76px')

  document.dispatchEvent(pointer('pointermove', 400, 250))
  expect(carried?.style.visibility).toBe('visible')
  // pressed 30px in and 20px down from the tile's corner, so the copy's corner stays that far from the pointer
  expect(carried?.style.transform).toBe('translate3d(370px, 230px, 0)')
})

test('the pointer is followed inside a canvas frame too, with the frame’s place and zoom', () => {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  frame.getBoundingClientRect = () => box(500, 100, 300, 400) // drawn at half size
  Object.defineProperty(frame, 'offsetWidth', { value: 600 })
  carryCopy(tile(), { at: { x: 20, y: 300 }, frames: [frame] })

  frame.contentDocument?.dispatchEvent(pointer('pointermove', 200, 80))
  expect(ghost()?.style.transform).toBe('translate3d(600px, 140px, 0)')

  // an editor that hands the frame's move on to the page (on the iframe, in the frame's coordinates) does not move it again
  frame.dispatchEvent(pointer('pointermove', 200, 80))
  expect(ghost()?.style.transform).toBe('translate3d(600px, 140px, 0)')
})

test('letting go anywhere puts it down: on the page, in the frame, or when the drag is cancelled', () => {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)

  carryCopy(tile(), { frames: [frame] })
  document.dispatchEvent(pointer('pointerup'))
  expect(ghost()).toBeNull()

  carryCopy(tile(), { frames: [frame] })
  frame.contentDocument?.dispatchEvent(pointer('pointerup'))
  expect(ghost()).toBeNull()

  const carried = carryCopy(tile())
  carried.stop()
  carried.stop() // twice is harmless
  expect(ghost()).toBeNull()
  document.dispatchEvent(pointer('pointermove', 10, 10)) // nothing listens any more
  expect(ghost()).toBeNull()
})

test('a chip names a block moved on the canvas, a little off the pointer; only one thing is carried at a time', () => {
  carryCopy(tile())
  carryLabel('Image')
  expect(document.querySelectorAll('[data-drag-ghost]')).toHaveLength(1)
  expect(ghost()?.textContent).toBe('Image')

  document.dispatchEvent(pointer('pointermove', 100, 100))
  expect(ghost()?.style.transform).toBe('translate3d(114px, 114px, 0)')
})
