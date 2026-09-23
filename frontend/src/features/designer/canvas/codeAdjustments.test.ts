import { expect, test } from 'vitest'

import { HIDE_MOBILE_RULE } from '../blocks/register'
import { adjustedNote, describeAdjustments, unclosedTags } from './codeAdjustments'

const body = (inner: string, head = '') => `<mjml>${head}<mj-body>${inner}</mj-body></mjml>`
const SECTION = '<mj-section><mj-column><mj-text>Hi</mj-text></mj-column></mj-section>'
const FOOTER = '<mj-section css-class="cep-footer"><mj-column><mj-text>Unsubscribe</mj-text></mj-column></mj-section>'

test('code the editor keeps as it was has nothing to report', () => {
  expect(describeAdjustments(body(SECTION + FOOTER), body(SECTION + FOOTER))).toEqual([])
})

test('a tag left open is found, however deep', () => {
  expect(unclosedTags('<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-column></mj-section></mj-body></mjml>')).toEqual([{ name: 'mj-text', swallowed: [] }])
  expect(unclosedTags(body(SECTION))).toEqual([])
  // self-closing and commented-out tags are not left open
  expect(unclosedTags(body('<mj-section><mj-column><mj-divider /><!-- <mj-text> --></mj-column></mj-section>'))).toEqual([])
})

test('an unclosed tag the editor closed is named', () => {
  const typed = '<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-column></mj-section></mj-body></mjml>'
  expect(describeAdjustments(typed, body(SECTION))).toEqual(['closed <mj-text>, which was left open'])
})

test('a block the repair moved inside a text is named, never passed over', () => {
  // the parser closes the text only at its column's end, so the button that followed ends up inside it
  const typed = body('<mj-section><mj-column><mj-text>Hi<mj-button href="#">Go</mj-button></mj-column></mj-section>')
  const applied = body('<mj-section><mj-column><mj-text>Hi<mj-button href="#">Go</mj-button></mj-text></mj-column></mj-section>')
  expect(unclosedTags(typed)).toEqual([{ name: 'mj-text', swallowed: ['mj-button'] }])
  expect(describeAdjustments(typed, applied)).toEqual(['closed <mj-text>, which was left open, so the <mj-button> after it is now inside it'])
})

test('a container left open is named without claiming its own children moved', () => {
  const typed = body('<mj-section><mj-column><mj-text>Hi</mj-text></mj-column>')
  expect(unclosedTags(typed)).toEqual([{ name: 'mj-section', swallowed: [] }])
})

test('a second footer the editor took out again is named', () => {
  expect(describeAdjustments(body(SECTION + FOOTER + FOOTER), body(SECTION + FOOTER))).toEqual(['removed a second footer: an email has only one'])
})

test('the hide-on-phones rule the editor added is named', () => {
  const typed = body('<mj-section css-class="cep-hide-mobile"><mj-column><mj-text>Hi</mj-text></mj-column></mj-section>')
  const applied = typed.replace('<mj-body>', `<mj-head><mj-style>${HIDE_MOBILE_RULE}</mj-style></mj-head><mj-body>`)
  expect(describeAdjustments(typed, applied)).toEqual(['added the hide-on-phones rule to mj-head'])
})

test('any other change to the blocks is still reported, never passed over', () => {
  expect(describeAdjustments(body(SECTION + SECTION), body(SECTION))).toEqual(['changed the structure of the blocks'])
})

test('the note reads as one sentence', () => {
  expect(adjustedNote(['closed <mj-text>, which was left open', 'removed a second footer: an email has only one']))
    .toBe('The editor adjusted the code: closed <mj-text>, which was left open; removed a second footer: an email has only one.')
})
