import type { Component, Editor } from 'grapesjs'
import mjml2html from 'mjml-browser'
import { expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import {
  BARCODE_DEFAULTS, CODE_TYPE, QR_DEFAULTS, codeRegion, parseCodeConfig, placeholderSrc, registerCodeType, sampleFor, shownSample,
  shownSrc, valueProblem, writeCode,
} from './codes'
import { blocksFor } from './register'
import { CODE_BLOCKS } from './registry'

const tag = (tag_key: string, label: string, sample_value: string | null): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind: 'CUSTOM', data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null, sample_value,
  default_value: null, static_value: null, is_active: true,
})
const ean = { ...BARCODE_DEFAULTS, format: 'ean13' as const }

test('values follow the server rules for each format', () => {
  expect(valueProblem(BARCODE_DEFAULTS, 'CPN400012345678')).toBe(null)
  expect(valueProblem(BARCODE_DEFAULTS, 'CAFÉ')).toMatch(/Code 128/)
  expect(valueProblem(ean, '400638133393')).toBe(null)
  expect(valueProblem(ean, '4006381333931')).toBe(null)                                            // the right check digit
  expect(valueProblem(ean, '4006381333932')).toMatch(/EAN-13/)
  expect(valueProblem({ ...BARCODE_DEFAULTS, format: 'upca' }, '036000291452')).toBe(null)
  expect(valueProblem({ ...BARCODE_DEFAULTS, format: 'code39' }, 'save-20')).toBe(null)            // drawn upper case
  expect(valueProblem({ ...BARCODE_DEFAULTS, format: 'code39' }, 'a@b')).toMatch(/Code 39/)
  expect(valueProblem(QR_DEFAULTS, 'https://shop.example.com/c/1')).toBe(null)
  expect(valueProblem(QR_DEFAULTS, '')).toBe('no value')
})

test("the sample is the tag's own when the format can draw it, else a stand-in and a word about why", () => {
  const tags = [tag('coupon_barcode_value', 'Coupon Barcode Value', 'CPN77'), tag('offer_code', 'Offer Code', 'FALL017')]
  expect(sampleFor(BARCODE_DEFAULTS, tags)).toEqual({ value: 'CPN77', problem: null })
  const refused = sampleFor({ ...ean, source: 'offer_code' }, tags)
  expect(refused.value).toBe('400638133393')
  expect(refused.problem).toBe("Offer Code's sample value (FALL017) cannot be drawn: EAN-13 needs 12 digits, or 13 with a correct check digit. Recipients with values like it will get the email without this block.")
  expect(sampleFor({ ...QR_DEFAULTS, source: 'nothing_here' }, tags)).toEqual({ value: 'https://shop.example.com/c/SAVE20-7K3Q', problem: null })
})

test('the region carries only the settings its kind uses, and reads back filled out', () => {
  const region = codeRegion(QR_DEFAULTS, 'V', 'https://x.example/q.png')
  expect(region.startsWith('<!-- CEP:CODE {"kind":"qr","source":"coupon_qr_value","text":false,"align":"center","background":"#ffffff","ecc":"M","size":180} -->')).toBe(true)
  expect(region.endsWith('<!-- CEP:CODE_END -->')).toBe(true)
  expect(parseCodeConfig(region)).toEqual(QR_DEFAULTS)
  expect(parseCodeConfig('<!-- CEP:CODE {"kind":"barcode","width":400} --><!-- CEP:CODE_END -->')).toEqual({ ...BARCODE_DEFAULTS, width: 400 })
  expect(parseCodeConfig('<p>no block</p>')).toBe(null)
  expect(parseCodeConfig('<!-- CEP:CODE {not json} --><!-- CEP:CODE_END -->')).toBe(null)
})

test('the sample, its picture and its number are escaped, and read back', () => {
  const region = codeRegion(BARCODE_DEFAULTS, 'A"<b>&', 'https://x.example/b.png?a=1&b=2')
  expect(region).toContain('alt="A&quot;&lt;b&gt;&amp;"')
  expect(region).toContain('>A&quot;&lt;b&gt;&amp;</div>')
  expect(shownSample(region)).toBe('A"<b>&')
  expect(shownSrc(region)).toBe('https://x.example/b.png?a=1&b=2')
  expect(codeRegion({ ...BARCODE_DEFAULTS, text: false }, 'X', 's')).not.toContain('<div')
})

test.each(CODE_BLOCKS.map((block) => [block.id, block] as const))('%s compiles, and its markers reach the HTML untouched', (_id, block) => {
  const result = mjml2html(`<mjml><mj-body>${block.mjml}</mj-body></mjml>`)
  expect(result.errors).toEqual([])
  expect(parseCodeConfig(result.html)).toEqual(block.id === 'qr-code' ? QR_DEFAULTS : BARCODE_DEFAULTS)
  expect(result.html).toContain('<!-- CEP:CODE_END -->')
  expect(block.mjml).toContain(`css-class="cep-code cep-code-${block.id === 'qr-code' ? 'qr' : 'barcode'}"`)
})

test('the stand-in is an SVG at the size the email shows', () => {
  const src = placeholderSrc(QR_DEFAULTS, 'x')
  expect(src.startsWith('data:image/svg+xml;base64,')).toBe(true)
  expect(atob(src.split(',')[1])).toContain('width="180" height="180"')
  expect(atob(placeholderSrc({ ...BARCODE_DEFAULTS, width: 400 }).split(',')[1])).toContain('width="400" height="80"')
})

test('writing a block puts its markers in as comment components, the opening one first', () => {
  const components = vi.fn()
  writeCode({ components } as unknown as Component, BARCODE_DEFAULTS, 'V', 'https://x.example/b.png')
  const [parts] = components.mock.calls[0] as [unknown[]]
  expect(parts[0]).toEqual({ type: 'comment', content: ' CEP:CODE {"kind":"barcode","source":"coupon_barcode_value","text":true,"align":"center","background":"#ffffff","format":"code128","width":300,"height":80} ' })
  expect(String(parts[1])).toMatch(/^<table/)
  expect(parts[2]).toEqual({ type: 'comment', content: ' CEP:CODE_END ' })
})

test('the type is an mj-raw that carries the cep-code class, nothing else', () => {
  const addType = vi.fn()
  registerCodeType({ Components: { addType, getType: () => undefined } } as unknown as Editor)
  const [id, definition] = addType.mock.calls[0] as [string, { extend: string; isComponent: (el: HTMLElement) => boolean }]
  expect(id).toBe(CODE_TYPE)
  expect(definition.extend).toBe('mj-raw')
  const element = (css: string | null) => {
    const el = document.createElement('mj-raw')
    if (css !== null) el.setAttribute('css-class', css)
    return el
  }
  expect(definition.isComponent(element('cep-code cep-code-qr'))).toBe(true)
  expect(definition.isComponent(element(null))).toBe(false)
  expect(definition.isComponent(element('cep-receipt-slot'))).toBe(false)
})

test('the palette offers the two blocks only where the workspace has the feature, and never on a receipt', () => {
  const ids = (channel: string, dynamicCodes?: boolean) => blocksFor(channel, { dynamicCodes }).map((block) => block.id)
  expect(ids('EMAIL')).not.toContain('barcode')
  expect(ids('EMAIL', true).slice(-2)).toEqual(['barcode', 'qr-code'])
  expect(ids('E_RECEIPT', true)).not.toContain('barcode')
  expect(CODE_BLOCKS.every((block) => block.category === 'commerce')).toBe(true)
})
