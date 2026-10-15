/** A group's columns keep their share on the phone canvas: painted on the frame, never on the model. */
import { expect, test } from 'vitest'

import { GROUP_WIDTH_PROPERTY, paintGroupColumns, shares } from './groupPreview'

test('shares: equal without widths, a set width kept and the rest split, three ways, nothing left', () => {
  expect(shares([null, null])).toEqual(['50%', '50%'])
  expect(shares(['30%', null])).toEqual(['30%', '70%'])
  expect(shares([null, null, null])).toEqual(['33.3333%', '33.3333%', '33.3333%'])
  expect(shares(['60%', '40%'])).toEqual(['60%', '40%'])
  expect(shares(['100px', null])).toEqual(['50%', '50%'])                       // a pixel width is not a share: split evenly
  expect(shares(['70%', '50%', null])).toEqual(['70%', '50%', '0%'])           // over-committed: the open one gets nothing, never a negative
})

test('every column in a group is painted with its share; a plain section’s columns and a nested group’s are left to themselves', () => {
  const frame = document.implementation.createHTMLDocument('frame')
  frame.body.innerHTML = `
    <div data-gjs-type="mj-section"><div data-gjs-type="mj-group" id="g1">
      <div data-gjs-type="mj-column" id="a"></div><div data-gjs-type="mj-column" id="b" width="25%"></div><div data-gjs-type="mj-column" id="c"></div>
    </div></div>
    <div data-gjs-type="mj-section"><div data-gjs-type="mj-column" id="plain"></div></div>`
  paintGroupColumns(frame)
  const share = (id: string) => (frame.getElementById(id) as HTMLElement).style.getPropertyValue(GROUP_WIDTH_PROPERTY)
  expect([share('a'), share('b'), share('c')]).toEqual(['37.5%', '25%', '37.5%'])
  expect(share('plain')).toBe('')
  expect(() => paintGroupColumns(null)).not.toThrow()
})
