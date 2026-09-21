import { expect, test } from 'vitest'

import { POPOVER_MAX_HEIGHT, POPOVER_WIDTH, placePopover } from './placement'

const rect = (left: number, top: number, width = 32, height = 32) => ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect
const viewport = { width: 1280, height: 800 }

test('opens below the button when there is room', () => {
  const at = placePopover(rect(100, 100), viewport)
  expect(at).toEqual({ left: 100, top: 136, flipped: false })
})

test('flips above when the room below has run out and there is more above', () => {
  const at = placePopover(rect(100, 700), viewport)
  expect(at.flipped).toBe(true)
  expect(at.bottom).toBe(800 - 700 + 4)
  expect(at.top).toBeUndefined()
})

test('stays below when neither side has room but below has more', () => {
  const at = placePopover(rect(100, 120), { width: 1280, height: 400 })
  expect(at.flipped).toBe(false)
})

test('never runs past the right edge, nor the left', () => {
  expect(placePopover(rect(1270, 100), viewport).left).toBe(1280 - POPOVER_WIDTH - 8)
  expect(placePopover(rect(-40, 100), viewport).left).toBe(8)
})

test('the size the flip decision assumes is the size the panel is capped at', () => {
  expect(POPOVER_MAX_HEIGHT).toBe(360)
  expect(POPOVER_WIDTH).toBe(320)
})
