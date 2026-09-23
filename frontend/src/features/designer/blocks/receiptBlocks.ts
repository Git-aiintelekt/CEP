/**
 * The six blocks an E-Receipt's outer design is built from. Each is a whole mj-section with a css-class of its
 * own, registered as a type of its own, so it gets the receipt's constrained settings while the Email editor's
 * mj-section, mj-button, mj-image and mj-divider stay exactly as they are.
 *
 * Everything inside a block is part of it: nothing within is selected, dragged or edited on its own. The panel
 * edits the parts, which is what keeps these blocks to the few choices a receipt allows.
 */
import type { Component, Editor } from 'grapesjs'

import { ASSET_IMAGE_TOKEN, BRAND, BUTTON_RADIUS, RECEIPT_SWATCHES } from './brand'
import { RECEIPT_SLOT_TYPE, makeInert } from './receiptSlot'
import type { CepBlock } from './types'

export const RECEIPT_BRAND_HEADER_TYPE = 'cep-receipt-brand-header'
export const RECEIPT_MARKETING_TYPE = 'cep-marketing'
export const RECEIPT_BUTTON_TYPE = 'cep-receipt-button'
export const RECEIPT_IMAGE_TYPE = 'cep-receipt-image'
export const RECEIPT_DIVIDER_TYPE = 'cep-receipt-divider'
export const RECEIPT_FOOTER_TYPE = 'cep-receipt-footer'

/** Each type is found by the css-class of the same name. */
export const RECEIPT_FOOTER_CLASS = RECEIPT_FOOTER_TYPE

export const RECEIPT_BLOCK_TYPES = [
  RECEIPT_BRAND_HEADER_TYPE, RECEIPT_MARKETING_TYPE, RECEIPT_BUTTON_TYPE, RECEIPT_IMAGE_TYPE, RECEIPT_DIVIDER_TYPE, RECEIPT_FOOTER_TYPE,
] as const

/** Every receipt type that sits directly in mj-body, the slot included: each counts as a section. */
export const RECEIPT_BODY_TYPES: ReadonlySet<string> = new Set([...RECEIPT_BLOCK_TYPES, RECEIPT_SLOT_TYPE])

/** The inner parts the panel edits, marked the same way. */
export const PART = {
  wordmark: 'cep-wordmark',
  tagline: 'cep-tagline',
  headline: 'cep-headline',
  body: 'cep-body',
  address: 'cep-sender-address',
} as const

/** Classes that carry a choice the MJML has no attribute for. */
export const ACCENT_CLASS = 'cep-accent'
export const OUTLINE_CLASS = 'cep-outline'
export const RATIO_CLASS_PREFIX = 'cep-ratio-'

export const DEFAULT_TEXT = {
  wordmark: 'YOUR BRAND',
  tagline: 'Thanks for shopping with us',
  headline: 'Your next favorite is waiting',
  body: 'Members earn points on every order. Show this receipt in store for 10% off your next visit.',
  button: 'View order status',
  address: 'Your company, 1 Example Street, Your city, 00000',
} as const

export const TRANSACTIONAL_LINE = 'This is a transactional receipt for a purchase you made.'

/** The tagline sits at 78% white over whichever brand bar colour is chosen, all four of which are dark. */
export const TAGLINE_COLOR = 'rgba(255,255,255,0.78)'

const SECTION = `background-color="${BRAND.surface}" padding="8px 24px"`

export function taglineMjml(text: string, align: string): string {
  return `<mj-text css-class="${PART.tagline}" font-size="13px" line-height="20px" color="${TAGLINE_COLOR}" align="${align}" padding="4px 0 0">${text}</mj-text>`
}

const brandHeader: CepBlock = {
  id: 'receipt-brand-header',
  label: 'Brand header',
  category: 'brand',
  icon: 'PanelTop',
  mjml: `<mj-section css-class="${RECEIPT_BRAND_HEADER_TYPE}" background-color="${RECEIPT_SWATCHES[1].value}" padding="24px">
    <mj-column>
      <mj-text css-class="${PART.wordmark}" font-size="20px" line-height="28px" font-weight="700" color="#ffffff" letter-spacing="0.5px" align="left" padding="0">${DEFAULT_TEXT.wordmark}</mj-text>
      ${taglineMjml(DEFAULT_TEXT.tagline, 'left')}
    </mj-column>
  </mj-section>`,
}

const marketing: CepBlock = {
  id: 'receipt-marketing',
  label: 'Marketing',
  category: 'content',
  icon: 'Megaphone',
  mjml: `<mj-section css-class="${RECEIPT_MARKETING_TYPE}" ${SECTION}>
    <mj-column padding="0">
      <mj-text css-class="${PART.headline}" font-size="24px" line-height="32px" font-weight="700" color="${BRAND.heading}" align="left" padding="0 0 8px">${DEFAULT_TEXT.headline}</mj-text>
      <mj-text css-class="${PART.body}" font-size="15px" line-height="24px" color="${BRAND.body}" align="left" padding="0">${DEFAULT_TEXT.body}</mj-text>
    </mj-column>
  </mj-section>`,
}

/** Destinations are fixed choices, never typed: the href carries the option's code until real addresses exist. */
const receiptButton: CepBlock = {
  id: 'receipt-button',
  label: 'Button',
  category: 'content',
  icon: 'MousePointerClick',
  mjml: `<mj-section css-class="${RECEIPT_BUTTON_TYPE}" ${SECTION}>
    <mj-column>
      <mj-button href="#order-status" background-color="${BRAND.action}" color="#ffffff" border="1px solid ${BRAND.action}" border-radius="${BUTTON_RADIUS}" font-size="15px" font-weight="700" inner-padding="12px 24px" align="left" padding="0">${DEFAULT_TEXT.button}</mj-button>
    </mj-column>
  </mj-section>`,
}

const receiptImage: CepBlock = {
  id: 'receipt-image',
  label: 'Image',
  category: 'content',
  icon: 'Image',
  mjml: `<mj-section css-class="${RECEIPT_IMAGE_TYPE} ${RATIO_CLASS_PREFIX}16x9" ${SECTION}>
    <mj-column>
      <mj-image src="${ASSET_IMAGE_TOKEN}" alt="" padding="0"></mj-image>
    </mj-column>
  </mj-section>`,
}

const receiptDivider: CepBlock = {
  id: 'receipt-divider',
  label: 'Divider',
  category: 'structure',
  icon: 'Minus',
  mjml: `<mj-section css-class="${RECEIPT_DIVIDER_TYPE}" ${SECTION}>
    <mj-column>
      <mj-divider border-width="1px" border-color="${BRAND.line}" padding="0"></mj-divider>
    </mj-column>
  </mj-section>`,
}

/** No unsubscribe link: a receipt is transactional. The postal address is still required, so it ships with one. */
const receiptFooter: CepBlock = {
  id: 'receipt-footer',
  label: 'Footer',
  category: 'brand',
  icon: 'AlignCenter',
  mjml: `<mj-section css-class="${RECEIPT_FOOTER_CLASS}" background-color="${BRAND.page}" border-top="1px solid ${BRAND.line}" padding="16px 24px">
    <mj-column>
      <mj-text css-class="${PART.address}" font-size="12px" line-height="18px" color="${BRAND.muted}" align="center" padding="0 0 4px">${DEFAULT_TEXT.address}</mj-text>
      <mj-text font-size="12px" line-height="18px" color="${BRAND.muted}" align="center" padding="0">${TRANSACTIONAL_LINE}</mj-text>
    </mj-column>
  </mj-section>`,
}

/** The palette for E-Receipt, in the order its three-column grid shows it. */
export const RECEIPT_BLOCKS: CepBlock[] = [brandHeader, marketing, receiptButton, receiptFooter, receiptImage, receiptDivider]

/** Whether compiled or stored MJML carries the receipt footer: the sender's address check reads this. */
export function hasReceiptFooter(mjml: string): boolean {
  return new RegExp(`css-class="[^"]*\\b${RECEIPT_FOOTER_CLASS}\\b`).test(mjml)
}

function classesOf(el: HTMLElement): string[] {
  return (el.getAttribute?.('css-class') ?? '').split(/\s+/)
}

/** A block's parts, once more after an edit: text written into a part arrives as new children. */
export function lockParts(block: Component): void {
  block.components().forEach(makeInert)
}

/** What grapesjs-mjml's own mj-body accepts, should its defaults ever be unreadable. */
const PLUGIN_BODY_CHILDREN = ['mj-section', 'mj-wrapper', 'mj-hero', 'mj-raw'].map((type) => `[data-gjs-type="${type}"]`).join(', ')

export function registerReceiptBlockTypes(editor: Editor, { channel }: { channel: string }): void {
  if (channel !== 'E_RECEIPT') return
  const section = editor.Components.getType('mj-section')?.model.prototype as { init?: (this: Component) => void } | undefined

  for (const type of RECEIPT_BLOCK_TYPES) {
    editor.Components.addType(type, {
      extend: 'mj-section',
      isComponent: (el: HTMLElement) => el.tagName === 'MJ-SECTION' && classesOf(el).includes(type),
      model: {
        defaults: { droppable: false, stylable: false },
        init(this: Component) {
          section?.init?.call(this)
          lockParts(this)
          this.listenTo(this.components(), 'add', makeInert)
        },
      },
    })
  }

  // the plugin's body takes children by type, so the receipt's own section types have to be added to that list
  const body = editor.Components.getType('mj-body')?.model.prototype as { defaults?: unknown } | undefined
  const defaults = (typeof body?.defaults === 'function' ? body.defaults() : body?.defaults) as { droppable?: unknown } | undefined
  const accepted = typeof defaults?.droppable === 'string' ? defaults.droppable : PLUGIN_BODY_CHILDREN
  const receipt = RECEIPT_BLOCK_TYPES.map((type) => `[data-gjs-type="${type}"]`).join(', ')
  editor.Components.addType('mj-body', { model: { defaults: { droppable: `${accepted}, ${receipt}` } } })
}
