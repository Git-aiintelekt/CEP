import { expect, test } from 'vitest'

import { DEVICES, DESKTOP_FRAME_WIDTH, FIT_GUTTER, MJML_STACK_WIDTH, WHEEL_STEP_GAP_MS, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, clampZoom, fitZoom, formatZoom, frameWidthFor, nextZoom, panForZoom, wheelStepDue, wheelZoomDirection } from './zoom'

test('the steps and the ends are what the brief fixed', () => {
  expect(ZOOM_STEPS).toEqual([50, 75, 100, 125, 150])
  expect(ZOOM_MIN).toBe(25)
  expect(ZOOM_MAX).toBe(200)
})

test('clamp keeps a zoom between the ends and whole', () => {
  expect(clampZoom(10)).toBe(25)
  expect(clampZoom(500)).toBe(200)
  expect(clampZoom(77.6)).toBe(78)
  expect(clampZoom(Number.NaN)).toBe(100)
})

test('stepping from a step lands on the next one, and stops at the ends', () => {
  expect(nextZoom(100, 'in')).toBe(125)
  expect(nextZoom(100, 'out')).toBe(75)
  expect(nextZoom(150, 'in')).toBe(200)
  expect(nextZoom(200, 'in')).toBe(200)
  expect(nextZoom(50, 'out')).toBe(25)
  expect(nextZoom(25, 'out')).toBe(25)
})

test('stepping from a fit value snaps to the nearest step in that direction', () => {
  expect(nextZoom(53, 'in')).toBe(75)
  expect(nextZoom(53, 'out')).toBe(50)
  expect(nextZoom(94, 'in')).toBe(100)
  expect(nextZoom(94, 'out')).toBe(75)
})

test('fit is the largest whole percent that leaves a gutter each side, capped at 100', () => {
  expect(fitZoom(392)).toBe(53) // 1024 wide with the rail and inspector open
  expect(fitZoom(648 + 48)).toBe(100)
  expect(fitZoom(968)).toBe(100) // 1600 wide: capped
  expect(fitZoom(808)).toBe(100)
  expect(fitZoom(400, 320)).toBe(100) // Mobile portrait always fits
  expect(fitZoom(0)).toBe(ZOOM_MIN)
})

test('a frame wider than the canvas at 100% that fits once scaled is put back in the middle', () => {
  // the spike's case: 648 in 392 at 53% sat 92px in on the left and 44px over on the right
  expect(panForZoom(648, 392, 53)).toBeCloseTo(-67.84, 1)
  expect(panForZoom(648, 392, 50)).toBeCloseTo(-64, 1)
})

test('a frame that already fits is left where GrapesJS centred it', () => {
  expect(panForZoom(648, 808, 100)).toBe(0)
  expect(panForZoom(648, 808, 50)).toBe(0)
  expect(panForZoom(320, 392, 100)).toBe(0)
  expect(panForZoom(648, 648, 75)).toBe(0)
})

test('a frame wider than the canvas once scaled is pinned to the left edge, so nothing is lost off the left', () => {
  // 648 in 656 at 150%: GrapesJS leaves it 158px past the left edge on both sides
  expect(panForZoom(648, 656, 150)).toBeCloseTo(158, 0)
  expect(panForZoom(648, 392, 100)).toBe(0) // pinned already
  expect(panForZoom(320, 392, 150)).toBeCloseTo(44, 0)
})

test('the label says Fit in fit mode and just the number otherwise', () => {
  expect(formatZoom(78, 'fit')).toBe('Fit · 78%')
  expect(formatZoom(100, 'manual')).toBe('100%')
})

test('the compact label is the percentage alone, whichever mode is on', () => {
  expect(formatZoom(53, 'fit', true)).toBe('53%')
  expect(formatZoom(100, 'manual', true)).toBe('100%')
})

test('the wheel zooms only with Ctrl or Cmd held, up for in and down for out', () => {
  expect(wheelZoomDirection({ ctrlKey: false, metaKey: false, deltaY: -50 })).toBeNull()
  expect(wheelZoomDirection({ ctrlKey: true, metaKey: false, deltaY: -50 })).toBe('in')
  expect(wheelZoomDirection({ ctrlKey: false, metaKey: true, deltaY: 50 })).toBe('out')
  expect(wheelZoomDirection({ ctrlKey: true, metaKey: false, deltaY: 0 })).toBeNull()
})

test('a stream of wheel events steps once per gap, not once per event', () => {
  expect(WHEEL_STEP_GAP_MS).toBe(200)
  expect(wheelStepDue(-Infinity, 0)).toBe(true) // never stepped before
  expect(wheelStepDue(1000, 1050)).toBe(false)
  expect(wheelStepDue(1000, 1199)).toBe(false)
  expect(wheelStepDue(1000, 1200)).toBe(true)
})

test('the toolbar offers Desktop, Tablet and Mobile, with emails 600, 481 and 360 wide', () => {
  expect(DEVICES.map((device) => [device.id, device.label, device.content])).toEqual([
    ['Desktop', 'Desktop', 600],
    ['Tablet', 'Tablet', 481],
    ['Mobile portrait', 'Mobile', 360],
  ])
})

test('only Desktop gets a gutter: the frame is the email itself where MJML would reflow to it', () => {
  expect(FIT_GUTTER).toBe(24)
  expect(frameWidthFor(DEVICES[0])).toBe(648)
  expect(frameWidthFor(DEVICES[1])).toBe(481)
  expect(frameWidthFor(DEVICES[2])).toBe(360)
  expect(DESKTOP_FRAME_WIDTH).toBe(648)
})

test('Tablet stays one pixel clear of the stacking width, and Mobile is well below it', () => {
  expect(MJML_STACK_WIDTH).toBe(480)
  expect(DEVICES[1].content).toBeGreaterThan(MJML_STACK_WIDTH)
  expect(DEVICES[2].content).toBeLessThan(MJML_STACK_WIDTH)
})
