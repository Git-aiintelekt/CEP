/**
 * The one seam that reads and writes MJML settings on a component.
 *
 * Everything except an image's src lives in the component's attribute map, and the plugin keeps that map and the
 * style object as mirrors of each other, so addAttributes is the whole story. component.set(key, value) is never
 * used: it changes nothing the canvas or the MJML can see, yet still marks the design dirty.
 *
 * The value a reader ends up with is not what the canvas draws. Each block previews itself by compiling a
 * miniature MJML document that has no mj-head, so mj-attributes never reach it: the canvas can show 13px where
 * the email sends 15px. readEffective answers for the email, which is the one that gets delivered.
 */
import type { Component } from 'grapesjs'

import { HIDE_DESKTOP_CLASS, HIDE_MOBILE_CLASS, isHiddenOnDesktop, isHiddenOnPhones, setCssClass, SHADOW_LEVELS, setShadow, shadowOf } from '../blocks/register'
import {
  RECEIPT_BRAND_HEADER_TYPE, RECEIPT_BUTTON_TYPE, RECEIPT_DIVIDER_TYPE, RECEIPT_FOOTER_TYPE, RECEIPT_IMAGE_TYPE, RECEIPT_MARKETING_TYPE,
} from '../blocks/receiptBlocks'
import { normaliseHex } from './fields/color/colorMath'
import type { LengthUnit } from './fields/length'
import { EMPTY_PADDING, parsePadding, type Padding } from './fields/padding'
import { SPACING_PROP, ZERO_PADDING, shorthand, spacingFrom, spacingToStore, sumSpacing, type Spacing } from './spacing'
import { CODE_TYPE } from '../blocks/codes'
import { codeFieldsFor, isCodeKey, readCodeSetting, writeCodeSetting } from './codeSettings'
import { ALT_REQUIRED_HELP, MARKETING_TAGS, SWATCHES, receiptAccessor } from './receiptSettings'
import { directName, networkOf, ownIconAttributes, socialElementMjml } from './social'
import {
  CUSTOM_ALIGN_KEY, CUSTOM_BACKGROUND_KEY, CUSTOM_MARGIN_KEY, CUSTOM_PADDING_KEY, CUSTOM_WIDTH_KEY, isCustomHtmlKey, readCustomHtml, readCustomHtmlMarkup,
  writeCustomHtml, writeCustomHtmlMarkup,
} from './customHtmlSettings'
import { STACKING_HELP, STACKING_KEY, STACKING_LABEL, readStacking, writeStacking } from './stacking'
import { LINK_COLOR_KEY, LINK_UNDERLINE_KEY, isLinkStyleKey, readLinkStyle, writeLinkStyle } from './linkStyle'

// one implementation, shared with the colour field: #ABC and #AABBCC both become #aabbcc
export { normaliseHex }

export type SettingKind =
  | 'color' | 'length' | 'padding' | 'align' | 'valign' | 'toggle' | 'select' | 'text' | 'link' | 'image' | 'swatch'
  /** a Custom HTML block's markup, written as-is */
  | 'html'
  /** a social block's add-a-network list */
  | 'networks'

/** Where a setting belongs in the panel: what it says, where it sits, how it looks. */
export type SettingSection = 'content' | 'layout' | 'appearance'

export interface SettingField {
  key: string
  label: string
  kind: SettingKind
  section: SettingSection
  /** filled in by fieldsFor from ATTRIBUTE_RULES, so it can never drift from what MJML accepts */
  units?: readonly LengthUnit[]
  min?: number
  max?: number
  step?: number
  help?: string
  /** a swatch field's fixed colours: the only values it can write */
  swatches?: { value: string; label: string }[]
  /** an align field limited to these of its options */
  only?: string[]
  /** a select with no empty "Default" row: the block always has one of the options */
  required?: boolean
  /** what a select's empty row says when "Default" would not: "None" for a border style or a shadow */
  emptyLabel?: string
  /** several lines of words, entered in a text area */
  multiline?: boolean
  /** tags offered as one-tap chips under a text area */
  quickTags?: { key: string; label: string }[]
}

/** A button's label and an mj-text's words are component content, not an attribute. */
export const LABEL_KEY = 'label'
export const SRC_KEY = 'src'
/** A Custom HTML block's markup: its children, read and written as HTML rather than as text. */
export const HTML_KEY = 'html'
/** The social block's add-a-network list. Not a value the block holds: the panel's name for the control. */
export const NETWORKS_KEY = 'cep-add-network'
/**
 * A block's margin: the space outside it. MJML has no margin and email clients drop CSS margins, so the email gets
 * margin plus padding as its one `padding`; the split lives on the component (spacing.ts). The panel's name, never an attribute.
 * A button is the exception: its MJML padding is already the space around it, so its Margin is that attribute and its
 * Padding is MJML's inner-padding.
 */
export const MARGIN_KEY = 'cep-margin'
export const MARGIN_HELP = 'Space outside the block. The email gets margin and padding added together.'
/** mj-social-element's network. The attribute may carry MJML's "-noshare" suffix; the panel shows the network alone. */
const NETWORK_KEY = 'name'

/**
 * Hiding on phones is a css-class, not an MJML attribute, so it is read and written through that list rather
 * than through the attribute map. The key is the panel's own name for it and never reaches the email.
 */
export const HIDE_MOBILE_KEY = 'cep-hide-on-phones'
/** the other side of the breakpoint: phones alone show the block */
export const HIDE_DESKTOP_KEY = 'cep-hide-on-desktop'

// ---------------------------------------------------------------- border: three fields over MJML's one border attribute
export const BORDER_WIDTH_KEY = 'cep-border-width'
export const BORDER_STYLE_KEY = 'cep-border-style'
export const BORDER_COLOR_KEY = 'cep-border-color'
const BORDER_KEYS: readonly string[] = [BORDER_WIDTH_KEY, BORDER_STYLE_KEY, BORDER_COLOR_KEY]
const BORDER_STYLE_NAMES: readonly string[] = ['solid', 'dashed', 'dotted', 'double']
const BORDER_FIELDS: SettingField[] = [
  { key: BORDER_WIDTH_KEY, label: 'Border Width', kind: 'length', section: 'appearance', min: 0 },
  { key: BORDER_STYLE_KEY, label: 'Border Style', kind: 'select', section: 'appearance', emptyLabel: 'None' },
  { key: BORDER_COLOR_KEY, label: 'Border Color', kind: 'color', section: 'appearance' },
]

// ---------------------------------------------------------------- shadow: a class and a head rule, MJML having no attribute
export const SHADOW_KEY = 'cep-shadow'
export const SHADOW_HELP = 'Drawn by Apple Mail, iOS Mail, Gmail and Outlook.com. Outlook for Windows leaves it out, so the design should read without it.'
const SHADOW: SettingField = { key: SHADOW_KEY, label: 'Shadow', kind: 'select', section: 'appearance', emptyLabel: 'None', help: SHADOW_HELP }

export type EffectiveSource = 'block' | 'mj-attributes' | 'mj-all' | 'mjml-default'

export interface EffectiveValue {
  value: string | null
  source: EffectiveSource
}

/**
 * MJML's own defaults for the settings we edit, taken from the installed mjml-browser's defaultAttributes.
 * settings.defaults.test.ts reads them back out of the package and fails if this drifts.
 */
const MJML_FONT = 'Ubuntu, Helvetica, Arial, sans-serif'

export const MJML_DEFAULTS: Record<string, Record<string, string>> = {
  'mj-body': { width: '600px' },
  'mj-section': { padding: '20px 0' },
  'mj-column': { 'vertical-align': 'top' },
  'mj-text': { align: 'left', color: '#000000', 'font-family': MJML_FONT, 'font-size': '13px', 'line-height': '1', padding: '10px 25px' },
  'mj-button': {
    align: 'center', 'background-color': '#414141', 'border-radius': '3px', color: '#ffffff', 'font-family': MJML_FONT, 'font-size': '13px',
    'inner-padding': '10px 25px', padding: '10px 25px', border: 'none',
  },
  'mj-image': { align: 'center', alt: '', border: '0', height: 'auto', padding: '10px 25px' },
  'mj-divider': { align: 'center', 'border-color': '#000000', 'border-width': '4px', padding: '10px 25px', width: '100%' },
  'mj-spacer': { height: '20px' },
  'mj-social': {
    align: 'center', 'border-radius': '3px', color: '#333333', 'font-family': MJML_FONT, 'font-size': '13px', 'icon-size': '20px',
    mode: 'horizontal', padding: '10px 25px',
  },
  'mj-social-element': { 'border-radius': '3px', color: '#000', 'font-size': '13px', padding: '4px' },
}

/** '' in units means the value may carry no unit at all, which is how MJML writes line-height. */
interface UnitRule {
  units: readonly string[]
  /** how many space-separated values are allowed (padding takes up to four) */
  parts?: number
}

type AttributeRule = UnitRule | 'color' | 'free'

const LENGTH: UnitRule = { units: ['px', '%'] }
const PX: UnitRule = { units: ['px'] }
/** an image's height: a pixel count, or MJML's own "auto" (which is what clearing the field gives) */
const PX_OR_AUTO: UnitRule = { units: ['px', 'auto'] }
const PADDING: UnitRule = { units: ['px', '%'], parts: 4 }
const LINE_HEIGHT: UnitRule = { units: ['px', '%', ''] }

/**
 * Mirrors mjml's allowedAttributes for the settings we edit; the same drift test checks it.
 *
 * px and % are the only length units here because they are the only ones MJML accepts (em, rem, vh and vw are
 * refused by its validator and by the server's renderer), and there is no margin: MJML lays blocks out with padding.
 */
export const ATTRIBUTE_RULES: Record<string, Record<string, AttributeRule>> = {
  'mj-body': { width: PX, 'background-color': 'color' },
  'mj-section': { 'background-color': 'color', padding: PADDING, 'border-radius': 'free', 'full-width': 'free', border: 'free' },
  'mj-raw': { [CUSTOM_WIDTH_KEY]: LENGTH, [CUSTOM_MARGIN_KEY]: PADDING, [CUSTOM_PADDING_KEY]: PADDING, [CUSTOM_BACKGROUND_KEY]: 'color', [CUSTOM_ALIGN_KEY]: 'free' },
  'mj-column': { width: LENGTH, 'background-color': 'color', padding: PADDING, 'vertical-align': 'free', 'border-radius': PADDING, border: 'free' },
  'mj-text': {
    'font-family': 'free', 'font-size': PX, color: 'color', align: 'free', 'line-height': LINE_HEIGHT, padding: PADDING, 'font-weight': 'free',
    'container-background-color': 'color',
  },
  'mj-button': {
    href: 'free', 'background-color': 'color', color: 'color', 'border-radius': 'free', padding: PADDING,
    'inner-padding': PADDING, align: 'free', width: LENGTH, height: LENGTH, 'font-family': 'free', 'font-size': PX, border: 'free',
  },
  'mj-image': {
    src: 'free', alt: 'free', href: 'free', align: 'free', width: PX, height: PX_OR_AUTO, 'max-height': LENGTH, padding: PADDING, 'border-radius': PADDING,
    'container-background-color': 'color', border: 'free',
  },
  'mj-divider': { 'border-color': 'color', 'border-width': PX, padding: PADDING, width: LENGTH, align: 'free', 'container-background-color': 'color' },
  'mj-spacer': { height: LENGTH, padding: PADDING, 'container-background-color': 'color' },
  'mj-social': {
    align: 'free', mode: 'free', 'icon-size': LENGTH, 'icon-padding': PADDING, padding: PADDING, 'border-radius': LENGTH, color: 'color',
    'font-family': 'free', 'font-size': PX, 'container-background-color': 'color',
  },
  'mj-social-element': {
    [NETWORK_KEY]: 'free', href: 'free', 'background-color': 'color', color: 'color', 'icon-size': LENGTH, padding: PADDING, 'border-radius': PX,
    'font-size': PX,
  },
  // an anchor written inside a text block: an HTML element, so nothing here is MJML's to validate
  link: { href: 'free', title: 'free' },
}

/** The one line shown instead of content fields for a block whose words are edited on the canvas. */
export const CANVAS_TEXT_NOTE = 'Edit the text on the canvas.'
/** Under it: how a link gets into the words, since that is the one thing the panel cannot do for a text block. */
export const TEXT_LINK_NOTE = 'To link some words, select them on the canvas and press the toolbar’s link button; then select the link to set its address.'
export const HTML_HELP = '<table role="presentation" width="100%"><tr><td>…</td></tr></table>'

export const ALT_HELP = "Describe the image for people who can't see it."

export const HIDE_MOBILE_LABEL = 'Hide on Phones'
export const HIDE_DESKTOP_LABEL = 'Hide on Desktop'
export const HIDE_DESKTOP_HELP = 'Phones alone show it. Outlook for Windows ignores this and shows it everywhere.'

/** Stacking is MJML's own doing below 480px, so it is something to say, not something to switch. */
export const STACK_NOTE = 'Columns stack on phones automatically.'

/** A closing line under a block's layout settings, for behaviour that has no field of its own. */
export const LAYOUT_NOTES: Record<string, string> = { 'mj-section': STACK_NOTE }

const MARGIN: SettingField = { key: MARGIN_KEY, label: 'Margin', kind: 'padding', section: 'layout', help: MARGIN_HELP }
/** Who sees the block: on every block, since a design often has a phones-only and a desktop-only version of a part. */
const VISIBILITY: SettingField[] = [
  { key: HIDE_MOBILE_KEY, label: HIDE_MOBILE_LABEL, kind: 'toggle', section: 'layout' },
  { key: HIDE_DESKTOP_KEY, label: HIDE_DESKTOP_LABEL, kind: 'toggle', section: 'layout', help: HIDE_DESKTOP_HELP },
]

/** Every setting a block offers, in the order the panel shows it. A heading block is an mj-text. */
export const SETTINGS_BY_BLOCK: Record<string, SettingField[]> = {
  'mj-body': [
    { key: 'width', label: 'Email Width', kind: 'length', section: 'layout', min: 320, max: 800 },
    { key: 'background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
  ],
  'mj-section': [
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'full-width', label: 'Full Width', kind: 'toggle', section: 'layout' },
    { key: STACKING_KEY, label: STACKING_LABEL, kind: 'select', section: 'layout', required: true, help: STACKING_HELP },
    ...VISIBILITY,
    { key: 'background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
    ...BORDER_FIELDS,
    SHADOW,
    { key: 'border-radius', label: 'Corner Radius', kind: 'length', section: 'appearance', min: 0 },
  ],
  'mj-column': [
    { key: 'width', label: 'Width', kind: 'length', section: 'layout', min: 0 },
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'vertical-align', label: 'Vertical Alignment', kind: 'valign', section: 'layout' },
    ...VISIBILITY,
    { key: 'background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
    ...BORDER_FIELDS,
    SHADOW,
    { key: 'border-radius', label: 'Corner Radius', kind: 'length', section: 'appearance', min: 0 },
  ],
  'mj-text': [
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    ...VISIBILITY,
    { key: 'font-family', label: 'Font Family', kind: 'select', section: 'appearance' },
    { key: 'font-size', label: 'Font Size', kind: 'length', section: 'appearance', min: 1 },
    { key: 'font-weight', label: 'Font Weight', kind: 'select', section: 'appearance' },
    { key: 'line-height', label: 'Line Height', kind: 'length', section: 'appearance', min: 0 },
    // MJML's container-background-color: the cell behind the block, which is what a background means on a content block
    { key: 'container-background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
    SHADOW,
    { key: 'color', label: 'Text Color', kind: 'color', section: 'appearance' },
  ],
  'mj-button': [
    { key: LABEL_KEY, label: 'Label', kind: 'text', section: 'content' },
    { key: 'href', label: 'Link', kind: 'link', section: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'width', label: 'Width', kind: 'length', section: 'layout', min: 0 },
    { key: 'height', label: 'Height', kind: 'length', section: 'layout', min: 0 },
    // a button's MJML padding is the space around it and inner-padding the space inside: Margin and Padding as people read them
    { key: 'padding', label: 'Margin', kind: 'padding', section: 'layout', help: 'Space outside the button.' },
    { key: 'inner-padding', label: 'Padding', kind: 'padding', section: 'layout', help: 'Space inside the button, around its label.' },
    ...VISIBILITY,
    { key: 'font-family', label: 'Font Family', kind: 'select', section: 'appearance' },
    { key: 'font-size', label: 'Font Size', kind: 'length', section: 'appearance', min: 1 },
    { key: 'background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
    ...BORDER_FIELDS,
    SHADOW,
    { key: 'color', label: 'Text Color', kind: 'color', section: 'appearance' },
    { key: 'border-radius', label: 'Corner Radius', kind: 'length', section: 'appearance', min: 0 },
  ],
  'mj-image': [
    { key: SRC_KEY, label: 'Image', kind: 'image', section: 'content' },
    { key: 'alt', label: 'Alt Text', kind: 'text', section: 'content', help: ALT_HELP },
    { key: 'href', label: 'Link', kind: 'link', section: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'width', label: 'Width', kind: 'length', section: 'layout', min: 0 },
    { key: 'height', label: 'Height', kind: 'length', section: 'layout', min: 0 },
    { key: 'max-height', label: 'Max Height', kind: 'length', section: 'layout', min: 0 },
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    ...VISIBILITY,
    { key: 'container-background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
    ...BORDER_FIELDS,
    SHADOW,
    { key: 'border-radius', label: 'Corner Radius', kind: 'length', section: 'appearance', min: 0 },
  ],
  'mj-divider': [
    { key: 'width', label: 'Width', kind: 'length', section: 'layout', min: 0 },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    ...VISIBILITY,
    { key: 'border-color', label: 'Line Color', kind: 'color', section: 'appearance' },
    { key: 'border-width', label: 'Line Width', kind: 'length', section: 'appearance', min: 0 },
    { key: 'container-background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
  ],
  'mj-spacer': [
    { key: 'height', label: 'Height', kind: 'length', section: 'layout', min: 0 },
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    ...VISIBILITY,
    { key: 'container-background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
  ],
  'mj-social': [
    { key: NETWORKS_KEY, label: 'Add a Network', kind: 'networks', section: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'mode', label: 'Layout', kind: 'select', section: 'layout' },
    { key: 'icon-size', label: 'Icon Size', kind: 'length', section: 'layout', min: 8 },
    { key: 'icon-padding', label: 'Icon Padding', kind: 'padding', section: 'layout' },
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    ...VISIBILITY,
    { key: 'border-radius', label: 'Icon Corner Radius', kind: 'length', section: 'appearance', min: 0 },
    { key: 'font-family', label: 'Label Font', kind: 'select', section: 'appearance' },
    { key: 'font-size', label: 'Label Size', kind: 'length', section: 'appearance', min: 1 },
    { key: 'color', label: 'Label Color', kind: 'color', section: 'appearance' },
    { key: 'container-background-color', label: 'Background Color', kind: 'color', section: 'appearance' },
  ],
  'mj-social-element': [
    { key: NETWORK_KEY, label: 'Network', kind: 'select', section: 'content', required: true },
    { key: 'href', label: 'Link', kind: 'link', section: 'content' },
    { key: LABEL_KEY, label: 'Label', kind: 'text', section: 'content', help: 'Shown beside the icon; leave empty for the icon alone' },
    { key: 'icon-size', label: 'Icon Size', kind: 'length', section: 'layout', min: 8 },
    MARGIN,
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'background-color', label: 'Icon Background', kind: 'color', section: 'appearance' },
    { key: 'border-radius', label: 'Icon Corner Radius', kind: 'length', section: 'appearance', min: 0 },
    { key: 'color', label: 'Label Color', kind: 'color', section: 'appearance' },
  ],
  link: [
    { key: 'href', label: 'Link', kind: 'link', section: 'content' },
    { key: 'title', label: 'Hover Text', kind: 'text', section: 'content' },
    { key: LINK_COLOR_KEY, label: 'Link Color', kind: 'color', section: 'appearance' },
    { key: LINK_UNDERLINE_KEY, label: 'Underline', kind: 'select', section: 'appearance', emptyLabel: 'Default (underlined)', help: 'Email apps underline a link unless told not to.' },
  ],
  'mj-raw': [
    { key: HTML_KEY, label: 'HTML', kind: 'html', section: 'content', help: HTML_HELP },
    { key: CUSTOM_WIDTH_KEY, label: 'Width', kind: 'length', section: 'layout', min: 0, help: 'Of the column or the email it sits in; empty is the full width.' },
    { key: CUSTOM_ALIGN_KEY, label: 'Alignment', kind: 'align', section: 'layout' },
    { key: CUSTOM_MARGIN_KEY, label: 'Margin', kind: 'padding', section: 'layout', help: 'Space outside the block.' },
    { key: CUSTOM_PADDING_KEY, label: 'Padding', kind: 'padding', section: 'layout' },
    ...VISIBILITY,
    { key: CUSTOM_BACKGROUND_KEY, label: 'Background Color', kind: 'color', section: 'appearance' },
  ],

  // E-Receipt: each block offers only the choices a receipt allows (receiptSettings.ts reads and writes them)
  [RECEIPT_BRAND_HEADER_TYPE]: [
    { key: 'wordmark', label: 'Wordmark Text', kind: 'text', section: 'content' },
    { key: 'tagline', label: 'Tagline', kind: 'toggle', section: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout', only: ['left', 'center'] },
    { key: 'background-color', label: 'Brand Bar Color', kind: 'swatch', section: 'appearance', swatches: SWATCHES },
  ],
  [RECEIPT_MARKETING_TYPE]: [
    { key: 'headline', label: 'Headline', kind: 'text', section: 'content' },
    { key: 'body', label: 'Body', kind: 'text', section: 'content', multiline: true, quickTags: MARKETING_TAGS },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'treatment', label: 'Treatment', kind: 'select', section: 'appearance', required: true },
  ],
  [RECEIPT_BUTTON_TYPE]: [
    { key: 'button-label', label: 'Label', kind: 'text', section: 'content' },
    { key: 'destination', label: 'Destination', kind: 'select', section: 'content', required: true },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'button-style', label: 'Style', kind: 'select', section: 'appearance', required: true },
  ],
  [RECEIPT_IMAGE_TYPE]: [
    { key: SRC_KEY, label: 'Image', kind: 'image', section: 'content' },
    { key: 'alt', label: 'Alt Text', kind: 'text', section: 'content', help: ALT_REQUIRED_HELP },
    { key: 'ratio', label: 'Ratio', kind: 'select', section: 'layout', required: true },
  ],
  [RECEIPT_DIVIDER_TYPE]: [],
  [RECEIPT_FOOTER_TYPE]: [{ key: 'sender-address', label: 'Sender Address', kind: 'text', section: 'content', multiline: true }],
}

/** The blocks whose words belong to the canvas, not to a field. */
export const TEXT_ON_CANVAS = new Set(['mj-text'])

const SAFE_UNITS: readonly LengthUnit[] = ['px', '%']
const PX_ONLY: readonly LengthUnit[] = ['px']

/**
 * What MJML will accept for this setting, read off its own attribute rules rather than remembered. A rule of
 * 'free' is one MJML does not validate (a section's corner radius), where px and % are the safe pair to offer.
 * MJML's unitless option — line-height may be a bare multiplier — is dropped, because the field cannot express it.
 */
export function unitsFor(type: string, key: string): readonly LengthUnit[] {
  const rule = ATTRIBUTE_RULES[type]?.[key]
  if (rule === undefined || rule === 'free' || rule === 'color') return SAFE_UNITS
  const units = rule.units.filter((unit): unit is LengthUnit => unit === 'px' || unit === '%')
  return units.length === 0 ? SAFE_UNITS : units
}

export function blockType(component: Component): string {
  return String(component.get('type') ?? component.get('tagName') ?? '')
}

export function fieldsFor(component: Component): SettingField[] {
  const type = blockType(component)
  if (type === CODE_TYPE) return codeFieldsFor(component).map((field) => (field.kind === 'length' ? { ...field, units: PX_ONLY } : field))
  return (SETTINGS_BY_BLOCK[type] ?? []).map((field) =>
    field.kind === 'length' || field.kind === 'padding' ?
      { ...field, units: field.key === BORDER_WIDTH_KEY ? PX_ONLY : unitsFor(type, field.key === MARGIN_KEY ? 'padding' : field.key) }
    : field,
  )
}

// ---------------------------------------------------------------- border and shadow
interface Border {
  width: string | null
  style: string | null
  color: string | null
}

const BORDER_WIDTH = /^\d*\.?\d+px$/

/** "1px solid #cccccc" in any order; "none" or nothing is no border. */
export function parseBorder(raw: unknown): Border {
  const border: Border = { width: null, style: null, color: null }
  for (const part of String(raw ?? '').trim().split(/\s+/).filter(Boolean)) {
    if (BORDER_WIDTH.test(part)) border.width = part
    else if (BORDER_STYLE_NAMES.includes(part)) border.style = part
    else if (part !== 'none') border.color = part
  }
  return border
}

function borderOf(component: Component): Border {
  return parseBorder(component.getAttributes().border)
}

function borderPart(border: Border, key: string): string | null {
  return key === BORDER_WIDTH_KEY ? border.width : key === BORDER_STYLE_KEY ? border.style : border.color
}

/**
 * One part changes and the attribute is written whole: a part left unset takes the plainest value (1px, solid,
 * black), and a width of 0, or every part cleared, takes the border away.
 */
function writeBorderPart(component: Component, key: string, value: string | null): boolean {
  const border = borderOf(component)
  const trimmed = value?.trim() ?? null
  if (key === BORDER_WIDTH_KEY) {
    if (trimmed !== null && !BORDER_WIDTH.test(trimmed)) return false
    border.width = trimmed
  } else if (key === BORDER_STYLE_KEY) {
    if (trimmed !== null && !BORDER_STYLE_NAMES.includes(trimmed)) return false
    border.style = trimmed
  } else {
    const hex = trimmed === null ? null : normaliseHex(trimmed)
    if (trimmed !== null && hex === null) return false
    border.color = hex
  }
  const off = border.width === '0px' || (border.width === null && border.style === null && border.color === null)
  if (off) component.removeAttributes('border')
  else component.addAttributes({ border: `${border.width ?? '1px'} ${border.style ?? 'solid'} ${border.color ?? '#000000'}` })
  return true
}

function writeShadow(component: Component, value: string | null): boolean {
  const level = value === null ? null : SHADOW_LEVELS.find((candidate) => candidate === value)
  if (level === undefined) return false
  setShadow(component, level)
  return true
}

// ---------------------------------------------------------------- margin and padding, summed into the MJML padding
/** The blocks whose Margin is the split (every block with a padding attribute except the button, whose margin IS its padding). */
export function splitsSpacing(component: Component): boolean {
  const type = blockType(component)
  return type !== 'mj-button' && ATTRIBUTE_RULES[type]?.padding !== undefined
}

export function spacingOf(component: Component): Spacing | null {
  return spacingFrom(component.get(SPACING_PROP))
}

/** The padding part the email would use when the block has no split yet: its own attribute, else what it inherits. */
function paddingBehind(component: Component): Padding {
  const raw = component.getAttributes().padding
  return parsePadding(raw === undefined || raw === null ? null : String(raw)) ?? parsePadding(MJML_DEFAULTS[blockType(component)]?.padding) ?? { ...ZERO_PADDING }
}

/** Writes the split and the sum in one go. False when a side mixes px and %, which no email can add up. */
function writeSpacing(component: Component, spacing: Spacing): boolean {
  if (spacing.margin === null && spacing.padding === null) {
    component.set(SPACING_PROP, null)
    component.removeAttributes('padding')
    return true
  }
  const total = sumSpacing(spacing.margin, spacing.padding)
  const sum = shorthand(total)
  if (sum === null) return false
  if (spacing.margin === null) {                           // no margin any more: the padding stands alone, as before
    component.set(SPACING_PROP, null)
    component.addAttributes({ padding: sum })
    return true
  }
  component.set(SPACING_PROP, spacingToStore(spacing))
  component.addAttributes({ padding: sum })
  return true
}

function writeMargin(component: Component, value: string | null): boolean {
  const current = spacingOf(component)
  if (value === null) return writeSpacing(component, { margin: null, padding: current?.padding ?? null })
  const margin = parsePadding(value)
  if (margin === null) return false
  return writeSpacing(component, { margin, padding: current?.padding ?? paddingBehind(component) })
}

function writeSplitPadding(component: Component, value: string | null): boolean {
  const current = spacingOf(component)
  if (current === null || current.margin === null) return false      // no margin: the plain attribute path applies
  const padding = value === null ? { ...ZERO_PADDING } : parsePadding(value)
  if (padding === null) return false
  return writeSpacing(component, { margin: current.margin, padding })
}

/** The fields of one section, in order. */
export function sectionFields(component: Component, section: SettingSection): SettingField[] {
  return fieldsFor(component).filter((field) => field.section === section)
}

/** Works for a Backbone collection and for a plain array, so tests can use ordinary objects. */
function childrenOf(component: Component): Component[] {
  const kids = component.components?.() as unknown as { map?: (fn: (child: Component) => Component) => Component[] } | undefined
  return typeof kids?.map === 'function' ? kids.map((child) => child) : []
}

function tagOf(component: Component): string {
  return String(component.get('tagName') ?? component.get('type') ?? '')
}

function findByTag(root: Component, tag: string): Component | undefined {
  for (const child of childrenOf(root)) {
    if (tagOf(child) === tag) return child
    const found = findByTag(child, tag)
    if (found) return found
  }
  return undefined
}

/** The words inside a block, which is what a button's label is. */
function textOf(component: Component): string | null {
  const own = String(component.get('content') ?? '').trim()
  if (own !== '') return own
  const parts = childrenOf(component).map((child) => textOf(child) ?? '')
  const joined = parts.join('').trim()
  return joined === '' ? null : joined
}

/** A Custom HTML block's markup, as GrapesJS serialises its children. */
function innerHtmlOf(component: Component): string | null {
  const read = (component as { getInnerHTML?: () => string }).getInnerHTML
  const html = typeof read === 'function' ? read.call(component).trim() : ''
  return html === '' ? null : html
}

const isSocialIcon = (component: Component) => blockType(component) === 'mj-social-element'

/** What this block sets on its own, ignoring anything it inherits. */
export function readSetting(component: Component, key: string): string | null {
  const receipt = receiptAccessor(blockType(component), key)
  if (receipt) return receipt.read(component)
  if (isCodeKey(key)) return blockType(component) === CODE_TYPE ? readCodeSetting(component, key) : null
  if (key === MARGIN_KEY) return splitsSpacing(component) ? shorthand(spacingOf(component)?.margin ?? null) : null
  if (key === 'padding' && splitsSpacing(component)) {
    const split = spacingOf(component)
    if (split?.margin) return shorthand(split.padding ?? { ...EMPTY_PADDING }) ?? shorthand(ZERO_PADDING)
  }
  if (key === LABEL_KEY) return textOf(component)
  if (key === HTML_KEY) return blockType(component) === 'mj-raw' ? readCustomHtmlMarkup(component) : innerHtmlOf(component)
  if (isCustomHtmlKey(key)) return blockType(component) === 'mj-raw' ? readCustomHtml(component, key) : null
  if (key === STACKING_KEY) return blockType(component) === 'mj-section' ? readStacking(component) : null
  if (isLinkStyleKey(key)) return blockType(component) === 'link' ? readLinkStyle(component, key) : null
  if (key === HIDE_MOBILE_KEY) return isHiddenOnPhones(component) ? HIDE_MOBILE_CLASS : null
  if (key === HIDE_DESKTOP_KEY) return isHiddenOnDesktop(component) ? HIDE_DESKTOP_CLASS : null
  if (key === SHADOW_KEY) return shadowOf(component)
  if (BORDER_KEYS.includes(key)) return borderPart(borderOf(component), key)
  if (key === NETWORK_KEY && isSocialIcon(component)) return networkOf(String(component.getAttributes()[key] ?? ''))
  const raw = component.getAttributes()[key] ?? (key === SRC_KEY ? component.get(SRC_KEY) : undefined)
  if (raw === undefined || raw === null || raw === '') return null
  return String(raw)
}

/**
 * The block's own value, but only when the plugin will actually emit it. getAttrToHTML deletes any attribute
 * equal to the type's style-default, so such a value never reaches the email and the inherited one wins.
 * keepChosenValues empties style-default, which is what stops this happening to a value the reader picked.
 */
function ownValue(component: Component, key: string): string | null {
  const value = readSetting(component, key)
  if (value === null) return null
  const stripped = (component.get('style-default') as Record<string, unknown> | undefined)?.[key]
  return stripped !== undefined && String(stripped) === value ? null : value
}

function headAttribute(wrapper: Component | null | undefined, tag: string, key: string): string | null {
  if (!wrapper) return null
  const attributes = findByTag(wrapper, 'mj-attributes')
  const forTag = attributes && findByTag(attributes, tag)
  const raw = forTag?.getAttributes()[key]
  return raw === undefined || raw === null || raw === '' ? null : String(raw)
}

/** What the recipient will see: the block's own value, else mj-attributes, else mj-all, else MJML's default. */
export function readEffective(component: Component, key: string, wrapper?: Component | null): EffectiveValue {
  const own = ownValue(component, key)
  // hiding on phones, a margin, a block's own words and a receipt block's settings are the block's own: there is nothing for them to inherit
  if (own !== null || key === LABEL_KEY || key === HTML_KEY || key === HIDE_MOBILE_KEY || key === HIDE_DESKTOP_KEY || key === MARGIN_KEY || key === SHADOW_KEY || key === STACKING_KEY || isCustomHtmlKey(key) || isLinkStyleKey(key) || BORDER_KEYS.includes(key) || isCodeKey(key) || receiptAccessor(blockType(component), key)) return { value: own, source: 'block' }
  return readInherited(component, key, wrapper)
}

/** What the block would get if it set nothing of its own: mj-attributes, else mj-all, else MJML's default. */
export function readInherited(component: Component, key: string, wrapper?: Component | null): EffectiveValue {
  const type = blockType(component)
  const forTag = headAttribute(wrapper, type, key)
  if (forTag !== null) return { value: forTag, source: 'mj-attributes' }

  const forAll = headAttribute(wrapper, 'mj-all', key)
  if (forAll !== null) return { value: forAll, source: 'mj-all' }

  // some mjml defaults are the empty string (an image's alt), which reads as nothing set rather than as a value
  const fallback = MJML_DEFAULTS[type]?.[key]
  return { value: fallback === undefined || fallback === '' ? null : fallback, source: 'mjml-default' }
}

function unitOk(part: string, rule: UnitRule): boolean {
  const match = /^(-?\d*\.?\d+)(.*)$/.exec(part)
  return match !== null && rule.units.includes(match[2].trim())
}

/** Returns the value to write, or null when MJML would reject it (em, rem, a missing unit, a colour that is not hex). */
function prepare(type: string, key: string, value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const rule = ATTRIBUTE_RULES[type]?.[key] ?? 'free'
  if (rule === 'free') return trimmed
  if (rule === 'color') return normaliseHex(trimmed)

  const parts = trimmed.split(/\s+/)
  if (parts.length > (rule.parts ?? 1)) return null
  return parts.every((part) => unitOk(part, rule)) ? trimmed : null
}

/** null clears the setting. Returns false when the value was refused, in which case nothing was written. */
export function writeSetting(component: Component, key: string, value: string | null): boolean {
  const receipt = receiptAccessor(blockType(component), key)
  if (receipt) {
    receipt.write(component, value)
    return true
  }
  if (key === LABEL_KEY) {
    // a social icon's label is optional: cleared, the icon stands alone
    if (value === null && !isSocialIcon(component)) return false
    writeContent(component, value ?? '')
    return true
  }
  // markup, not words: the reader asked for HTML, and the server refuses scripts and handlers on save
  if (key === HTML_KEY) {
    if (blockType(component) === 'mj-raw') writeCustomHtmlMarkup(component, value)
    else component.components(value ?? '')
    return true
  }
  if (isCustomHtmlKey(key)) return blockType(component) === 'mj-raw' && writeCustomHtml(component, key, value)
  if (key === STACKING_KEY) return blockType(component) === 'mj-section' && writeStacking(component, value)
  if (isLinkStyleKey(key)) return blockType(component) === 'link' && writeLinkStyle(component, key, value)
  // the class list, never the attribute map: every other class on the block, the footer's included, stays put
  if (key === HIDE_MOBILE_KEY || key === HIDE_DESKTOP_KEY) {
    setCssClass(component, key === HIDE_MOBILE_KEY ? HIDE_MOBILE_CLASS : HIDE_DESKTOP_CLASS, value !== null)
    return true
  }
  if (isCodeKey(key)) return writeCodeSetting(component, key, value)
  if (key === MARGIN_KEY) return splitsSpacing(component) && writeMargin(component, value)
  if (key === SHADOW_KEY) return writeShadow(component, value)
  if (BORDER_KEYS.includes(key)) return ATTRIBUTE_RULES[blockType(component)]?.border !== undefined && writeBorderPart(component, key, value)
  if (key === 'padding' && splitsSpacing(component) && spacingOf(component)?.margin) return writeSplitPadding(component, value)
  if (value === null) {
    component.removeAttributes(key)
    return true
  }
  // written in the direct form, so the icon links to the profile and not to a sharer page; a network MJML has no icon
  // for gets ours, and going back to one it has drops ours so MJML's own shows again
  if (key === NETWORK_KEY && isSocialIcon(component)) {
    const own = ownIconAttributes(value)
    if (!own && component.getAttributes().src) component.removeAttributes(['src', 'background-color'])
    component.addAttributes({ [key]: directName(value), ...(own ?? {}) })
    return true
  }

  const prepared = prepare(blockType(component), key, value)
  if (prepared === null) return false

  if (key === SRC_KEY) {
    // getMjmlAttributes lets the src property override the attribute map, so it is emptied first: written this
    // way the picture changes, and undo and redo both work, which set('src', url) alone does not.
    component.set(SRC_KEY, '')
    component.addAttributes({ [SRC_KEY]: prepared })
    return true
  }

  component.addAttributes({ [key]: prepared })
  return true
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** Plain text only. Never set('content'): it appends to the children already there and can hang the canvas. */
export function writeContent(component: Component, text: string): void {
  component.components(text.replace(/[&<>]/g, (character) => ESCAPES[character]))
}

/** Adds an icon for `network` at the end of a social block. False when the component cannot take children (a test double). */
export function addSocialElement(component: Component, network: string): boolean {
  const append = (component as { append?: (content: string) => unknown }).append
  if (typeof append !== 'function') return false
  append.call(component, socialElementMjml(network))
  return true
}

/** The one edit in progress. A drag is the only thing that groups, and only one can be under way at a time. */
let grouped: { component: Component; attributes: Record<string, unknown> } | null = null

/** Starts a drag: previews are written normally, but none of them reach the undo stack. */
export function beginGroupedEdit(editor: GroupedEditor, component: Component): void {
  grouped = { component, attributes: { ...component.getAttributes() } }
  editor.UndoManager.stop()
}

/** Puts the model back exactly as the drag found it, and lets the undo stack record again. */
function unwind(editor: GroupedEditor, component: Component): void {
  if (grouped?.component === component) component.set('attributes', grouped.attributes)
  grouped = null
  editor.UndoManager.start()
}

/** Puts the model back as it was, then writes the final value once, so the whole drag is a single undo step. */
export function endGroupedEdit(editor: GroupedEditor, component: Component, key: string, value: string | null): boolean {
  unwind(editor, component)
  return writeSetting(component, key, value)
}

/** Abandons a drag: the previews are rolled back and nothing is written, so the undo stack never saw it. */
export function cancelGroupedEdit(editor: GroupedEditor, component: Component): void {
  unwind(editor, component)
}

/** True while a drag is being previewed, which is the only time the model is ahead of the undo stack. */
export function isGrouping(component?: Component): boolean {
  return grouped !== null && (component === undefined || grouped.component === component)
}

/** Only the part of the editor the grouped edit touches, so a test can stand one up in two lines. */
export interface GroupedEditor {
  UndoManager: { stop: () => void; start: () => void }
}
