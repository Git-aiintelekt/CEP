// Email presets are compiled with mjml-browser, the same compiler grapesjs-mjml runs behind the designer.
import mjml2html from 'mjml-browser'
import { describe, expect, test } from 'vitest'

import { expandSelfClosing } from '@/features/designer/mjml'
import { renderWithSamples, smsMetrics } from '@/features/messaging/sms'
import { presetTags } from '@/test/mockApi'

import { defaultSectionsFor } from '@/features/receipt/receiptPresets'
import type { ReceiptSection } from '@/lib/types'

import { presetFromDefinition } from '../presetSource'
import { BONUS_PRESETS, LAUNCH_PRESETS, PRESET_DEFINITIONS, RECEIPT_PRESETS } from '.'
import { receiptBopis, receiptOnlineOrder, receiptSavingsPoints, receiptStandard } from './receiptPresets'
import { EMAIL_FONT_STACK } from '@/features/designer/emailFonts'

/** What both renderers round-trip (see backend/apps/templates/starters.py). */
const ALLOWED = new Set(['mjml', 'mj-body', 'mj-section', 'mj-column', 'mj-group', 'mj-text', 'mj-button', 'mj-divider', 'mj-spacer'])
/** Tags the backend's own starters already use: anything else would hide the preset in most workspaces. */
const KNOWN_TAGS = new Set(['first_name', 'discount_pct', 'offer_code', 'shop_url', 'loyalty_points', 'loyalty_tier', 'unsubscribe_url'])
const tagsOf = (text: string) => Array.from(text.matchAll(/\{\{\s*([\w.]+)/g), (match) => match[1])

const emails = PRESET_DEFINITIONS.flatMap((item) => (item.content.kind === 'design' ? [{ ...item, content: item.content }] : []))
const messages = PRESET_DEFINITIONS.flatMap((item) => (item.content.kind === 'message' ? [{ ...item, content: item.content }] : []))

/** The launch catalogue by display name: a rename that drops one of these fails here, not silently in production. */
const LAUNCH_NAMES = [
  'Welcome a new member', 'Announce a sale', 'Run a flash sale', 'Final markdowns', 'Introduce new arrivals', 'Seasonal campaign', 'Share your brand story',
  'Opt-in confirmation + welcome', 'SMS offer', 'Last call',
  'Flash sale graphic', 'Holiday campaign', 'Store opening/event invite',
]
/** The tags every workspace already has: the launch catalogue uses nothing else, so no workspace hides any of it. */
const TENANT_TAGS = new Set(['first_name', 'discount_pct', 'offer_code', 'shop_url', 'unsubscribe_url'])

test('the 13-preset launch catalogue, by name, plus the 4 bonus presets after it', () => {
  expect(LAUNCH_PRESETS.map((item) => item.name)).toEqual(LAUNCH_NAMES)
  expect(BONUS_PRESETS.map((item) => item.key)).toEqual(['loyalty', 'winback', 'sms_points', 'mms_lookbook', 'sms_winback', 'coupon', 'sms_coupon'])
  expect(PRESET_DEFINITIONS).toEqual([...LAUNCH_PRESETS, ...BONUS_PRESETS, ...RECEIPT_PRESETS])
  expect(LAUNCH_PRESETS.filter((item) => item.channel === 'EMAIL')).toHaveLength(7)
  expect(LAUNCH_PRESETS.filter((item) => item.channel === 'SMS')).toHaveLength(3)
  expect(LAUNCH_PRESETS.filter((item) => item.channel === 'MMS')).toHaveLength(3)
})

test('the three presets added since launch: tenant tags only, and the tone each is meant to have', () => {
  const added = BONUS_PRESETS.filter((item) => ['sms_winback', 'coupon', 'sms_coupon'].includes(item.key))
  expect(added.map((item) => [item.name, item.channel, item.category])).toEqual([
    ['We miss you', 'SMS', 'Retention'], ['Personal coupon', 'EMAIL', 'Coupon'], ['SMS coupon', 'SMS', 'Coupon'],
  ])
  const textOf = (item: (typeof added)[number]) => item.content.kind === 'message' ? `${item.content.subject_line} ${item.content.sms_body}` : `${item.content.subject_line} ${item.content.preheader} ${item.content.mjml}`
  for (const item of added) expect(tagsOf(textOf(item)).filter((tag) => !TENANT_TAGS.has(tag)), item.key).toEqual([])

  // a coupon is a personal gift: no countdown, no clearance, no "everyone"
  for (const item of added.filter((candidate) => candidate.category === 'Coupon')) {
    expect(textOf(item), item.key).toMatch(/just for you/i)
    expect(textOf(item), item.key).not.toMatch(/today only|midnight|ends|hurry|last chance|final|while stock|everyone gets/i)
  }
  const winbackText = textOf(added[0])
  expect(winbackText).toMatch(/^ Your Brand: We miss you, \{\{first_name\}\}\./)
  expect(winbackText).toContain('{{offer_code}}')
})

test('every preset once, with everything a preset needs', () => {
  expect(new Set(PRESET_DEFINITIONS.map((item) => item.key)).size).toBe(PRESET_DEFINITIONS.length)
  expect(new Set(PRESET_DEFINITIONS.map((item) => item.name)).size).toBe(PRESET_DEFINITIONS.length)
  for (const item of PRESET_DEFINITIONS) {
    for (const field of [item.key, item.name, item.category, item.description]) expect(field.trim(), item.key).not.toBe('')
    expect(['EMAIL', 'SMS', 'MMS', 'E_RECEIPT'], item.key).toContain(item.channel)
    expect(item.content.kind, item.key).toBe(item.channel === 'EMAIL' ? 'design' : item.channel === 'E_RECEIPT' ? 'receipt' : 'message')
  }
})

test('the launch catalogue uses only the tags every workspace already has', () => {
  for (const item of LAUNCH_PRESETS) {
    const text = item.content.kind === 'message' ? `${item.content.subject_line} ${item.content.sms_body}` : `${item.content.subject_line} ${item.content.preheader} ${item.content.mjml}`
    expect(tagsOf(text).filter((tag) => !TENANT_TAGS.has(tag)), item.key).toEqual([])
  }
})

describe.each(emails)('$key email', ({ content }) => {
  test('compiles with no MJML errors', () => {
    const { html, errors } = mjml2html(content.mjml, { validationLevel: 'soft' })
    expect(errors).toEqual([])
    expect(html).toContain('YOUR BRAND')
  })

  test('uses only the components the designer round-trips, and no images', () => {
    const doc = new DOMParser().parseFromString(expandSelfClosing(content.mjml), 'text/html')
    const used = new Set([...doc.querySelectorAll('*')].map((node) => node.tagName.toLowerCase()).filter((tag) => tag.startsWith('mj')))
    expect([...used].filter((tag) => !ALLOWED.has(tag))).toEqual([])
    expect(content.mjml).not.toMatch(/<img|mj-image/i)
  })

  test('has one primary button, a subject, and the marketing footer with the unsubscribe link', () => {
    expect(content.mjml.match(/<mj-button/g)).toHaveLength(1)
    expect(content.subject_line.trim()).not.toBe('')
    expect(content.preheader.trim()).not.toBe('')
    expect(content.mjml).toMatch(/<mj-section css-class="cep-footer"[\s\S]*href="\{\{unsubscribe_url\}\}"/)
  })

  // the designer's canvas ignores mj-attributes, so every element carries its own look
  test('every text, button and divider sets its own look, with no mj-head to lean on', () => {
    expect(content.mjml).not.toContain('<mj-head')
    for (const tag of content.mjml.match(/<mj-(text|button)\b[^>]*>/g) ?? []) expect(tag).toContain(`font-family="${EMAIL_FONT_STACK}"`)
    for (const tag of content.mjml.match(/<mj-divider\b[^>]*>/g) ?? []) expect(tag).toContain('border-width="1px"')
  })

  test('uses only tags the backend starters already use', () => {
    const used = tagsOf(`${content.subject_line} ${content.preheader} ${content.mjml}`)
    expect(used.filter((tag) => !KNOWN_TAGS.has(tag))).toEqual([])
  })
})

describe.each(messages)('$key message', ({ channel, description, content }) => {
  test('starts with the sender name and ends with the opt-out', () => {
    expect(content.sms_body.startsWith('Your Brand: ')).toBe(true)
    expect(content.sms_body.endsWith('Reply STOP to opt out.')).toBe(true)
    expect(tagsOf(content.sms_body).filter((tag) => !KNOWN_TAGS.has(tag))).toEqual([])
  })

  test('is one GSM-7 segment with sample values filled in', () => {
    const metrics = smsMetrics(renderWithSamples(content.sms_body, presetTags))
    expect(metrics.encoding).toBe('GSM-7')
    expect(metrics.segments).toBe(1)
  })

  test('MMS ships without a picture and says to add one', () => {
    if (channel !== 'MMS') return
    expect(description).toContain('Add your picture before activating')
    expect(content.subject_line).not.toBe('')
  })
})

// ---- e-receipts ----

/** REQUIRED_TAGS in backend apps/templates/starters.py, plus what its own receipt starter already uses */
const RECEIPT_TAG_KEYS = new Set(['receipt_number', 'transaction_date', 'store_name', 'store_address', 'subtotal', 'discount_total', 'tax_total', 'grand_total',
  'payment_method', 'order_number', 'order_url', 'shipping_address', 'delivery_estimate', 'first_name', 'loyalty_points', 'loyalty_tier'])

const receiptContent = (item: (typeof RECEIPT_PRESETS)[number]) => {
  if (item.content.kind !== 'receipt') throw new Error(`${item.key} is not a receipt`)
  return item.content
}
const section = <K extends ReceiptSection['key']>(item: (typeof RECEIPT_PRESETS)[number], key: K) =>
  receiptContent(item).sections.find((candidate) => candidate.key === key) as Extract<ReceiptSection, { key: K }>

test('the four e-receipt presets, each with its own subject and preheader', () => {
  expect(RECEIPT_PRESETS.map((item) => item.name)).toEqual(['Standard store receipt', 'Savings + points', 'Online order', 'BOPIS'])
  expect(new Set(RECEIPT_PRESETS.map((item) => receiptContent(item).subject_line)).size).toBe(4)
  expect(new Set(RECEIPT_PRESETS.map((item) => receiptContent(item).preheader)).size).toBe(4)
  for (const item of RECEIPT_PRESETS) expect(receiptContent(item).layout_preset, item.key).toBe('STANDARD')
})

describe.each(RECEIPT_PRESETS)('$key e-receipt', (item) => {
  test('its outer design compiles, keeps the receipt slot and the receipt footer, and has no unsubscribe link', () => {
    const { mjml } = receiptContent(item)
    const { errors } = mjml2html(mjml, { validationLevel: 'soft' })
    expect(errors).toEqual([])
    expect(mjml).toContain('CEP:RECEIPT_SLOT_START')
    expect(mjml).toMatch(/css-class="cep-receipt-footer/)
    expect(mjml).not.toContain('unsubscribe_url')
  })

  test('its tags are all ones the server already knows for receipts', () => {
    const { requiredTags } = presetFromDefinition(item)
    expect(requiredTags.filter((tag) => !RECEIPT_TAG_KEYS.has(tag))).toEqual([])
  })
})

test('each layout is Standard with only what its name implies changed', () => {
  const standard = defaultSectionsFor('STANDARD')
  const changedKeys = (item: (typeof RECEIPT_PRESETS)[number]) =>
    receiptContent(item).sections.filter((candidate, index) => JSON.stringify(candidate) !== JSON.stringify(standard[index])).map((candidate) => candidate.key)

  expect(changedKeys(receiptStandard)).toEqual(['loyalty'])
  expect(section(receiptStandard, 'loyalty').visible).toBe(false)

  // Standard already has the savings call-out and loyalty on; this one only drops tier progress
  expect(changedKeys(receiptSavingsPoints)).toEqual(['loyalty'])
  expect(section(receiptSavingsPoints, 'totals').savings_callout).toBe(true)
  expect(section(receiptSavingsPoints, 'loyalty')).toMatchObject({ visible: true, fields: { points_earned: true, points_balance: true, tier_progress: false } })

  expect(changedKeys(receiptOnlineOrder)).toEqual(['customer_fulfillment', 'items', 'loyalty'])
  expect(section(receiptOnlineOrder, 'customer_fulfillment')).toMatchObject({ address_mode: 'SHIP_TO', delivery_estimate: true })
  expect(section(receiptOnlineOrder, 'items').columns).toEqual({ product_image: true, sku: false, quantity: true, unit_price: true, amount: true })
  expect(section(receiptOnlineOrder, 'loyalty').visible).toBe(false)

  expect(changedKeys(receiptBopis)).toEqual(['customer_fulfillment', 'loyalty'])
  expect(section(receiptBopis, 'customer_fulfillment')).toMatchObject({ address_mode: 'PICKUP', delivery_estimate: false })
  expect(section(receiptBopis, 'header').fields.store).toBe(true)
  expect(section(receiptBopis, 'loyalty').visible).toBe(false)
})

test('required tags follow the sections: loyalty only when shown, the address only for the fulfilment it names', () => {
  const tags = (item: (typeof RECEIPT_PRESETS)[number]) => presetFromDefinition(item).requiredTags

  for (const item of RECEIPT_PRESETS) {
    expect(tags(item), item.key).toEqual(expect.arrayContaining(['first_name', 'order_number', 'grand_total', 'subtotal', 'tax_total', 'payment_method']))
  }
  expect(tags(receiptStandard)).not.toContain('loyalty_points')
  expect(tags(receiptSavingsPoints)).toContain('loyalty_points')
  expect(tags(receiptSavingsPoints)).not.toContain('loyalty_tier')
  expect(tags(receiptOnlineOrder)).toEqual(expect.arrayContaining(['shipping_address', 'delivery_estimate']))
  expect(tags(receiptOnlineOrder)).not.toContain('store_address')
  expect(tags(receiptBopis)).toEqual(expect.arrayContaining(['store_address', 'store_name']))
  expect(tags(receiptBopis)).not.toContain('shipping_address')
  expect(tags(receiptBopis)).not.toContain('delivery_estimate')
})
