/**
 * Barcode and QR code blocks: a code drawn from one tag's value, for each recipient, when the email is sent.
 *
 * The block is an mj-raw whose content is bracketed by two comments, the first holding its settings as JSON. The
 * compilers copy mj-raw content byte for byte, so the settings reach the saved HTML, where the send engine
 * (backend apps/templates/codes.py) swaps the region for the recipient's own code, or leaves it out when the value is
 * missing. Between the comments is what the canvas and every preview show: the code of the tag's sample value.
 * Nothing in it is edited on the canvas; the settings panel writes the whole region again.
 */
import type { Component, Editor } from 'grapesjs'

import type { CodeSample, CodeSampleRequest, PersonalizationTag } from '@/lib/types'

import { makeInert } from './receiptSlot'

export const CODE_TYPE = 'cep-code'
export const CODE_CSS_CLASS = 'cep-code'
export const CODE_MARK = '<!-- CEP:CODE '
export const CODE_END = '<!-- CEP:CODE_END -->'
const REGION = /<!-- CEP:CODE (\{[\s\S]*?\}) -->[\s\S]*?<!-- CEP:CODE_END -->/

export type CodeKind = 'barcode' | 'qr'
export type BarcodeFormat = 'code128' | 'code39' | 'ean13' | 'upca'
export type QrLevel = 'L' | 'M' | 'Q' | 'H'
export type CodeAlign = 'left' | 'center' | 'right'

export interface CodeConfig {
  kind: CodeKind
  /** the tag the value comes from */
  source: string
  format?: BarcodeFormat
  width?: number
  height?: number
  ecc?: QrLevel
  size?: number
  /** the value printed under the code: the coupon still works while the inbox hides images */
  text: boolean
  align: CodeAlign
  background: string | null
}

export const BARCODE_DEFAULTS: CodeConfig = {
  kind: 'barcode', source: 'coupon_barcode_value', format: 'code128', width: 300, height: 80, text: true, align: 'center', background: '#ffffff',
}
export const QR_DEFAULTS: CodeConfig = {
  kind: 'qr', source: 'coupon_qr_value', ecc: 'M', size: 180, text: false, align: 'center', background: '#ffffff',
}

/** The same ranges the server enforces. */
export const BARCODE_WIDTH = { min: 120, max: 560 }
export const BARCODE_HEIGHT = { min: 40, max: 200 }
export const QR_SIZE = { min: 80, max: 300 }

export const BARCODE_FORMAT_OPTIONS: { value: BarcodeFormat; label: string }[] = [
  { value: 'code128', label: 'Code 128' },
  { value: 'code39', label: 'Code 39' },
  { value: 'ean13', label: 'EAN-13' },
  { value: 'upca', label: 'UPC-A' },
]
export const QR_LEVEL_OPTIONS: { value: QrLevel; label: string }[] = [
  { value: 'L', label: 'Low' },
  { value: 'M', label: 'Standard' },
  { value: 'Q', label: 'High' },
  { value: 'H', label: 'Maximum' },
]

/** What the canvas draws when the source tag has no sample value, or one the format cannot carry. */
const FALLBACK_SAMPLES: Record<string, string> = {
  code128: 'CPN400012345678', code39: 'SAVE-20', ean13: '400638133393', upca: '03600029145', qr: 'https://shop.example.com/c/SAVE20-7K3Q',
}

// ---------------------------------------------------------------- values
function digitsWithCheck(value: string, length: number): boolean {
  if (!/^\d+$/.test(value) || (value.length !== length && value.length !== length - 1)) return false
  if (value.length === length - 1) return true
  const body = value.slice(0, -1).split('').reverse()
  const total = body.reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (total % 10)) % 10 === Number(value.at(-1))
}

/** null when the value can be drawn in the block's format, else why not. The server applies the same rules. */
export function valueProblem(config: CodeConfig, value: string): string | null {
  if (value === '') return 'no value'
  if (config.kind === 'qr') return value.length <= 1000 ? null : 'longer than 1000 characters'
  switch (config.format) {
    case 'code39':
      return /^[0-9A-Z \-.$/+%]{1,43}$/.test(value.toUpperCase()) ? null : 'Code 39 takes letters, digits and - . $ / + % space'
    case 'ean13':
      return digitsWithCheck(value, 13) ? null : 'EAN-13 needs 12 digits, or 13 with a correct check digit'
    case 'upca':
      return digitsWithCheck(value, 12) ? null : 'UPC-A needs 11 digits, or 12 with a correct check digit'
    default:
      return value.length <= 80 && /^[\x20-\x7e]+$/.test(value) ? null : 'Code 128 takes up to 80 plain characters'
  }
}

/**
 * The value the canvas shows: the source tag's sample, else a stand-in the format can draw. `problem` says when the
 * tag's own sample does not fit the format, because recipients with values like it would get no code.
 */
export function sampleFor(config: CodeConfig, tags: PersonalizationTag[]): { value: string; problem: string | null } {
  const tag = tags.find((item) => item.tag_key.replace(/[{} ]/g, '') === config.source)
  const sample = tag?.sample_value?.trim() ?? ''
  const fallback = FALLBACK_SAMPLES[config.kind === 'qr' ? 'qr' : (config.format ?? 'code128')]
  if (sample === '') return { value: fallback, problem: null }
  const problem = valueProblem(config, sample)
  if (problem === null) return { value: sample, problem: null }
  return {
    value: fallback,
    problem: `${tag?.label ?? config.source}'s sample value (${sample}) cannot be drawn: ${problem}. Recipients with values like it will get the email without this block.`,
  }
}

export const sampleValueFor = (config: CodeConfig, tags: PersonalizationTag[]) => sampleFor(config, tags).value

// ---------------------------------------------------------------- markup
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function dimensionsOf(config: CodeConfig): { width: number; height: number } {
  return config.kind === 'qr' ? { width: config.size ?? 180, height: config.size ?? 180 } : { width: config.width ?? 300, height: config.height ?? 80 }
}

/** What is kept between the comments: only the settings the kind uses, so the stored JSON stays small and plain. */
function stored(config: CodeConfig): Record<string, unknown> {
  const shared = { kind: config.kind, source: config.source, text: config.text, align: config.align, background: config.background }
  return config.kind === 'qr' ? { ...shared, ecc: config.ecc, size: config.size } : { ...shared, format: config.format, width: config.width, height: config.height }
}

/** The table the code sits in, as the email will lay it out (the server builds the same one around the real code). */
function codeBody(config: CodeConfig, sample: string, src: string): string {
  const { width, height } = dimensionsOf(config)
  const shown = escapeHtml(sample)
  const background = config.background ? `background:${config.background};` : ''
  const number = config.text ? `<div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;letter-spacing:2px;color:#0f172a;padding-top:6px;">${shown}</div>` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;${background}">`
    + `<tr><td align="${config.align}" style="padding:16px 24px;text-align:${config.align};">`
    + `<img src="${escapeHtml(src)}" width="${width}" height="${height}" alt="${shown}" style="display:inline-block;width:${width}px;height:${height}px;max-width:100%;border:0;outline:none;text-decoration:none;" />`
    + `${number}</td></tr></table>`
}

/** What the opening comment holds: the marker and the settings. */
const openingOf = (config: CodeConfig) => ` CEP:CODE ${JSON.stringify(stored(config))} `
const CLOSING = ' CEP:CODE_END '

/** The region: the settings, and the code of `sample` between the two markers. */
export function codeRegion(config: CodeConfig, sample: string, src: string): string {
  return `<!--${openingOf(config)}-->${codeBody(config, sample, src)}<!--${CLOSING}-->`
}

export function codeMjml(config: CodeConfig, sample: string, src: string): string {
  return `<mj-raw css-class="${CODE_CSS_CLASS} ${CODE_CSS_CLASS}-${config.kind}">${codeRegion(config, sample, src)}</mj-raw>`
}

/**
 * A stand-in drawn in the browser while the real sample is fetched, and for good where there is no server (the
 * playground). Bars or modules in the right proportions, not a code anyone could scan.
 */
export function placeholderSrc(config: CodeConfig, sample = ''): string {
  const { width, height } = dimensionsOf(config)
  let shapes = ''
  if (config.kind === 'qr') {
    const cells = 25
    const cell = width / cells
    let seed = [...sample].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)
    const finder = (x: number, y: number) =>
      `<rect x="${x * cell}" y="${y * cell}" width="${7 * cell}" height="${7 * cell}" fill="#0f172a"/><rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/><rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#0f172a"/>`
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const inFinder = (x < 8 && y < 8) || (x > cells - 9 && y < 8) || (x < 8 && y > cells - 9)
        seed = (seed * 1103515245 + 12345) >>> 0
        if (!inFinder && seed % 2 === 0) shapes += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#0f172a"/>`
      }
    }
    shapes += finder(0, 0) + finder(cells - 7, 0) + finder(0, cells - 7)
  } else {
    let x = 12
    let seed = [...(sample || 'CEP')].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)
    while (x < width - 14) {
      seed = (seed * 1103515245 + 12345) >>> 0
      const bar = 1 + (seed % 3)
      shapes += `<rect x="${x}" y="6" width="${bar}" height="${height - 12}" fill="#0f172a"/>`
      x += bar + 1 + ((seed >> 4) % 3)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${shapes}</svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/** A sampler for where there is no server (the playgrounds): the value checked by the same rules, drawn as the stand-in. */
export async function offlineSample(request: CodeSampleRequest): Promise<CodeSample> {
  const config: CodeConfig = request.kind === 'qr'
    ? { ...QR_DEFAULTS, ecc: request.ecc as QrLevel, size: request.size }
    : { ...BARCODE_DEFAULTS, format: request.format as BarcodeFormat, width: request.width, height: request.height }
  const problem = valueProblem(config, request.value)
  return problem ? { valid: false, message: `The sample value cannot be drawn: ${problem}.` } : { valid: true, url: placeholderSrc(config, request.value) }
}

// ---------------------------------------------------------------- reading and writing a block
/** The settings a stored region carries, filled out with the kind's defaults; null when it is not a code block. */
export function parseCodeConfig(html: string): CodeConfig | null {
  const match = REGION.exec(html)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1]) as Partial<CodeConfig>
    const defaults = raw.kind === 'qr' ? QR_DEFAULTS : BARCODE_DEFAULTS
    return { ...defaults, ...raw, kind: raw.kind === 'qr' ? 'qr' : 'barcode' }
  } catch {
    return null
  }
}

/** The src the block shows now, so a settings change can keep the picture until the new sample arrives. */
export function shownSrc(html: string): string | null {
  const region = REGION.exec(html)?.[0] ?? ''
  const found = /<img[^>]*\ssrc="([^"]*)"/.exec(region)?.[1]
  return found ? found.replace(/&amp;/g, '&') : null
}

/** The value the block shows now: its image's alt text is the sample. */
export function shownSample(html: string): string | null {
  const region = REGION.exec(html)?.[0] ?? ''
  const found = /<img[^>]*\salt="([^"]*)"/.exec(region)?.[1]
  return found === undefined ? null : found.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export function isCodeBlock(component: Component | null | undefined): boolean {
  return component?.get('type') === CODE_TYPE
}

function htmlOf(component: Component): string {
  return typeof component.toHTML === 'function' ? component.toHTML() : String(component.get('content') ?? '')
}

export function codeConfigOf(component: Component): CodeConfig | null {
  return parseCodeConfig(htmlOf(component))
}

export function codeSrcOf(component: Component): string | null {
  return shownSrc(htmlOf(component))
}

/** Writes the block again from its settings: its content is never edited in place. */
export function writeCode(component: Component, config: CodeConfig, sample: string, src: string): void {
  // the comments go in as components: parsed from a string, GrapesJS drops a comment that comes first
  component.components([{ type: 'comment', content: openingOf(config) }, codeBody(config, sample, src), { type: 'comment', content: CLOSING }])
}

/** The name the Layers panel and the inspector's heading give the block. */
export const codeName = (config: CodeConfig | null) => (config?.kind === 'qr' ? 'QR Code' : 'Barcode')

export function registerCodeType(editor: Editor): void {
  const raw = editor.Components.getType('mj-raw')?.model.prototype as { init?: (this: Component) => void } | undefined
  editor.Components.addType(CODE_TYPE, {
    extend: 'mj-raw',
    isComponent: (el: HTMLElement) => el.tagName === 'MJ-RAW' && (el.getAttribute('css-class') ?? '').split(/\s+/).includes(CODE_CSS_CLASS),
    model: {
      defaults: { editable: false, droppable: false },
      init(this: Component) {
        raw?.init?.call(this)
        this.components().forEach(makeInert)
        this.listenTo(this.components(), 'add', makeInert)
      },
    },
  })
}
