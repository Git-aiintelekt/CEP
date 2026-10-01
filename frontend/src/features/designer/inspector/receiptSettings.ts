/**
 * The E-Receipt blocks' settings. Most of them live on a part inside the block — the wordmark, the headline, the
 * button — or are a choice that sets several attributes at once, so each key reads and writes through its own
 * accessor here rather than the attribute map. settings.ts asks here first and falls back to the attribute map.
 */
import type { Component } from 'grapesjs'

import { ASSET_IMAGE_TOKEN, BRAND, BRAND_TINT, RECEIPT_SWATCHES } from '../blocks/brand'
import {
  ACCENT_CLASS, DEFAULT_TEXT, OUTLINE_CLASS, PART, RATIO_CLASS_PREFIX, RECEIPT_BRAND_HEADER_TYPE, RECEIPT_BUTTON_TYPE,
  RECEIPT_DIVIDER_TYPE, RECEIPT_FOOTER_TYPE, RECEIPT_IMAGE_TYPE, RECEIPT_MARKETING_TYPE, lockParts, taglineMjml,
} from '../blocks/receiptBlocks'
import { hasCssClass, setCssClass } from '../blocks/register'
import type { ReceiptLayoutPreset } from '@/lib/types'

import type { SelectOption } from './fields/options'

export interface ReceiptAccessor {
  read: (block: Component) => string | null
  /** null is Reset: the block's own default comes back */
  write: (block: Component, value: string | null) => void
}

export const DESTINATIONS: SelectOption[] = [
  { value: 'order-status', label: 'Order Status Page' },
  { value: 'outerwear', label: 'Outerwear Category' },
  { value: 'loyalty', label: 'Loyalty Hub' },
  { value: 'returns', label: 'Start a Return' },
]
export const BUTTON_STYLES: SelectOption[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'outline', label: 'Outline' },
]
export const TREATMENTS: SelectOption[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'accent', label: 'Accent' },
]
export const RATIOS: SelectOption[] = [
  { value: '16x9', label: '16:9' },
  { value: '4x3', label: '4:3' },
  { value: '1x1', label: '1:1' },
]

/** The four tags the Marketing body offers one tap away. */
export const MARKETING_TAGS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'order_number', label: 'Order Number' },
  { key: 'order_total', label: 'Order Total' },
  { key: 'store_name', label: 'Store Name' },
]

export const SWATCHES = RECEIPT_SWATCHES.map((swatch) => ({ ...swatch }))

export const ALT_REQUIRED_HELP = 'Required — many receipt readers block images by default.'
export const DIVIDER_NOTE = 'Spacing is fixed by the design system, so the divider has no settings.'
export const FOOTER_NOTE = 'Transactional mail carries no unsubscribe link. The postal address is still required.'
export const NO_IMAGE_CALLOUT = 'No image yet. Choose one from your image library before sending.'
export type ReceiptSlotPreset = Exclude<ReceiptLayoutPreset, 'CUSTOM_HTML'>

/** What the receipt slot's panel shows and does. */
export interface ReceiptSlotControls {
  preset: ReceiptSlotPreset
  onPresetChange?: (preset: ReceiptSlotPreset) => void
  onOpenLayout?: () => void
}

export const OPEN_RECEIPT_LAYOUT_LABEL = 'Open Receipt Layout'
export const CURRENT_LAYOUT_LABEL = 'Current Layout'

export const RECEIPT_PRESETS: { value: ReceiptSlotPreset; label: string }[] = [
  { value: 'COMPACT', label: 'Compact' },
  { value: 'STANDARD', label: 'Standard' },
  { value: 'ITEMIZED', label: 'Itemized' },
  { value: 'REGISTER', label: 'Store Register' },
]

export const RECEIPT_SLOT_NOTE = 'This slot is fixed. The itemized receipt is built in Receipt Layout and inserted here.'

/** Works for a Backbone collection and for a plain array, so tests can use ordinary objects. */
function children(component: Component): Component[] {
  const kids = component.components?.() as unknown as { map?: (fn: (child: Component) => Component) => Component[] } | undefined
  return typeof kids?.map === 'function' ? kids.map((child) => child) : []
}

function tagOf(component: Component): string {
  return String(component.get('tagName') ?? component.get('type') ?? '')
}

function find(block: Component, match: (component: Component) => boolean): Component | undefined {
  for (const child of children(block)) {
    if (match(child)) return child
    const found = find(child, match)
    if (found) return found
  }
  return undefined
}

const part = (block: Component, name: string) => find(block, (component) => hasCssClass(component, name))
const ofTag = (block: Component, tag: string) => find(block, (component) => tagOf(component) === tag)

/** Words as they read, a line break for each <br>. */
function textOf(component: Component | undefined): string | null {
  if (!component) return null
  const walk = (node: Component): string =>
    tagOf(node) === 'br' ? '\n' : String(node.get('content') ?? '') + children(node).map(walk).join('')
  const text = walk(component).trim()
  return text === '' ? null : text
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

function writeText(block: Component, target: Component | undefined, text: string): void {
  if (!target) return
  target.components(text.replace(/[&<>]/g, (character) => ESCAPES[character]).replace(/\r?\n/g, '<br />'))
  lockParts(block)
}

const attribute = (component: Component | undefined, key: string) => {
  const value = component?.getAttributes()[key]
  return value === undefined || value === null || value === '' ? null : String(value)
}

function words(name: string, fallback: string): ReceiptAccessor {
  return {
    read: (block) => textOf(part(block, name)),
    write: (block, value) => writeText(block, part(block, name), value ?? fallback),
  }
}

/** The alignment of the block's words, set on each of its text parts together. */
function alignOf(names: string[]): ReceiptAccessor {
  return {
    read: (block) => attribute(part(block, names[0]), 'align') ?? 'left',
    write: (block, value) => {
      for (const name of names) part(block, name)?.addAttributes({ align: value ?? 'left' })
    },
  }
}

/** A tagline hidden and shown again comes back as it was, for as long as the page is open. */
const hiddenTaglines = new WeakMap<Component, string>()

const tagline: ReceiptAccessor = {
  read: (block) => (part(block, PART.tagline) ? 'tagline' : null),
  write: (block, value) => {
    const line = part(block, PART.tagline)
    if (value === null) {
      if (!line) return
      hiddenTaglines.set(block, textOf(line) ?? DEFAULT_TEXT.tagline)
      line.remove()
      return
    }
    const wordmark = part(block, PART.wordmark)
    if (line || !wordmark?.parent()) return
    const text = hiddenTaglines.get(block) ?? DEFAULT_TEXT.tagline
    wordmark.parent()?.components().add(taglineMjml(text, attribute(wordmark, 'align') ?? 'left'), { at: wordmark.index() + 1 })
    lockParts(block)
  },
}

const TREATMENT = {
  plain: {
    column: { 'background-color': '', 'border-radius': '', padding: '0' },
    headline: { 'font-size': '24px', 'line-height': '32px', color: BRAND.heading },
  },
  accent: {
    column: { 'background-color': BRAND_TINT.background, 'border-radius': '8px', padding: '20px' },
    headline: { 'font-size': '18px', 'line-height': '26px', color: BRAND_TINT.text },
  },
} as const

/** Empty values are removed rather than written, so Plain leaves no trace of the card. */
function setAttributes(component: Component | undefined, values: Record<string, string>): void {
  if (!component) return
  const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
  const cleared = Object.keys(values).filter((key) => values[key] === '')
  if (cleared.length > 0) component.removeAttributes(cleared)
  component.addAttributes(set)
}

const treatment: ReceiptAccessor = {
  read: (block) => (hasCssClass(block, ACCENT_CLASS) ? 'accent' : 'plain'),
  write: (block, value) => {
    const chosen = value === 'accent' ? 'accent' : 'plain'
    setCssClass(block, ACCENT_CLASS, chosen === 'accent')
    setAttributes(ofTag(block, 'mj-column'), TREATMENT[chosen].column)
    setAttributes(part(block, PART.headline), TREATMENT[chosen].headline)
  },
}

const BUTTON_LOOK = {
  primary: { 'background-color': BRAND.action, color: '#ffffff', border: `1px solid ${BRAND.action}` },
  outline: { 'background-color': BRAND.surface, color: BRAND.action, border: `1px solid ${BRAND.action}` },
} as const

const buttonStyle: ReceiptAccessor = {
  read: (block) => (hasCssClass(block, OUTLINE_CLASS) ? 'outline' : 'primary'),
  write: (block, value) => {
    const chosen = value === 'outline' ? 'outline' : 'primary'
    setCssClass(block, OUTLINE_CLASS, chosen === 'outline')
    ofTag(block, 'mj-button')?.addAttributes(BUTTON_LOOK[chosen])
  },
}

const destination: ReceiptAccessor = {
  read: (block) => {
    const code = (attribute(ofTag(block, 'mj-button'), 'href') ?? '').replace(/^#/, '')
    return DESTINATIONS.some((option) => option.value === code) ? code : null
  },
  write: (block, value) => ofTag(block, 'mj-button')?.addAttributes({ href: `#${value ?? DESTINATIONS[0].value}` }),
}

const buttonLabel: ReceiptAccessor = {
  read: (block) => textOf(ofTag(block, 'mj-button')),
  write: (block, value) => writeText(block, ofTag(block, 'mj-button'), value ?? DEFAULT_TEXT.button),
}

const buttonAlign: ReceiptAccessor = {
  read: (block) => attribute(ofTag(block, 'mj-button'), 'align') ?? 'left',
  write: (block, value) => ofTag(block, 'mj-button')?.addAttributes({ align: value ?? 'left' }),
}

/** Recorded on the block for the crop a later step makes: a fixed height would stretch the picture on phones. */
const ratio: ReceiptAccessor = {
  read: (block) => RATIOS.find((option) => hasCssClass(block, `${RATIO_CLASS_PREFIX}${option.value}`))?.value ?? null,
  write: (block, value) => {
    for (const option of RATIOS) setCssClass(block, `${RATIO_CLASS_PREFIX}${option.value}`, option.value === (value ?? RATIOS[0].value))
  },
}

function imageAttribute(key: string): ReceiptAccessor {
  return {
    // as readSetting does: an empty attribute is no picture, never the stand-in GrapesJS keeps in the src property
    read: (block) => {
      const image = ofTag(block, 'mj-image')
      const raw = image?.getAttributes()[key] ?? (key === 'src' ? image?.get('src') : undefined)
      return raw === undefined || raw === null || raw === '' ? null : String(raw)
    },
    write: (block, value) => {
      const image = ofTag(block, 'mj-image')
      if (!image) return
      if (value === null) image.removeAttributes(key)
      else image.addAttributes({ [key]: value })
    },
  }
}

const ACCESSORS: Record<string, Record<string, ReceiptAccessor>> = {
  [RECEIPT_BRAND_HEADER_TYPE]: {
    wordmark: words(PART.wordmark, DEFAULT_TEXT.wordmark),
    tagline,
    align: alignOf([PART.wordmark, PART.tagline]),
  },
  [RECEIPT_MARKETING_TYPE]: {
    headline: words(PART.headline, DEFAULT_TEXT.headline),
    body: words(PART.body, DEFAULT_TEXT.body),
    treatment,
    align: alignOf([PART.headline, PART.body]),
  },
  [RECEIPT_BUTTON_TYPE]: {
    'button-label': buttonLabel,
    destination,
    'button-style': buttonStyle,
    align: buttonAlign,
  },
  [RECEIPT_IMAGE_TYPE]: {
    src: imageAttribute('src'),
    alt: imageAttribute('alt'),
    ratio,
  },
  [RECEIPT_FOOTER_TYPE]: {
    'sender-address': words(PART.address, DEFAULT_TEXT.address),
  },
}

export function receiptAccessor(type: string, key: string): ReceiptAccessor | undefined {
  return ACCESSORS[type]?.[key]
}

/** The line a receipt block shows above its settings, or null. The image's depends on whether it has one yet. */
export function receiptCallout(type: string, component: Component): string | null {
  if (type === RECEIPT_DIVIDER_TYPE) return DIVIDER_NOTE
  if (type === RECEIPT_FOOTER_TYPE) return FOOTER_NOTE
  if (type === RECEIPT_IMAGE_TYPE) {
    // GrapesJS fills an empty src with an inline SVG of its own: that is a stand-in, not a picture
    const src = imageAttribute('src').read(component)
    return src === null || src.includes(ASSET_IMAGE_TOKEN) || src.trimStart().startsWith('<') ? NO_IMAGE_CALLOUT : null
  }
  return null
}
