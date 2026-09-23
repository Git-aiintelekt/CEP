import { expect, test } from 'vitest'

import type { TemplateStarter } from '@/lib/types'

import { mergePresets, offerable } from './presetSource'
import { LAUNCH_PRESETS, PRESET_DEFINITIONS } from './presets'

const starter = (key: string, channel: string, text: string): TemplateStarter => ({
  key, name: `Server ${key}`, channel, category: 'Server', description: 'From the server.', subject_line: '', preheader: '',
  html_content: channel === 'SMS' ? null : `<p>${text}</p>`, sms_body: channel === 'SMS' ? text : null,
})

test('a frontend definition replaces the server starter with the same key, content and all', () => {
  const [preset] = mergePresets([starter('promotion', 'EMAIL', '{{old_tag}}')], PRESET_DEFINITIONS.filter((item) => item.key === 'promotion'))

  expect(preset.name).toBe('Announce a sale')
  expect(preset.content?.kind).toBe('design')
  // tags come from the frontend content, not from the server's rendered preview
  expect(preset.requiredTags).not.toContain('old_tag')
  expect(preset.requiredTags).toEqual(expect.arrayContaining(['first_name', 'discount_pct', 'offer_code', 'shop_url', 'unsubscribe_url']))
})

test('a server starter with no frontend definition passes through unchanged, still copied by the server', () => {
  const receipts = [starter('store_receipt', 'E_RECEIPT', '{{store_name}}'), starter('order_confirmation', 'E_RECEIPT', '{{order_number}}')]
  const presets = mergePresets(receipts, [])

  expect(presets.map((preset) => preset.key)).toEqual(['store_receipt', 'order_confirmation'])
  expect(presets.map((preset) => preset.name)).toEqual(['Server store_receipt', 'Server order_confirmation'])
  expect(presets.every((preset) => preset.content === undefined)).toBe(true)
  expect(presets[0].requiredTags).toEqual(['store_name'])
  expect(presets[0].governanceClass).toBe('TRANSACTIONAL')
})

test('keeps the server order, then adds the definitions the server does not list', () => {
  const email = PRESET_DEFINITIONS.filter((item) => item.channel === 'EMAIL')
  const presets = mergePresets([starter('newsletter', 'EMAIL', ''), starter('custom_one', 'EMAIL', '')], email)

  expect(presets.map((preset) => preset.key)).toEqual(['newsletter', 'custom_one', 'welcome', 'promotion', 'flash_sale', 'final_markdowns', 'new_arrivals', 'seasonal', 'loyalty', 'winback', 'coupon'])
})

test('with the server down, the frontend presets are still offered', () => {
  expect(mergePresets([], PRESET_DEFINITIONS).map((preset) => preset.key)).toEqual(PRESET_DEFINITIONS.map((item) => item.key))
})

test('with only the tags every workspace has, all 13 launch presets are offered, whatever the server lists', () => {
  const tenant = new Set(['first_name', 'discount_pct', 'offer_code', 'shop_url', 'unsubscribe_url'])
  const offered = mergePresets([starter('promotion', 'EMAIL', ''), starter('store_receipt', 'E_RECEIPT', '{{store_name}}')], PRESET_DEFINITIONS)
    .filter((preset) => preset.requiredTags.every((key) => tenant.has(key)))
  const names = offered.map((preset) => preset.name)
  for (const preset of LAUNCH_PRESETS) expect(names, preset.name).toContain(preset.name)
  // the bonus loyalty presets need the loyalty tags; the server's store receipt is replaced by the frontend's
  expect(names).not.toContain('Loyalty statement')
  expect(names).not.toContain('Server store_receipt')
})

test('the e-receipt list is exactly the 4 frontend presets: the two on server keys replace the server starters', () => {
  const receipts = mergePresets([starter('store_receipt', 'E_RECEIPT', '{{store_name}}'), starter('order_confirmation', 'E_RECEIPT', '{{order_number}}')],
    PRESET_DEFINITIONS.filter((item) => item.channel === 'E_RECEIPT'))

  expect(receipts.map((preset) => preset.name)).toEqual(['Standard store receipt', 'Online order', 'Savings + points', 'BOPIS'])
  expect(receipts.map((preset) => preset.key)).toEqual(['store_receipt', 'order_confirmation', 'receipt_savings_points', 'receipt_bopis'])
  expect(receipts.every((preset) => preset.content?.kind === 'receipt')).toBe(true)
})

test('e-receipt presets are offered whatever tags the workspace has', () => {
  const receipts = mergePresets([], PRESET_DEFINITIONS.filter((item) => item.channel === 'E_RECEIPT'))
  expect(receipts.every((preset) => preset.requiredTags.length > 0)).toBe(true) // they do use tags ...
  expect(receipts.filter((preset) => offerable(preset, new Set()))).toHaveLength(4) // ... and are offered with none
})

test('email, SMS and MMS presets are still offered only when the workspace has every tag they use', () => {
  const others = mergePresets([], PRESET_DEFINITIONS.filter((item) => item.channel !== 'E_RECEIPT'))
  expect(others.filter((preset) => offerable(preset, new Set()))).toEqual([])
  for (const preset of others) {
    const all = new Set(preset.requiredTags)
    expect(offerable(preset, all), preset.key).toBe(true)
    const [first, ...rest] = preset.requiredTags
    expect(offerable(preset, new Set(rest)), `${preset.key} without ${first}`).toBe(false)
  }
  // a server-only starter too: it is gated on the tags in its own content
  const serverOnly = mergePresets([starter('store_special', 'E_RECEIPT', '{{store_name}}')], [])[0]
  expect(offerable(serverOnly, new Set())).toBe(false)
  expect(offerable(serverOnly, new Set(['store_name']))).toBe(true)
})
