import { expect, test } from 'vitest'

import { contrastRatio, hexToHsv, hsvToHex, isHardToRead, normaliseHex } from './colorMath'

test('a hex is normalised to six lowercase digits, with or without the hash', () => {
  expect(normaliseHex('#abc')).toBe('#aabbcc')
  expect(normaliseHex('#ABC')).toBe('#aabbcc')
  expect(normaliseHex('abc')).toBe('#aabbcc')
  expect(normaliseHex('#AaBbCc')).toBe('#aabbcc')
  expect(normaliseHex('  #FFF  ')).toBe('#ffffff')
  expect(normaliseHex('000000')).toBe('#000000')
})

test('anything that is not a three or six digit hex is refused', () => {
  for (const value of ['#12345', '#1234567', '#12g456', 'rgb(1,2,3)', 'red', 'transparent', '', '#', null, undefined]) {
    expect(normaliseHex(value), String(value)).toBe(null)
  }
})

test('the primaries convert to the hues they should', () => {
  expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 100, v: 100 })
  expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 100, v: 100 })
  expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 100, v: 100 })
})

test('white, black and a mid grey have no saturation', () => {
  expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 100 })
  expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 })
  expect(hexToHsv('#808080')).toEqual({ h: 0, s: 0, v: 50 })
})

test('a colour that is not a hex has no hsv', () => {
  expect(hexToHsv('nonsense')).toBe(null)
})

test('hsv converts back to the hex it came from', () => {
  expect(hsvToHex(0, 100, 100)).toBe('#ff0000')
  expect(hsvToHex(120, 100, 100)).toBe('#00ff00')
  expect(hsvToHex(240, 100, 100)).toBe('#0000ff')
  expect(hsvToHex(0, 0, 100)).toBe('#ffffff')
  expect(hsvToHex(0, 0, 0)).toBe('#000000')
})

test('hue wraps and saturation and brightness clamp rather than producing nonsense', () => {
  expect(hsvToHex(360, 100, 100)).toBe('#ff0000')
  expect(hsvToHex(-120, 100, 100)).toBe('#0000ff')
  expect(hsvToHex(0, 200, 100)).toBe('#ff0000')
  expect(hsvToHex(0, 100, -10)).toBe('#000000')
})

/**
 * hsv is held in whole degrees and percents, which is what the picker's arrow keys step in. One percent of
 * brightness is about 2.5 of 255, so a channel can move by up to 3 across a round trip; measured over a sweep
 * of the cube the worst case is exactly 3 (#00e79c -> #00e89f). The value itself is stable to within one unit,
 * which is the property the picker actually relies on.
 */
test('a hex survives a round trip through hsv, and the hsv itself is stable to one unit', () => {
  for (const hex of ['#2753e4', '#0f172a', '#334155', '#64748b', '#7c3aed', '#16a34a', '#ca8a04', '#e2e8f0', '#00e79c']) {
    const hsv = hexToHsv(hex)
    expect(hsv, hex).not.toBe(null)
    const back = hsvToHex(hsv!.h, hsv!.s, hsv!.v)

    for (let at = 1; at < 7; at += 2) {
      const before = parseInt(hex.slice(at, at + 2), 16)
      const after = parseInt(back.slice(at, at + 2), 16)
      expect(Math.abs(before - after), `${hex} -> ${back}`).toBeLessThanOrEqual(3)
    }

    const again = hexToHsv(back)!
    expect(Math.abs(again.s - hsv!.s), `${hex} saturation`).toBeLessThanOrEqual(1)
    expect(Math.abs(again.v - hsv!.v), `${hex} brightness`).toBeLessThanOrEqual(1)
    // near grey the hue is arbitrary: #e2e8f0 is 6% saturated, where one channel step swings it by degrees
    if (hsv!.s >= 10) expect(Math.abs(again.h - hsv!.h), `${hex} hue`).toBeLessThanOrEqual(1)
  }
})

test('black on white is the highest contrast there is, and a colour against itself the lowest', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
  expect(contrastRatio('#2753e4', '#2753e4')).toBeCloseTo(1, 5)
})

test('known WCAG pairs come out at the published ratios', () => {
  // mid grey on white, a standard worked example
  expect(contrastRatio('#808080', '#ffffff')).toBeCloseTo(3.95, 2)
  expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
})

test('a colour that is not a hex has no ratio', () => {
  expect(contrastRatio('red', '#ffffff')).toBe(null)
  expect(contrastRatio('#ffffff', 'nonsense')).toBe(null)
})

test('hard to read is only what falls below the AA body ratio', () => {
  expect(isHardToRead('#767676', '#ffffff')).toBe(false) // 4.54, just over
  expect(isHardToRead('#808080', '#ffffff')).toBe(true) // 3.95, under
  expect(isHardToRead('#000000', '#ffffff')).toBe(false)
})

test('a pair we cannot measure is never called hard to read', () => {
  expect(isHardToRead('red', '#ffffff')).toBe(false)
})
