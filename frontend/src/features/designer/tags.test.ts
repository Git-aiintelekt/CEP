import { expect, test } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { DEFAULT_PROFILE, fillForPreview } from './preview/previewProfiles'
import { extractTags, groupTags, unknownTags } from './tags'

const tag = (tag_key: string, tag_kind: string, sample_value: string | null, channels = ['EMAIL'], extra: Partial<PersonalizationTag> = {}): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind, data_type: 'STRING', applies_to_channels: channels, description: null, sample_value,
  default_value: null, static_value: null, is_active: true, ...extra,
})

const catalogue = [
  tag('first_name', 'STANDARD', 'Jordan'),
  tag('offer_code', 'CUSTOM', 'FALL<17>&"x"'),
  tag('unsubscribe_url', 'SYSTEM', null, ['EMAIL'], { default_value: 'https://example.com/u' }),
  tag('sms_keyword', 'SYSTEM', 'STOP', ['SMS']),
  tag('retired', 'STANDARD', 'x', ['EMAIL'], { is_active: false }),
]

test('extractTags: order of first appearance, de-duplicated, tolerant of inner spaces, across several texts', () => {
  expect(extractTags('Hi {{ first_name }}', null, '<a href="{{shop_url}}">{{first_name}}</a> {{custom.discount_pct}}')).toEqual(['first_name', 'shop_url', 'custom.discount_pct'])
  expect(extractTags('no tags, { single } braces, {{}} and {{ 9bad }}')).toEqual([])
})

test('unknownTags keeps only keys missing from the catalogue', () => {
  expect(unknownTags(['first_name', 'mystery', 'offer_code'], catalogue)).toEqual(['mystery'])
})

test('sample values fill from the catalogue, escaped for HTML, and unknown tags stay visible (the rule the gallery uses)', () => {
  const html = fillForPreview('<p>Hi {{first_name}}, code {{offer_code}} {{mystery}}</p><a href="{{unsubscribe_url}}">x</a>', catalogue, DEFAULT_PROFILE)
  expect(html).toBe('<p>Hi Jordan, code FALL&lt;17&gt;&amp;&quot;x&quot; {{mystery}}</p><a href="https://example.com/u">x</a>')
})

test('groupTags: active tags for the channel only, grouped in a stable order with readable labels', () => {
  const groups = groupTags(catalogue, 'EMAIL')
  expect(groups.map((group) => [group.label, group.tags.map((item) => item.tag_key)])).toEqual([
    ['Customer', ['first_name']],
    ['Campaign list', ['offer_code']],
    ['System', ['unsubscribe_url']],
  ])
  expect(groupTags(catalogue, 'SMS').flatMap((group) => group.tags.map((item) => item.tag_key))).toEqual(['sms_keyword'])
})
