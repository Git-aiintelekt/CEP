import { expect, test } from 'vitest'

import { COMPACT_TIER, FOLDED, ROW_PADDING, TIERS, chooseTier } from './overflow'

/**
 * What the three tiers really come to in the browser, through the toolbar's own probe. The smallest tier is
 * given at its widest: 386 with a four-character label like "100%", 377 with a two-digit one like "53%".
 */
const MEASURED = [598, 518, 386]
/** the width at which the smallest tier fits with its 8px sides untouched */
const COMPACT_ROOMY_FROM = 386 + 8 * 2

test('the tiers keep undo, redo, zoom and the devices inline every time, and fold from the end', () => {
  for (const tier of TIERS) expect(tier.slice(0, 11)).toEqual(['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|'])
  expect(TIERS[0].at(-1)).toBe('download')
  expect(TIERS[1].slice(-3)).toEqual(['outlines', 'preview', 'more'])
  expect(TIERS[2].slice(-1)).toEqual(['more'])
  expect(FOLDED[1]).toEqual(['fullscreen', 'code', 'download'])
  expect(FOLDED[2]).toEqual(['outlines', 'preview', 'fullscreen', 'code', 'download'])
})

test('only the smallest tier tightens its padding, which is where the compact gaps and label live too', () => {
  expect(COMPACT_TIER).toBe(TIERS.length - 1)
  expect(ROW_PADDING).toEqual([12, 12, 8])
})

test('the first tier that fits wins, each judged against its own padding', () => {
  expect(chooseTier(MEASURED[0] + 24, MEASURED)).toBe(0)
  expect(chooseTier(MEASURED[0] + 24 - 1, MEASURED)).toBe(1)
  expect(chooseTier(MEASURED[1] + 24, MEASURED)).toBe(1)
  expect(chooseTier(MEASURED[1] + 24 - 1, MEASURED)).toBe(2)
  // the smallest tier is judged against 8px sides, not 12
  expect(chooseTier(MEASURED[2] + 16, MEASURED)).toBe(2)
})

test('the four real canvas widths land on the tiers the design calls for', () => {
  expect(chooseTier(392, MEASURED)).toBe(2)
  expect(chooseTier(648, MEASURED)).toBe(0)
  expect(chooseTier(968, MEASURED)).toBe(0)
  expect(chooseTier(1200, MEASURED)).toBe(0)
})

test('from 402 the smallest tier fits with its sides untouched', () => {
  expect(COMPACT_ROOMY_FROM).toBe(402)
  expect(chooseTier(COMPACT_ROOMY_FROM, MEASURED)).toBe(2)
  expect(MEASURED[2]).toBeLessThanOrEqual(COMPACT_ROOMY_FROM - ROW_PADDING[2] * 2)
})

/**
 * The default 392px canvas takes the smallest tier as the floor: 386 needs a little of the row's 8px sides,
 * which a centred group may use — it stays within the row, so nothing is clipped. Undo, redo, zoom and the
 * devices are never folded, so there is nothing further for this function to give.
 */
test('the 392px canvas takes the smallest tier, which sits inside the row', () => {
  expect(chooseTier(392, MEASURED)).toBe(COMPACT_TIER)
  expect(MEASURED[2]).toBeLessThanOrEqual(392)
  expect(MEASURED[2]).toBeGreaterThan(392 - ROW_PADDING[2] * 2)
})

test('368 — narrower than any real canvas — still folds no further', () => {
  expect(chooseTier(368, MEASURED)).toBe(COMPACT_TIER)
})

test('the smallest tier is the floor: a row too narrow even for that still gets it', () => {
  expect(chooseTier(200, MEASURED)).toBe(COMPACT_TIER)
})

test('nothing measured yet folds nothing, so the first paint never flickers into a menu', () => {
  expect(chooseTier(0, MEASURED)).toBe(0)
  expect(chooseTier(392, [])).toBe(0)
})
