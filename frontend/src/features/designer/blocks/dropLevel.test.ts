import { expect, test } from 'vitest'

import { dropLevel } from './dropLevel'
import { CEP_BLOCKS } from './registry'

const COLUMN_LEVEL = ['spacer', 'divider', 'heading', 'text', 'image', 'button']

test('a block that brings its own section is section level', () => {
  const sections = CEP_BLOCKS.filter((block) => dropLevel(block) === 'section').map((block) => block.id)
  expect(sections).toEqual(CEP_BLOCKS.map((block) => block.id).filter((id) => !COLUMN_LEVEL.includes(id)))
})

test('the six column-level blocks need somebody else’s column', () => {
  expect(CEP_BLOCKS.filter((block) => dropLevel(block) === 'column').map((block) => block.id)).toEqual(COLUMN_LEVEL)
})

test('the level comes from the first tag, not from anything nested inside', () => {
  expect(dropLevel({ id: 'x', label: 'x', category: 'content', icon: 'Square', mjml: '<mj-section><mj-column></mj-column></mj-section>' })).toBe('section')
  expect(dropLevel({ id: 'x', label: 'x', category: 'content', icon: 'Square', mjml: '<mj-button>Go</mj-button>' })).toBe('column')
  // only the FIRST tag decides: a section appearing later must not promote a column-level block
  expect(dropLevel({ id: 'x', label: 'x', category: 'content', icon: 'Square', mjml: '<mj-text>x</mj-text><mj-section><mj-column></mj-column></mj-section>' })).toBe('column')
  expect(dropLevel({ id: 'x', label: 'x', category: 'content', icon: 'Square', mjml: '<mj-text>see the mj-section above</mj-text>' })).toBe('column')
  // a look-alike tag is not mj-section
  expect(dropLevel({ id: 'x', label: 'x', category: 'content', icon: 'Square', mjml: '<mj-section-header>x</mj-section-header>' })).toBe('column')
})
