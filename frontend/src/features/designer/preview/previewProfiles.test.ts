import { expect, test } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { DEFAULT_PROFILE, PREVIEW_PROFILES, escapeLikeServer, fillForPreview, previewParts, profileById, resolveTag } from './previewProfiles'

const tag = (tag_key: string, over: Partial<PersonalizationTag> = {}): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null,
  sample_value: null, default_value: null, static_value: null, is_active: true, ...over,
})

const CATALOGUE = [
  tag('first_name', { sample_value: 'Jordan', default_value: 'there' }),
  tag('last_name', { sample_value: 'Lee' }),
  tag('loyalty_tier', { sample_value: 'Gold', default_value: 'BRONZE' }),
  tag('offer_code', { tag_kind: 'CUSTOM', sample_value: 'SAMPLE10' }),
  tag('nickname', { sample_value: '', default_value: 'friend' }),
  tag('middle_name', { sample_value: '' }),
  tag('shop_url', { tag_kind: 'SYSTEM', sample_value: 'https://shop.example.com' }),
  tag('brand', { static_value: 'Northwind', sample_value: 'Sample brand' }),
]

const sample = profileById('sample')
const full = profileById('full')
const empty = profileById('empty')

// ---- the three profiles --------------------------------------------------

test('there are three profiles, and the preview opens on sample values', () => {
  expect(PREVIEW_PROFILES.map((profile) => profile.label)).toEqual(['Sample values', 'Full profile', 'Empty profile'])
  expect(DEFAULT_PROFILE.id).toBe('sample')
})

test('the full profile is Aaliyah Johnson, with every field the brief names', () => {
  expect(full.values).toMatchObject({
    first_name: 'Aaliyah', last_name: 'Johnson', email_address: 'aaliyah@example.com', loyalty_tier: 'GOLD', loyalty_points: '1,250',
    offer_code: 'FALL017', discount_pct: '20',
  })
})

test('the empty profile carries only an email address', () => {
  const values = empty.values as Record<string, string>
  expect(Object.keys(values).sort()).toEqual(['email', 'email_address'])
})

// ---- the fill rule, as the server applies it -----------------------------

test('a value the contact has is used as it is', () => {
  expect(resolveTag('first_name', CATALOGUE, full)).toEqual({ key: 'first_name', kind: 'value', text: 'Aaliyah' })
})

test('under sample values, the catalogue sample is used and marked as a sample', () => {
  expect(resolveTag('first_name', CATALOGUE, sample)).toEqual({ key: 'first_name', kind: 'sample', text: 'Jordan' })
})

test('no value for the contact falls back to the tag default', () => {
  expect(resolveTag('first_name', CATALOGUE, empty)).toEqual({ key: 'first_name', kind: 'default', text: 'there' })
})

test('no value and no default is blank, which is what the email sends', () => {
  expect(resolveTag('last_name', CATALOGUE, empty)).toEqual({ key: 'last_name', kind: 'blank', text: '' })
})

test('an empty-string sample no longer blocks the fallback: the default is used, then blank', () => {
  expect(resolveTag('nickname', CATALOGUE, sample)).toEqual({ key: 'nickname', kind: 'default', text: 'friend' })
  expect(resolveTag('middle_name', CATALOGUE, sample)).toEqual({ key: 'middle_name', kind: 'blank', text: '' })
})

test('a tag outside the catalogue stays visible as itself', () => {
  expect(resolveTag('mystery', CATALOGUE, full)).toEqual({ key: 'mystery', kind: 'unknown', text: '{{mystery}}' })
})

test('a system tag is filled by the platform, so every profile reads its sample', () => {
  for (const profile of [full, empty]) expect(resolveTag('shop_url', CATALOGUE, profile)).toMatchObject({ kind: 'value', text: 'https://shop.example.com' })
  expect(resolveTag('shop_url', CATALOGUE, sample).kind).toBe('sample')
})

test('a static value is the value for everyone', () => {
  for (const profile of PREVIEW_PROFILES) expect(resolveTag('brand', CATALOGUE, profile)).toMatchObject({ kind: 'value', text: 'Northwind' })
})

test('spaces inside the braces are read the way the server reads them', () => {
  expect(fillForPreview('Hi {{ first_name }}', CATALOGUE, full)).toBe('Hi Aaliyah')
})

// ---- the text that gets sent --------------------------------------------

test('values are escaped for HTML exactly as the server escapes them', () => {
  expect(escapeLikeServer(`<b>"Tom" & 'Jerry'</b>`)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; &#x27;Jerry&#x27;&lt;/b&gt;')
  const risky = [tag('first_name', { sample_value: '<script>x</script>' })]
  expect(fillForPreview('Hi {{first_name}}', risky, sample)).toBe('Hi &lt;script&gt;x&lt;/script&gt;')
})

test('a plain-text context takes the value unescaped', () => {
  const amp = [tag('brand', { sample_value: 'Smith & Co' })]
  expect(fillForPreview('{{brand}}', amp, sample, { escape: false })).toBe('Smith & Co')
})

test('the filled text carries none of the preview marks: no chips, no "(no value)"', () => {
  const text = 'Hi {{first_name}} {{last_name}}, code {{offer_code}} {{mystery}}'
  for (const profile of PREVIEW_PROFILES) {
    const out = fillForPreview(text, CATALOGUE, profile)
    expect(out).not.toMatch(/cep-pv-|no value|<span/)
  }
  expect(fillForPreview(text, CATALOGUE, empty)).toBe('Hi there , code  {{mystery}}')
})

test('a tag inside a link address fills in place, and goes blank when the contact has nothing', () => {
  const links = [...CATALOGUE, tag('order_url')]
  expect(fillForPreview('<a href="{{shop_url}}/p?c={{offer_code}}">', links, full)).toBe('<a href="https://shop.example.com/p?c=FALL017">')
  expect(fillForPreview('<a href="{{order_url}}">', links, full)).toBe('<a href="">')
})

test('the parts keep the words around each tag in order', () => {
  expect(previewParts('A {{first_name}} B', CATALOGUE, full)).toEqual(['A ', { key: 'first_name', kind: 'value', text: 'Aaliyah' }, ' B'])
})
