// Dormant presets are written ahead of their tags. They are tested now, so they are known-good the day one is wired in.
import mjml2html from 'mjml-browser'
import { describe, expect, test } from 'vitest'

import { expandSelfClosing } from '@/apps/cep/features/designer/mjml'
import { renderWithSamples, smsMetrics } from '@/apps/cep/features/messaging/sms'
import { presetTags } from '@/test/mockApi'

import { mergePresets, offerable } from '../../presetSource'
import { BONUS_PRESETS, LAUNCH_PRESETS, PRESET_DEFINITIONS, RECEIPT_PRESETS } from '..'
import { DORMANT_PRESETS, WAITING_ON } from '.'

const ALLOWED = new Set(['mjml', 'mj-body', 'mj-section', 'mj-column', 'mj-group', 'mj-text', 'mj-button', 'mj-divider', 'mj-spacer'])
const tagsOf = (text: string) => [...new Set(Array.from(text.matchAll(/\{\{\s*([\w.]+)/g), (match) => match[1]))]
const textOf = (item: (typeof DORMANT_PRESETS)[number]) =>
  item.content.kind === 'message' ? `${item.content.subject_line} ${item.content.sms_body}` : `${item.content.subject_line} ${item.content.preheader} ${item.content.mjml}`

/** The workspace's tags today, plus the three the dormant presets wait on, with realistic (long) samples. */
const WITH_NEW_TAGS = [...presetTags, ...([['birthday', 'October 12'], ['review_url', 'https://shop.example.com/review/48219'], ['event_date', 'Saturday, October 18']] as const)
  .map(([key, sample]) => ({ ...presetTags[0], id: key, tag_key: key, label: key, sample_value: sample }))]

test('the six dormant presets exist, and none of them is offered: not in PRESET_DEFINITIONS or any list it is built from', () => {
  expect(DORMANT_PRESETS.map((item) => item.name)).toEqual([
    'Birthday gift', 'SMS birthday gift', 'MMS birthday card', 'Thank you + review request', 'Rate your purchase', 'In-store event reminder',
  ])
  const offeredKeys = new Set([...PRESET_DEFINITIONS, ...LAUNCH_PRESETS, ...BONUS_PRESETS, ...RECEIPT_PRESETS].map((item) => item.key))
  const offeredNames = new Set(PRESET_DEFINITIONS.map((item) => item.name))
  for (const item of DORMANT_PRESETS) {
    expect(offeredKeys.has(item.key), `${item.key} is wired in`).toBe(false)
    expect(offeredNames.has(item.name), `${item.name} is wired in`).toBe(false)
    expect(PRESET_DEFINITIONS).not.toContain(item)
  }
})

test('each waits on one tag the workspace does not have yet, uses it by its final name, and would be hidden until it exists', () => {
  const today = new Set(presetTags.map((tag) => tag.tag_key))
  const presets = mergePresets([], DORMANT_PRESETS)
  for (const preset of presets) {
    const waiting = WAITING_ON[preset.key]
    expect(waiting, preset.key).toBeDefined()
    expect(today.has(waiting), `${waiting} already exists`).toBe(false)
    expect(preset.requiredTags, preset.key).toContain(waiting)
    // hidden today; offered as soon as its tag exists
    expect(offerable(preset, today), preset.key).toBe(false)
    expect(offerable(preset, new Set(WITH_NEW_TAGS.map((tag) => tag.tag_key))), preset.key).toBe(true)
  }
})

test('every dormant preset has everything a preset needs', () => {
  expect(new Set(DORMANT_PRESETS.map((item) => item.key)).size).toBe(DORMANT_PRESETS.length)
  for (const item of DORMANT_PRESETS) {
    for (const field of [item.key, item.name, item.category, item.description]) expect(field.trim(), item.key).not.toBe('')
    expect(item.content.kind, item.key).toBe(item.channel === 'EMAIL' ? 'design' : 'message')
    // besides the tag it waits on, only tags every workspace has
    expect(tagsOf(textOf(item)).filter((tag) => tag !== WAITING_ON[item.key] && !['first_name', 'discount_pct', 'offer_code', 'shop_url', 'unsubscribe_url'].includes(tag)), item.key).toEqual([])
  }
  expect(DORMANT_PRESETS.filter((item) => item.name.includes('irthday')).every((item) => item.category === 'Loyalty')).toBe(true)
})

describe.each(DORMANT_PRESETS.filter((item) => item.content.kind === 'design'))('$key email', (item) => {
  const content = item.content.kind === 'design' ? item.content : null
  test('compiles with no MJML errors, round-trippable components only, one button, the marketing footer', () => {
    if (!content) throw new Error('not an email')
    expect(mjml2html(content.mjml, { validationLevel: 'soft' }).errors).toEqual([])
    const doc = new DOMParser().parseFromString(expandSelfClosing(content.mjml), 'text/html')
    const used = new Set([...doc.querySelectorAll('*')].map((node) => node.tagName.toLowerCase()).filter((tag) => tag.startsWith('mj')))
    expect([...used].filter((tag) => !ALLOWED.has(tag))).toEqual([])
    expect(content.mjml.match(/<mj-button/g)).toHaveLength(1)
    expect(content.mjml).toMatch(/<mj-section css-class="cep-footer"[\s\S]*href="\{\{unsubscribe_url\}\}"/)
  })
})

test('the review request has one link besides unsubscribe, and it is the review page', () => {
  const review = DORMANT_PRESETS.find((item) => item.key === 'review_request')
  if (review?.content.kind !== 'design') throw new Error('no review email')
  const links = Array.from(review.content.mjml.matchAll(/href="([^"]+)"/g), (match) => match[1]).filter((href) => href !== '{{unsubscribe_url}}')
  expect(links).toEqual(['{{review_url}}'])
})

describe.each(DORMANT_PRESETS.filter((item) => item.content.kind === 'message'))('$key message', (item) => {
  const content = item.content.kind === 'message' ? item.content : null
  test('starts with the sender, ends with the opt-out, and is one GSM-7 segment with long sample values', () => {
    if (!content) throw new Error('not a message')
    expect(content.sms_body.startsWith('Your Brand: ')).toBe(true)
    expect(content.sms_body.endsWith('Reply STOP to opt out.')).toBe(true)
    const metrics = smsMetrics(renderWithSamples(content.sms_body, WITH_NEW_TAGS))
    expect(metrics.encoding).toBe('GSM-7')
    expect(metrics.segments).toBe(1)
  })
  test('an MMS ships without a picture and says to add one', () => {
    if (item.channel !== 'MMS' || !content) return
    expect(item.description).toContain('Add your picture before activating')
    expect(content.subject_line).not.toBe('')
  })
})
