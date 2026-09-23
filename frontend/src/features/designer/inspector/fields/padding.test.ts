import { expect, test } from 'vitest'

import { formatPadding, parsePadding } from './padding'

test('one value is all four sides', () => {
  expect(parsePadding('10px')).toEqual({ top: '10', right: '10', bottom: '10', left: '10' })
})

test('two values are vertical then horizontal', () => {
  expect(parsePadding('10px 20px')).toEqual({ top: '10', right: '20', bottom: '10', left: '20' })
})

test('three values are top, horizontal, bottom', () => {
  expect(parsePadding('10px 20px 30px')).toEqual({ top: '10', right: '20', bottom: '30', left: '20' })
})

test('four values are top, right, bottom, left', () => {
  expect(parsePadding('10px 20px 30px 40px')).toEqual({ top: '10', right: '20', bottom: '30', left: '40' })
})

test('extra whitespace between and around the values is ignored', () => {
  expect(parsePadding('  10px   20px  ')).toEqual({ top: '10', right: '20', bottom: '10', left: '20' })
})

test('a decimal number of pixels is kept as written', () => {
  expect(parsePadding('7.5px')).toEqual({ top: '7.5', right: '7.5', bottom: '7.5', left: '7.5' })
})

test('zero is a value like any other', () => {
  expect(parsePadding('0px 12px')).toEqual({ top: '0', right: '12', bottom: '0', left: '12' })
})

test('per cent is a unit MJML takes here, and it survives the round trip', () => {
  expect(parsePadding('10%')).toEqual({ top: '10%', right: '10%', bottom: '10%', left: '10%' })
  expect(parsePadding('10px 5%')).toEqual({ top: '10', right: '5%', bottom: '10', left: '5%' })
  expect(formatPadding('10', '5%', '10', '5%')).toBe('10px 5%')
})

test('anything that is not px or per cent is not something this field can edit', () => {
  for (const value of ['10em', '1.2rem', '10', '10pt', '10px 2em', 'auto', 'inherit', '-4px']) {
    expect(parsePadding(value), value).toBe(null)
  }
})

test('nothing at all, and more than four values, are both refused', () => {
  for (const value of ['', '   ', null, undefined, '1px 2px 3px 4px 5px']) {
    expect(parsePadding(value), String(value)).toBe(null)
  }
})

test('the shorthand written back is one, two or four values, never three', () => {
  expect(formatPadding('10', '10', '10', '10')).toBe('10px')
  expect(formatPadding('10', '20', '10', '20')).toBe('10px 20px')
  expect(formatPadding('10', '20', '30', '40')).toBe('10px 20px 30px 40px')
  // the three-value form says the same thing, but reads as a typo far more often than as intent
  expect(formatPadding('10', '20', '30', '20')).toBe('10px 20px 30px 20px')
})

test('a side that is not a number gives nothing to write', () => {
  expect(formatPadding('10', '', '10', '10')).toBe(null)
  expect(formatPadding('10', 'abc', '10', '10')).toBe(null)
  expect(formatPadding('10', '2em', '10', '10')).toBe(null)
  expect(formatPadding('10', '-4', '10', '10')).toBe(null)
})

test('a side is trimmed before it is read', () => {
  expect(formatPadding(' 10 ', '10', '10', '10')).toBe('10px')
})

test('every shorthand survives a round trip', () => {
  for (const value of ['10px', '10px 20px', '10px 20px 30px', '10px 20px 30px 40px', '0px', '7.5px 2px', '5%', '10px 5%']) {
    const parsed = parsePadding(value)
    expect(parsed, value).not.toBe(null)
    const written = formatPadding(parsed!.top, parsed!.right, parsed!.bottom, parsed!.left)
    expect(parsePadding(written), value).toEqual(parsed)
  }
})
