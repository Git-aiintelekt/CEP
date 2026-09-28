/**
 * The Barcode and QR Code blocks' settings panel. The settings live in the block's region (blocks/codes.ts), not in
 * MJML attributes, so each key reads and writes through here; settings.ts asks here before the attribute map.
 */
import type { Component } from 'grapesjs'

import type { PersonalizationTag } from '@/lib/types'

import {
  BARCODE_DEFAULTS, BARCODE_FORMAT_OPTIONS, BARCODE_HEIGHT, BARCODE_WIDTH, QR_DEFAULTS, QR_LEVEL_OPTIONS, QR_SIZE, codeConfigOf, codeSrcOf,
  isCodeBlock, placeholderSrc, shownSample, writeCode, type CodeAlign, type CodeConfig,
} from '../blocks/codes'
import type { SelectOption } from './fields/options'
import type { SettingField } from './settings'

export const CODE_SOURCE_KEY = 'cep-code-source'
export const CODE_FORMAT_KEY = 'cep-code-format'
export const CODE_WIDTH_KEY = 'cep-code-width'
export const CODE_HEIGHT_KEY = 'cep-code-height'
export const CODE_SIZE_KEY = 'cep-code-size'
export const CODE_ECC_KEY = 'cep-code-ecc'
export const CODE_TEXT_KEY = 'cep-code-text'
export const CODE_ALIGN_KEY = 'cep-code-align'
export const CODE_BACKGROUND_KEY = 'cep-code-background'
export const CODE_KEYS: readonly string[] = [
  CODE_SOURCE_KEY, CODE_FORMAT_KEY, CODE_WIDTH_KEY, CODE_HEIGHT_KEY, CODE_SIZE_KEY, CODE_ECC_KEY, CODE_TEXT_KEY, CODE_ALIGN_KEY, CODE_BACKGROUND_KEY,
]
/** what the Show Number switch writes when it is on */
export const CODE_TEXT_ON = 'on'

export const CODE_SOURCE_HELP = 'Drawn for each recipient when the email is sent. A recipient without a value gets the email without this block.'
export const CODE_TEXT_HELP = 'Keeps the code usable while the inbox still hides images.'
export const CODE_FEATURE_OFF =
  'Barcodes and QR codes are not switched on for this workspace, so this block is left out of every email. Ask the platform team to enable it.'

export const BARCODE_FIELDS: SettingField[] = [
  { key: CODE_SOURCE_KEY, label: 'Data Source', kind: 'select', section: 'content', required: true, help: CODE_SOURCE_HELP },
  { key: CODE_FORMAT_KEY, label: 'Barcode Type', kind: 'select', section: 'content', required: true },
  { key: CODE_TEXT_KEY, label: 'Show Number Below', kind: 'toggle', section: 'content', help: CODE_TEXT_HELP },
  { key: CODE_WIDTH_KEY, label: 'Width', kind: 'length', section: 'layout', min: BARCODE_WIDTH.min, max: BARCODE_WIDTH.max },
  { key: CODE_HEIGHT_KEY, label: 'Height', kind: 'length', section: 'layout', min: BARCODE_HEIGHT.min, max: BARCODE_HEIGHT.max },
  { key: CODE_ALIGN_KEY, label: 'Alignment', kind: 'align', section: 'layout' },
  { key: CODE_BACKGROUND_KEY, label: 'Background Color', kind: 'color', section: 'appearance' },
]

export const QR_FIELDS: SettingField[] = [
  { key: CODE_SOURCE_KEY, label: 'Data Source', kind: 'select', section: 'content', required: true, help: CODE_SOURCE_HELP },
  { key: CODE_ECC_KEY, label: 'Error Correction', kind: 'select', section: 'content', required: true, help: 'Higher levels still scan when part of the code is damaged or covered, and draw a denser code.' },
  { key: CODE_TEXT_KEY, label: 'Show Value Below', kind: 'toggle', section: 'content', help: CODE_TEXT_HELP },
  { key: CODE_SIZE_KEY, label: 'Size', kind: 'length', section: 'layout', min: QR_SIZE.min, max: QR_SIZE.max, help: 'Width and height: a QR code is square.' },
  { key: CODE_ALIGN_KEY, label: 'Alignment', kind: 'align', section: 'layout' },
  { key: CODE_BACKGROUND_KEY, label: 'Background Color', kind: 'color', section: 'appearance' },
]

export const CODE_OPTIONS: Record<string, SelectOption[]> = {
  [CODE_FORMAT_KEY]: BARCODE_FORMAT_OPTIONS,
  [CODE_ECC_KEY]: QR_LEVEL_OPTIONS,
}

/** The three coupon tags first, then the rest of what the channel can use; a tag already chosen is always offered. */
export function sourceOptions(tags: PersonalizationTag[], channel: string, current: string | null): SelectOption[] {
  const key = (tag: PersonalizationTag) => tag.tag_key.replace(/[{} ]/g, '')
  const usable = tags.filter((tag) => tag.is_active !== false && (!tag.applies_to_channels?.length || tag.applies_to_channels.includes(channel)))
  const coupon = ['coupon_barcode_value', 'coupon_qr_value', 'coupon_code']
  const ordered = [...usable].sort((a, b) => {
    const rank = (tag: PersonalizationTag) => (coupon.includes(key(tag)) ? coupon.indexOf(key(tag)) : coupon.length)
    return rank(a) - rank(b) || a.label.localeCompare(b.label)
  })
  const options = ordered.map((tag) => ({ value: key(tag), label: tag.label }))
  return current && !options.some((option) => option.value === current) ? [{ value: current, label: current }, ...options] : options
}

export function codeFieldsFor(component: Component): SettingField[] {
  return codeConfigOf(component)?.kind === 'qr' ? QR_FIELDS : BARCODE_FIELDS
}

export function isCodeKey(key: string): boolean {
  return CODE_KEYS.includes(key)
}

const px = (value: number | undefined) => (value === undefined ? null : `${value}px`)

export function readCodeSetting(component: Component, key: string): string | null {
  const config = codeConfigOf(component)
  if (!config) return null
  switch (key) {
    case CODE_SOURCE_KEY: return config.source
    case CODE_FORMAT_KEY: return config.format ?? null
    case CODE_ECC_KEY: return config.ecc ?? null
    case CODE_WIDTH_KEY: return px(config.width)
    case CODE_HEIGHT_KEY: return px(config.height)
    case CODE_SIZE_KEY: return px(config.size)
    case CODE_TEXT_KEY: return config.text ? CODE_TEXT_ON : null
    case CODE_ALIGN_KEY: return config.align
    case CODE_BACKGROUND_KEY: return config.background
    default: return null
  }
}

function pixels(value: string | null, range: { min: number; max: number }, fallback: number | undefined): number | undefined | false {
  if (value === null) return fallback
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim())
  if (!match) return false
  const amount = Math.round(Number(match[1]))
  return amount < range.min || amount > range.max ? false : amount
}

/** The settings after one change, or null when the value is one the block cannot take. Null is Reset. */
export function nextCodeConfig(config: CodeConfig, key: string, value: string | null): CodeConfig | null {
  const defaults = config.kind === 'qr' ? QR_DEFAULTS : BARCODE_DEFAULTS
  const next = { ...config }
  switch (key) {
    case CODE_SOURCE_KEY:
      if (value !== null && !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(value)) return null
      next.source = value ?? defaults.source
      break
    case CODE_FORMAT_KEY:
      if (value !== null && !BARCODE_FORMAT_OPTIONS.some((option) => option.value === value)) return null
      next.format = (value ?? defaults.format) as CodeConfig['format']
      break
    case CODE_ECC_KEY:
      if (value !== null && !QR_LEVEL_OPTIONS.some((option) => option.value === value)) return null
      next.ecc = (value ?? defaults.ecc) as CodeConfig['ecc']
      break
    case CODE_WIDTH_KEY: case CODE_HEIGHT_KEY: case CODE_SIZE_KEY: {
      const [field, range] = key === CODE_WIDTH_KEY ? (['width', BARCODE_WIDTH] as const) : key === CODE_HEIGHT_KEY ? (['height', BARCODE_HEIGHT] as const) : (['size', QR_SIZE] as const)
      const amount = pixels(value, range, defaults[field])
      if (amount === false) return null
      next[field] = amount
      break
    }
    case CODE_TEXT_KEY:
      next.text = value === CODE_TEXT_ON
      break
    case CODE_ALIGN_KEY:
      if (value !== null && !['left', 'center', 'right'].includes(value)) return null
      next.align = (value ?? 'center') as CodeAlign
      break
    case CODE_BACKGROUND_KEY:
      if (value !== null && !/^#[0-9a-fA-F]{6}$/.test(value)) return null
      next.background = value === null ? null : value.toLowerCase()
      break
    default:
      return null
  }
  return next
}

/**
 * Writes the change. The picture and number already shown stay until the designer has drawn the new sample, which
 * it does whenever it hears 'cep:code-changed'.
 */
export function writeCodeSetting(component: Component, key: string, value: string | null): boolean {
  if (!isCodeBlock(component)) return false
  const config = codeConfigOf(component)
  const next = config && nextCodeConfig(config, key, value)
  if (!next) return false
  const html = typeof component.toHTML === 'function' ? component.toHTML() : ''
  writeCode(component, next, shownSample(html) ?? '', codeSrcOf(component) ?? placeholderSrc(next))
  const events = (component as unknown as { em?: { trigger: (event: string, target: Component) => void } }).em
  events?.trigger('cep:code-changed', component)
  return true
}
