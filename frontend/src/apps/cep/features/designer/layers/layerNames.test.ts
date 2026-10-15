import { Lock } from 'lucide-react'
import { expect, test } from 'vitest'

import { CEP_BLOCKS } from '../blocks/registry'
import { GENERIC_ICON, defaultNameFor, humanise, iconFor, layerNameFor } from './layerNames'

/** The tag every block puts at the root of its MJML, which is the kind the layers tree will show. */
function rootTag(mjml: string): string {
  return /<([a-z-]+)[\s>]/.exec(mjml.trim())?.[1] ?? ''
}

test('every block in the registry resolves to a readable name and a real icon', () => {
  for (const block of CEP_BLOCKS) {
    const kind = rootTag(block.mjml)
    expect(kind, block.id).not.toBe('')

    const name = defaultNameFor(kind)
    expect(name, `${block.id} (${kind})`).toMatch(/^[A-Z]/)
    expect(name, block.id).not.toContain('mj-')
    expect(iconFor(kind), `${block.id} (${kind}) has no icon of its own`).not.toBe(GENERIC_ICON)
  }
})

test('the MJML tags get their C360 names, not humanised ones', () => {
  expect(defaultNameFor('mj-section')).toBe('Section')
  expect(defaultNameFor('mj-column')).toBe('Column')
  expect(defaultNameFor('mj-text')).toBe('Text')
  expect(defaultNameFor('mj-button')).toBe('Button')
  expect(defaultNameFor('mj-image')).toBe('Image')
  expect(defaultNameFor('mj-divider')).toBe('Divider')
  expect(defaultNameFor('mj-spacer')).toBe('Spacer')
  expect(defaultNameFor('mj-social')).toBe('Social Links')
  expect(defaultNameFor('mj-body')).toBe('Email Body')
})

test('a social icon is named after its network when it has one', () => {
  expect(defaultNameFor('mj-social-element', { name: 'facebook' })).toBe('Facebook')
  expect(defaultNameFor('mj-social-element', { name: '  ' })).toBe('Social Icon')
  expect(defaultNameFor('mj-social-element')).toBe('Social Icon')
})

test('an unknown tag still reads as words rather than markup', () => {
  expect(defaultNameFor('mj-carousel-image')).toBe('Carousel Image')
  expect(humanise('mj-')).toBe('Block')
  expect(iconFor('mj-carousel-image')).toBe(GENERIC_ICON)
})

test('a name the reader typed wins, and clearing it brings the default back', () => {
  expect(layerNameFor('mj-section', 'Masthead')).toBe('Masthead')
  expect(layerNameFor('mj-section', '   ')).toBe('Section')
  expect(layerNameFor('mj-section', undefined)).toBe('Section')
  expect(layerNameFor('mj-social-element', '', { name: 'x' })).toBe('X')
})

test('the locked receipt slot reads as a receipt slot with a lock', () => {
  expect(defaultNameFor('cep-receipt-slot')).toBe('Receipt Slot')
  expect(iconFor('cep-receipt-slot')).toBe(Lock)
})
