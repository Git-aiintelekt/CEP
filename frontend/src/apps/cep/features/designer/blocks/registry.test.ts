// mjml-browser is what grapesjs-mjml runs behind the editor's mjml-code-to-html command, so the blocks are
// checked against the same compiler the designer uses.
import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { ASSET_IMAGE_TOKEN, COLUMN_PADDING } from './brand'
import { dropLevel } from './dropLevel'
import { BLOCK_CATEGORIES, CEP_BLOCKS, blocksByCategory, needsImage, withImage } from './registry'
import type { CepBlock } from './types'

/** Section-level blocks sit in mj-body; everything else needs a section and column around it. */
function document(block: CepBlock): string {
  const body = block.mjml.startsWith('<mj-section') ? block.mjml : `<mj-section><mj-column>${block.mjml}</mj-column></mj-section>`
  return `<mjml><mj-body>${body}</mj-body></mjml>`
}

const FORBIDDEN: [string, RegExp][] = [
  ['a script tag', /<script/i],
  ['mj-include', /mj-include/i],
  ['an inline event handler', /\son[a-z]+\s*=/i],
  ['a javascript: URL', /javascript:/i],
]

const byId = (id: string): CepBlock => {
  const found = CEP_BLOCKS.find((block) => block.id === id)
  if (!found) throw new Error(`no block ${id}`)
  return found
}

test('the set holds every block once, with a usable id, label and category', () => {
  const ids = CEP_BLOCKS.map((block) => block.id)
  expect(new Set(ids).size).toBe(ids.length)

  for (const block of CEP_BLOCKS) {
    expect(block.id, block.id).toMatch(/^[a-z0-9-]+$/)
    expect(block.label.trim(), block.id).not.toBe('')
    expect(block.icon.trim(), block.id).not.toBe('')
    expect(BLOCK_CATEGORIES.map((category) => category.id), block.id).toContain(block.category)
  }
})

test('the categories are listed structure, content, brand, commerce and cover the whole set', () => {
  expect(BLOCK_CATEGORIES.map((category) => category.id)).toEqual(['structure', 'content', 'brand', 'commerce'])
  expect(BLOCK_CATEGORIES.map((category) => category.label)).toEqual(['Structure', 'Content', 'Brand', 'Commerce'])

  const grouped = blocksByCategory()
  expect(grouped.flatMap((category) => category.blocks)).toEqual(CEP_BLOCKS)
  for (const category of grouped) expect(category.blocks.length, category.id).toBeGreaterThan(0)
})

test('the palette is ordered structure first and commerce last', () => {
  const order = BLOCK_CATEGORIES.map((category) => category.id)
  const positions = CEP_BLOCKS.map((block) => order.indexOf(block.category))
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
})

test.each(CEP_BLOCKS.map((block) => [block.id, block] as const))('%s compiles with no MJML errors', (_id, block) => {
  const result = mjml2html(document(block))
  expect(result.errors.map((error) => error.formattedMessage ?? error.message)).toEqual([])
  expect(result.html).not.toBe('')
})

test.each(CEP_BLOCKS.map((block) => [block.id, block] as const))('%s carries nothing the server refuses', (_id, block) => {
  const html = mjml2html(document(block)).html
  for (const [what, pattern] of FORBIDDEN) {
    expect(pattern.test(block.mjml), `${what} in the source`).toBe(false)
    expect(pattern.test(html), `${what} in the compiled HTML`).toBe(false)
  }
})

test('the unsubscribe link is the footer tag, and no other block carries a tag', () => {
  expect(byId('footer').mjml).toContain('{{unsubscribe_url}}')

  for (const block of CEP_BLOCKS) {
    const tags = [...block.mjml.matchAll(/{{\s*([a-z0-9_]+)\s*}}/gi)].map((match) => match[1])
    expect(tags, block.id).toEqual(block.id === 'footer' ? ['unsubscribe_url'] : [])
  }
})

test('the footer says why the email arrived', () => {
  expect(byId('footer').mjml).toMatch(/You are receiving this email because/)
})

test('the button ships without a destination so the Links pill flags it', () => {
  expect(byId('button').mjml).toContain('href=""')
  expect(byId('product-card').mjml).toContain('href=""')
})

test('the image ships without alt text so it is flagged', () => {
  expect(byId('image').mjml).toContain('alt=""')
})

test('the social element hrefs are all empty', () => {
  expect([...byId('social').mjml.matchAll(/<mj-social-element[^>]*>/g)]).toHaveLength(3)
  expect(byId('social').mjml).not.toMatch(/<mj-social-element[^>]*href="[^"]+"/)
})

test('no block points at a stand-in image host', () => {
  for (const block of CEP_BLOCKS) {
    expect(/placehold\.(co|it)|placeholder\.com/i.test(block.mjml), block.id).toBe(false)
  }
})

test('the image and product card are the blocks that need a picture, and nothing else is', () => {
  expect(CEP_BLOCKS.filter(needsImage).map((block) => block.id)).toEqual(['image', 'product-card'])
})

test('the header is text only, so it never asks the library for a logo', () => {
  expect(byId('header').mjml).not.toContain('mj-image')
  expect(byId('header').mjml).toContain('YOUR BRAND')
})

test('a real address replaces every token, leaving none behind', () => {
  const url = 'https://cdn.example.com/media/fall-hero.jpg'
  for (const block of CEP_BLOCKS.filter(needsImage)) {
    const mjml = withImage(block, url)
    expect(mjml, block.id).toContain(`src="${url}"`)
    expect(mjml, block.id).not.toContain(ASSET_IMAGE_TOKEN)
  }
})

test('a block needing no picture is handed back untouched', () => {
  const text = byId('text')
  expect(withImage(text, 'https://cdn.example.com/a.png')).toBe(text.mjml)
})

/**
 * MJML pads every column-level element with 10px 25px unless the block sets padding itself. A block that sets
 * padding to tidy its top and bottom loses the sides too, and then sits left of everything around it — flush
 * against the email in a section whose own padding has no sides.
 */
test('every column-level block is inset from the sides, whatever its section does', () => {
  const columnBlocks = CEP_BLOCKS.filter((block) => dropLevel(block) === 'column')
  expect(columnBlocks.map((block) => block.id)).toEqual(['spacer', 'divider', 'heading', 'text', 'image', 'button'])

  for (const block of columnBlocks) {
    const padding = /\spadding="([^"]*)"/.exec(block.mjml)?.[1]
    if (padding === undefined) continue // no padding attribute: MJML's own 10px 25px stands
    expect(sidesOf(padding), `${block.id} padding="${padding}"`).not.toBe('0')
  }
})

test('the image and the divider carry the same side inset as MJML gives the rest', () => {
  expect(COLUMN_PADDING).toBe('12px 25px')
  for (const id of ['image', 'divider']) expect(byId(id).mjml, id).toContain(`padding="${COLUMN_PADDING}"`)
})

test('an image lands level with the text and the button beside it', () => {
  const column = `<mj-section padding="12px 24px"><mj-column>
    <mj-text>Words</mj-text>${byId('image').mjml}${byId('divider').mjml}
  </mj-column></mj-section>`
  const html = mjml2html(`<mjml><mj-body>${column}</mj-body></mjml>`).html
  const sides = [...html.matchAll(/padding:\s*([\d.]+px)\s+([\d.]+px)/g)].map((match) => match[2])
  // the section's own 24px aside, every element inside it is inset by the same amount
  expect(new Set(sides.filter((side) => side !== '24px'))).toEqual(new Set(['25px']))
})

/** The horizontal part of a 1-, 2-, 3- or 4-value shorthand. */
function sidesOf(padding: string): string {
  const parts = padding.trim().split(/\s+/)
  const side = parts.length === 1 ? parts[0] : parts[1]
  return Number.parseFloat(side) === 0 ? '0' : side
}
