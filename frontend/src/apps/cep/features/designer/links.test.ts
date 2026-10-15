import { expect, test } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { extractLinks, imagesWithoutAlt, placeholderImages } from './links'
import { STARTER_MJML } from './starter'

const tag = (tag_key: string): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'],
  description: null, sample_value: 'x', default_value: null, static_value: null, is_active: true,
})

const catalogue = [tag('shop_url'), tag('first_name')]
const links = (mjml: string) => extractLinks(mjml, catalogue)
const one = (mjml: string) => {
  const found = links(mjml)
  expect(found).toHaveLength(1)
  return found[0]
}

test('a button link is found with its text as the label', () => {
  const link = one('<mj-button href="https://shop.example.com/fall">Shop now</mj-button>')
  expect(link.url).toBe('https://shop.example.com/fall')
  expect(link.label).toBe('Shop now')
  expect(link.kind).toBe('tracked')
  expect(link.flags).toEqual([])
})

test('an image link uses its alt text, and an image without an href is not a link', () => {
  expect(one('<mj-image href="https://a.example.com" alt="Autumn lookbook" src="x.png" />').label).toBe('Autumn lookbook')
  expect(one('<mj-image href="https://a.example.com" src="x.png" />').label).toBe('Image Link')
  expect(links('<mj-image src="x.png" alt="just a picture" />')).toEqual([])
})

test('anchors inside text and social elements are found', () => {
  const found = links('<mj-text>Read the <a href="https://a.example.com/guide">full guide</a> today</mj-text><mj-social-element href="https://x.example.com">X</mj-social-element>')
  expect(found.map((link) => [link.url, link.label])).toEqual([
    ['https://a.example.com/guide', 'full guide'],
    ['https://x.example.com', 'X'],
  ])
})

test('an anchor with no text falls back to "Link"', () => {
  expect(one('<mj-text><a href="https://a.example.com"><span></span></a></mj-text>').label).toBe('Link')
})

test('a label longer than 40 characters is truncated with an ellipsis', () => {
  const link = one(`<mj-button href="https://a.example.com">${'x'.repeat(80)}</mj-button>`)
  expect(link.label).toHaveLength(40)
  expect(link.label.endsWith('…')).toBe(true)
})

test('http:// is flagged as insecure but https:// is not', () => {
  expect(one('<mj-button href="http://x.example.com">Go</mj-button>').flags).toEqual(['insecure'])
  expect(one('<mj-button href="https://x.example.com">Go</mj-button>').flags).toEqual([])
})

test('a button with a missing or blank href is flagged empty', () => {
  expect(one('<mj-button>Shop now</mj-button>').flags).toEqual(['empty'])
  expect(one('<mj-button href="   ">Shop now</mj-button>').flags).toEqual(['empty'])
  expect(one('<mj-button>Shop now</mj-button>').url).toBe('')
})

test('a social element with an empty href is flagged empty, a filled one is not', () => {
  expect(one('<mj-social-element name="facebook" href=""></mj-social-element>').flags).toEqual(['empty'])
  expect(one('<mj-social-element name="facebook"></mj-social-element>').flags).toEqual(['empty'])
  expect(one('<mj-social-element name="facebook" href="https://facebook.example.com"></mj-social-element>').flags).toEqual([])
})

test('empty social elements stay separate rows, named after their network', () => {
  const found = links('<mj-social><mj-social-element name="facebook" href=""></mj-social-element><mj-social-element name="instagram" href=""></mj-social-element><mj-social-element name="linkedin" href=""></mj-social-element></mj-social>')
  expect(found.map((link) => link.label)).toEqual(['facebook', 'instagram', 'linkedin'])
  expect(found.every((link) => link.flags.includes('empty'))).toBe(true)
})

test('an empty anchor or image is still not a link', () => {
  expect(links('<mj-text><a href="">nowhere</a></mj-text>')).toEqual([])
  expect(links('<mj-image src="x.png" alt="just a picture" />')).toEqual([])
})

test('an unknown tag in the URL is flagged, a known one is not', () => {
  expect(one('<mj-button href="{{shop_url}}">Go</mj-button>').flags).toEqual([])
  expect(one('<mj-button href="{{shpo_url}}">Go</mj-button>').flags).toEqual(['unknown-tag'])
  expect(one('<mj-button href="https://a.example.com/{{mystery}}">Go</mj-button>').flags).toEqual(['unknown-tag'])
})

test('the unsubscribe tag is always valid and never flagged', () => {
  const link = one('<mj-text><a href="{{unsubscribe_url}}">Unsubscribe</a></mj-text>')
  expect(link.flags).toEqual([])
  expect(link.kind).toBe('advisory')
})

test('mailto, tel, sms and anchors are advisory, web links are tracked', () => {
  expect(one('<mj-text><a href="mailto:help@example.com">Email us</a></mj-text>').kind).toBe('advisory')
  expect(one('<mj-text><a href="tel:+15551234">Call</a></mj-text>').kind).toBe('advisory')
  expect(one('<mj-text><a href="sms:+15551234">Text</a></mj-text>').kind).toBe('advisory')
  expect(one('<mj-text><a href="#top">Back to top</a></mj-text>').kind).toBe('advisory')
  expect(one('<mj-text><a href="https://a.example.com/unsubscribe">Opt out</a></mj-text>').kind).toBe('advisory')
  expect(one('<mj-button href="{{shop_url}}">Shop</mj-button>').kind).toBe('tracked')
})

test('MAILTO in any case is still advisory', () => {
  expect(one('<mj-text><a href="MailTo:Help@Example.com">Email</a></mj-text>').kind).toBe('advisory')
})

test('an exact repeat of the same url and label appears once, different labels do not merge', () => {
  const same = links('<mj-button href="https://a.example.com">Shop</mj-button><mj-button href="https://a.example.com">Shop</mj-button>')
  expect(same).toHaveLength(1)

  const different = links('<mj-button href="https://a.example.com">Shop</mj-button><mj-button href="https://a.example.com">Browse</mj-button>')
  expect(different).toHaveLength(2)
})

test('ids are stable across repeated calls on the same markup', () => {
  const mjml = '<mj-button href="https://a.example.com">Shop</mj-button><mj-text><a href="mailto:x@example.com">Mail</a></mj-text>'
  expect(links(mjml).map((link) => link.id)).toEqual(links(mjml).map((link) => link.id))
  expect(new Set(links(mjml).map((link) => link.id)).size).toBe(2)
})

test('malformed markup never throws and returns what it can find', () => {
  expect(() => links('<mj-button href="https://a.example.com">Unclosed')).not.toThrow()
  expect(links('<mj-button href="https://a.example.com">Unclosed').map((link) => link.url)).toEqual(['https://a.example.com'])
  expect(links('<<<>>> not markup at all')).toEqual([])
  expect(links('')).toEqual([])
})

test('a self-closing image before a button still finds both links', () => {
  // without expanding self-closing tags the HTML parser nests the button inside the image
  const found = links('<mj-image href="https://img.example.com" alt="Banner" src="b.png" /><mj-button href="https://shop.example.com">Shop</mj-button>')
  expect(found.map((link) => link.url)).toEqual(['https://img.example.com', 'https://shop.example.com'])
})

test('several flags can apply to one link', () => {
  expect(one('<mj-button href="http://a.example.com/{{mystery}}">Go</mj-button>').flags).toEqual(['insecure', 'unknown-tag'])
})

test('each link says what kind of element it came from', () => {
  expect(one('<mj-button href="https://a.example.com">Go</mj-button>').element).toBe('button')
  expect(one('<mj-social-element name="facebook" href="https://a.example.com"></mj-social-element>').element).toBe('social')
  expect(one('<mj-text><a href="https://a.example.com">Go</a></mj-text>').element).toBe('link')
  expect(one('<mj-image href="https://a.example.com" alt="Lookbook" src="x.png" />').element).toBe('link')
})

// ---- images without alt text --------------------------------------------

test('an image with no alt, or a blank one, is reported once each', () => {
  expect(imagesWithoutAlt('<mj-image src="https://x.example.com/hero.png" />')).toEqual([{ id: 'image-no-alt:0', label: 'hero.png', nth: 0 }])
  expect(imagesWithoutAlt('<mj-image src="hero.png" alt="   " />')).toEqual([{ id: 'image-no-alt:0', label: 'hero.png', nth: 0 }])
})

test('a described image is not reported', () => {
  expect(imagesWithoutAlt('<mj-image src="hero.png" alt="Autumn lookbook" />')).toEqual([])
})

test('every undescribed image gets its own entry, named after its file', () => {
  const found = imagesWithoutAlt('<mj-image src="a/one.png" /><mj-image src="two.png" alt="fine" /><mj-image src="b/three.png" alt="" />')
  // the id counts every image, not every warning, so describing one does not renumber the rest
  expect(found).toEqual([
    { id: 'image-no-alt:0', label: 'one.png', nth: 0 },
    { id: 'image-no-alt:2', label: 'three.png', nth: 2 },
  ])
})

test('a source with no file name reads as a plain image', () => {
  expect(imagesWithoutAlt('<mj-image />')).toEqual([{ id: 'image-no-alt:0', label: 'Image', nth: 0 }])
  expect(imagesWithoutAlt('<mj-image src="https://placehold.co/600x300" />')).toEqual([{ id: 'image-no-alt:0', label: 'Image', nth: 0 }])
  expect(imagesWithoutAlt('<mj-image src="https://x.example.com/hero.png?v=2" />')).toEqual([{ id: 'image-no-alt:0', label: 'hero.png', nth: 0 }])
})

test('the starter template opens with a protected footer and exactly one unsubscribe link', () => {
  expect(STARTER_MJML).toContain('css-class="cep-footer"')
  expect(STARTER_MJML.match(/cep-footer/g)).toHaveLength(1)
  expect(STARTER_MJML.match(/\{\{unsubscribe_url\}\}/g)).toHaveLength(1)
  expect(imagesWithoutAlt(STARTER_MJML)).toEqual([])
})

test('a link row names the block it belongs to, counted among blocks of its own tag', () => {
  const links = extractLinks(
    '<mj-body><mj-image src="a.png" href="https://a.test" /><mj-button href="https://b.test">B</mj-button>' +
      '<mj-social><mj-social-element name="facebook" href="https://f.test" /></mj-social></mj-body>',
    [],
  )
  expect(links.map((link) => link.block)).toEqual([
    { tag: 'mj-image', nth: 0 },
    { tag: 'mj-button', nth: 0 },
    { tag: 'mj-social-element', nth: 0 },
  ])
})

test('an image with no link still counts, so the blocks after it are not renumbered', () => {
  const links = extractLinks('<mj-body><mj-image src="a.png" /><mj-image src="b.png" href="https://b.test" /></mj-body>', [])
  expect(links.map((link) => link.block)).toEqual([{ tag: 'mj-image', nth: 1 }])
})

test('an anchor written inside a text block belongs to no block of its own', () => {
  const links = extractLinks('<mj-body><mj-text>Read the <a href="https://a.test">notes</a></mj-text></mj-body>', [])
  expect(links.map((link) => link.block)).toEqual([null])
})

test('a stand-in host is called out, whatever the block does about alt text', () => {
  const mjml = `<mj-image src="https://placehold.co/600x300" alt="Autumn range" />
    <mj-image src="https://placehold.it/600x300" alt="" />
    <mj-image src="https://www.placeholder.com/600x300" alt="" />`
  expect(placeholderImages(mjml).map((image) => image.nth)).toEqual([0, 1, 2])
  expect(placeholderImages(mjml)[0]).toEqual({ id: 'image-placeholder:0', label: 'Image', nth: 0 })
})

test('an image with no address at all is a placeholder too', () => {
  expect(placeholderImages('<mj-image src="" alt="x" />').map((image) => image.nth)).toEqual([0])
  expect(placeholderImages('<mj-image alt="x" />').map((image) => image.nth)).toEqual([0])
})

test('a real picture from the library is not called out, and nor is another host', () => {
  expect(placeholderImages('<mj-image src="https://cdn.example.com/media/fall-hero.jpg" alt="" />')).toEqual([])
  expect(placeholderImages('<mj-image src="https://images.unsplash.com/photo-1.jpg" alt="" />')).toEqual([])
  expect(placeholderImages('<mj-image src="/media/fall-hero.jpg" alt="" />')).toEqual([])
})

test('the position counts every image, so the row selects the one it names', () => {
  const mjml = '<mj-image src="https://cdn.example.com/a.jpg" /><mj-image src="https://placehold.co/600x300" />'
  expect(placeholderImages(mjml)).toEqual([{ id: 'image-placeholder:1', label: 'Image', nth: 1 }])
})
