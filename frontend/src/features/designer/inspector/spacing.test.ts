import { expect, test } from 'vitest'

import { shorthand, spacingFrom, spacingToStore, sumSpacing } from './spacing'

const sides = (top: string, right: string, bottom: string, left: string) => ({ top, right, bottom, left })

test('margin and padding add up side by side, in px or in %, and an empty side counts as nothing', () => {
  expect(sumSpacing(sides('10', '0', '10', '0'), sides('10', '25', '10', '25'))).toEqual(sides('20', '25', '20', '25'))
  expect(sumSpacing(sides('5%', '', '', ''), sides('10%', '', '', ''))).toEqual(sides('15%', '0', '0', '0'))
  expect(sumSpacing(null, sides('1.5', '2', '3', '4'))).toEqual(sides('1.5', '2', '3', '4'))
  expect(sumSpacing(sides('0.1', '0', '0', '0'), sides('0.2', '0', '0', '0'))).toEqual(sides('0.3', '0', '0', '0'))
})

test('a side that mixes px and % cannot be added up', () => {
  expect(sumSpacing(sides('5%', '0', '0', '0'), sides('10', '0', '0', '0'))).toBe(null)
})

test('the stored form is two shorthands, and reads back as sides; rubbish reads as nothing', () => {
  const spacing = { margin: sides('10', '0', '10', '0'), padding: sides('10', '25', '10', '25') }
  expect(spacingToStore(spacing)).toEqual({ margin: '10px 0px', padding: '10px 25px' })
  expect(spacingFrom(spacingToStore(spacing))).toEqual(spacing)
  expect(spacingFrom({ margin: '10px', padding: null })).toEqual({ margin: sides('10', '10', '10', '10'), padding: null })
  expect(spacingFrom(null)).toBe(null)
  expect(spacingFrom({ margin: 'wide' })).toBe(null)
  expect(shorthand(null)).toBe(null)
})
