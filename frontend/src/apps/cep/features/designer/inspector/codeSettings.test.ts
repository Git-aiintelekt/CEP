import type { Component } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { BARCODE_DEFAULTS, CODE_TYPE, QR_DEFAULTS, codeConfigOf, codeRegion, type CodeConfig } from '../blocks/codes'
import { defaultNameFor } from '../layers/layerNames'
import {
  CODE_ALIGN_KEY, CODE_BACKGROUND_KEY, CODE_ECC_KEY, CODE_FORMAT_KEY, CODE_HEIGHT_KEY, CODE_SIZE_KEY, CODE_SOURCE_KEY, CODE_TEXT_KEY, CODE_TEXT_ON,
  CODE_WIDTH_KEY, nextCodeConfig, sourceOptions,
} from './codeSettings'
import { fieldsFor, readEffective, readSetting, writeSetting } from './settings'

/** A code block as the panel sees it: its HTML is the region, and writing replaces the region. */
function codeBlock(config: CodeConfig) {
  let html = `<mj-raw css-class="cep-code">${codeRegion(config, 'SAMPLE-1', 'https://x.example/c.png')}</mj-raw>`
  const trigger = vi.fn()
  const component = {
    em: { trigger },
    get: (key: string) => (key === 'type' ? CODE_TYPE : undefined),
    getAttributes: () => ({}),
    toHTML: () => html,
    components: (parts: unknown[]) => {
      const text = parts.map((part) => (typeof part === 'string' ? part : `<!--${(part as { content: string }).content}-->`)).join('')
      html = `<mj-raw css-class="cep-code">${text}</mj-raw>`
    },
  }
  return { component: component as unknown as Component, trigger, html: () => html }
}

test('a barcode and a QR code each get their own configuration box', () => {
  expect(fieldsFor(codeBlock(BARCODE_DEFAULTS).component).map((field) => field.label))
    .toEqual(['Data Source', 'Barcode Type', 'Show Number Below', 'Width', 'Height', 'Alignment', 'Background Color'])
  expect(fieldsFor(codeBlock(QR_DEFAULTS).component).map((field) => field.label))
    .toEqual(['Data Source', 'Error Correction', 'Show Value Below', 'Size', 'Alignment', 'Background Color'])
  expect(fieldsFor(codeBlock(BARCODE_DEFAULTS).component).find((field) => field.key === CODE_WIDTH_KEY)).toMatchObject({ min: 120, max: 560, units: ['px'] })
})

test('the panel reads the settings from the block, as the block', () => {
  const { component } = codeBlock({ ...BARCODE_DEFAULTS, format: 'ean13', width: 400 })
  expect([CODE_SOURCE_KEY, CODE_FORMAT_KEY, CODE_WIDTH_KEY, CODE_HEIGHT_KEY, CODE_TEXT_KEY, CODE_ALIGN_KEY, CODE_BACKGROUND_KEY].map((key) => readSetting(component, key)))
    .toEqual(['coupon_barcode_value', 'ean13', '400px', '80px', CODE_TEXT_ON, 'center', '#ffffff'])
  expect(readEffective(component, CODE_FORMAT_KEY, null)).toEqual({ value: 'ean13', source: 'block' })
  expect(readSetting({ get: () => 'mj-text', getAttributes: () => ({}) } as unknown as Component, CODE_SOURCE_KEY)).toBe(null)
})

test('a change is written into the block and the designer is told, keeping the picture until it draws a new one', () => {
  const block = codeBlock(BARCODE_DEFAULTS)
  expect(writeSetting(block.component, CODE_SOURCE_KEY, 'offer_code')).toBe(true)
  expect(codeConfigOf(block.component)?.source).toBe('offer_code')
  expect(block.trigger).toHaveBeenCalledWith('cep:code-changed', block.component)
  expect(block.html()).toContain('src="https://x.example/c.png"')
  expect(block.html()).toContain('alt="SAMPLE-1"')

  expect(writeSetting(block.component, CODE_WIDTH_KEY, '900px')).toBe(false)                         // wider than an email takes
  expect(writeSetting(block.component, CODE_TEXT_KEY, null)).toBe(true)
  expect(codeConfigOf(block.component)?.text).toBe(false)
  expect(writeSetting(block.component, CODE_WIDTH_KEY, null)).toBe(true)                              // Reset: the default comes back
  expect(codeConfigOf(block.component)?.width).toBe(300)
})

test('each setting takes only what the block can use; Reset brings back the default', () => {
  const qr = QR_DEFAULTS
  expect(nextCodeConfig(qr, CODE_ECC_KEY, 'H')?.ecc).toBe('H')
  expect(nextCodeConfig(qr, CODE_ECC_KEY, 'Z')).toBe(null)
  expect(nextCodeConfig(qr, CODE_SIZE_KEY, '240px')?.size).toBe(240)
  expect(nextCodeConfig(qr, CODE_SIZE_KEY, '40px')).toBe(null)
  expect(nextCodeConfig(qr, CODE_SIZE_KEY, '2em')).toBe(null)                                         // the field writes px
  expect(nextCodeConfig(BARCODE_DEFAULTS, CODE_FORMAT_KEY, 'pdf417')).toBe(null)
  expect(nextCodeConfig(BARCODE_DEFAULTS, CODE_SOURCE_KEY, 'bad key!')).toBe(null)
  expect(nextCodeConfig({ ...BARCODE_DEFAULTS, source: 'offer_code' }, CODE_SOURCE_KEY, null)?.source).toBe('coupon_barcode_value')
  expect(nextCodeConfig(BARCODE_DEFAULTS, CODE_BACKGROUND_KEY, '#FFF7E6')?.background).toBe('#fff7e6')
  expect(nextCodeConfig(BARCODE_DEFAULTS, CODE_BACKGROUND_KEY, 'red')).toBe(null)
  expect(nextCodeConfig(BARCODE_DEFAULTS, CODE_ALIGN_KEY, 'right')?.align).toBe('right')
})

test('the data source lists the coupon tags first, then the rest the channel can use, and keeps a chosen tag', () => {
  const tag = (tag_key: string, label: string, channels = ['EMAIL'], is_active = true): PersonalizationTag => ({
    id: tag_key, tag_key, label, tag_kind: 'CUSTOM', data_type: 'STRING', applies_to_channels: channels, description: null, sample_value: null,
    default_value: null, static_value: null, is_active,
  })
  const tags = [tag('first_name', 'First Name'), tag('coupon_code', 'Coupon Code'), tag('coupon_qr_value', 'Coupon QR Value'),
    tag('coupon_barcode_value', 'Coupon Barcode Value'), tag('sms_only', 'SMS Only', ['SMS']), tag('old', 'Old', ['EMAIL'], false)]
  expect(sourceOptions(tags, 'EMAIL', 'coupon_barcode_value').map((option) => option.label))
    .toEqual(['Coupon Barcode Value', 'Coupon QR Value', 'Coupon Code', 'First Name'])
  expect(sourceOptions(tags, 'EMAIL', 'gone_tag')[0]).toEqual({ value: 'gone_tag', label: 'gone_tag' })
})

test('the block is named for what it draws', () => {
  expect(defaultNameFor(CODE_TYPE, { 'css-class': 'cep-code cep-code-qr' })).toBe('QR Code')
  expect(defaultNameFor(CODE_TYPE, { 'css-class': 'cep-code cep-code-barcode' })).toBe('Barcode')
  expect(defaultNameFor(CODE_TYPE)).toBe('Barcode')
})
