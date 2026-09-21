import { expect, test } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { HIDE_MOBILE_RULE } from '../blocks/register'
import { MARKS_STYLE_ID, MARK_CLASS, NO_VALUE_MARKER, decoratePreview } from './decoratePreview'
import { fillForPreview, profileById } from './previewProfiles'

const tag = (tag_key: string, over: Partial<PersonalizationTag> = {}): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null,
  sample_value: null, default_value: null, static_value: null, is_active: true, ...over,
})

const CATALOGUE = [
  tag('first_name', { sample_value: 'Jordan', default_value: 'there' }),
  tag('last_name', { sample_value: 'Lee' }),
  tag('shop_url', { tag_kind: 'SYSTEM', sample_value: 'https://shop.example.com' }),
  tag('order_url', { sample_value: 'https://shop.example.com/orders/1' }),
]

/** A compiled email in miniature: a head with MJML's own media query and ours, a conditional comment, a link. */
const EMAIL = `<!doctype html><html><head><title>{{first_name}}'s offer</title>
<style>@media only screen and (min-width:480px) { .mj-column-per-100 { width:100% !important; } }</style>
<style>${HIDE_MOBILE_RULE}</style></head>
<body><!--[if mso]><table><tr><td><![endif]-->
<div class="cep-hide-mobile"><p>Hi {{first_name}} {{last_name}}, {{mystery}}</p></div>
<a href="{{shop_url}}">Shop</a> <a href="{{order_url}}">Track</a>
<img src="{{shop_url}}/hero.png" alt="For {{first_name}}">
<!--[if mso]></td></tr></table><![endif]--></body></html>`

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

test('under sample values each tag in the words is a blue sample chip', () => {
  const doc = parse(decoratePreview(EMAIL, CATALOGUE, profileById('sample')).html)
  const chips = [...doc.querySelectorAll(`.${MARK_CLASS.sample}`)].map((node) => node.textContent)
  expect(chips).toEqual(['Jordan', 'Lee'])
  expect(doc.querySelector(`.${MARK_CLASS.unknown}`)?.textContent).toBe('{{mystery}}')
})

test('for a real contact, a value is plain, a fallback is a grey chip and a blank is "(no value)"', () => {
  const full = parse(decoratePreview(EMAIL, CATALOGUE, profileById('full')).html)
  expect(full.body.textContent).toContain('Hi Aaliyah')
  expect(full.querySelector(`.${MARK_CLASS.sample}`)).toBeNull()

  const empty = parse(decoratePreview(EMAIL, CATALOGUE, profileById('empty')).html)
  expect(empty.querySelector(`.${MARK_CLASS.default}`)?.textContent).toBe('there')
  expect(empty.querySelector(`.${MARK_CLASS.blank}`)?.textContent).toBe(NO_VALUE_MARKER)
})

test('attributes take the plain value: a link, an image address and alt text never hold a mark', () => {
  const doc = parse(decoratePreview(EMAIL, CATALOGUE, profileById('full')).html)
  expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://shop.example.com')
  expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://shop.example.com/hero.png')
  expect(doc.querySelector('img')?.getAttribute('alt')).toBe('For Aaliyah')
  for (const element of doc.querySelectorAll('[href], [src], [alt]')) {
    for (const attribute of element.attributes) expect(attribute.value).not.toMatch(/cep-pv-|no value|\{\{/)
  }
})

test('a link that comes out empty for this contact is counted', () => {
  expect(decoratePreview(EMAIL, CATALOGUE, profileById('sample')).emptyLinks).toBe(0)
  const result = decoratePreview(EMAIL, CATALOGUE, profileById('full'))
  expect(result.emptyLinks).toBe(1) // order_url: no value for Aaliyah and no default
  expect(parse(result.html).querySelectorAll('a')[1].getAttribute('href')).toBe('')
})

test('the title is plain text: it takes a value, never a mark', () => {
  expect(parse(decoratePreview(EMAIL, CATALOGUE, profileById('full')).html).title).toBe("Aaliyah's offer")
})

test('the email keeps its media queries, so stacking and hide-on-phones still happen at phone width', () => {
  const html = decoratePreview(EMAIL, CATALOGUE, profileById('sample')).html
  expect(html).toContain('max-width:480px')
  expect(html).toContain('min-width:480px')
  expect(html).toContain('class="cep-hide-mobile"')
  expect(html).toContain('<!--[if mso]>')
})

test('the marks carry their own stylesheet, since the frame cannot see the app', () => {
  const doc = parse(decoratePreview(EMAIL, CATALOGUE, profileById('sample')).html)
  expect(doc.getElementById(MARKS_STYLE_ID)?.textContent).toContain(`.${MARK_CLASS.sample}`)
})

test('the input is never changed, and what is sent carries no mark at all', () => {
  const before = EMAIL
  const decorated = decoratePreview(EMAIL, CATALOGUE, profileById('empty')).html
  expect(EMAIL).toBe(before)
  expect(decorated).toMatch(/cep-pv-/)
  // the server fills the stored HTML with the same rule and none of the marks
  const sent = fillForPreview(EMAIL, CATALOGUE, profileById('empty'))
  expect(sent).not.toMatch(/cep-pv-|no value|cep-preview-marks/)
})

test('nothing compiled means nothing to decorate', () => {
  expect(decoratePreview('   ', CATALOGUE, profileById('sample'))).toEqual({ html: '', emptyLinks: 0 })
})
