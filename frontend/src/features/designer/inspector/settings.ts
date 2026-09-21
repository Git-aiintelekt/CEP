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

import { HIDE_MOBILE_CLASS, isHiddenOnPhones, setCssClass } from '../blocks/register'
import { normaliseHex } from './fields/color/colorMath'
import type { LengthUnit } from './fields/length'

// one implementation, shared with the colour field: #ABC and #AABBCC both become #aabbcc
export { normaliseHex }

export type SettingKind =
  | 'color' | 'length' | 'padding' | 'align' | 'valign' | 'toggle' | 'select' | 'text' | 'link' | 'image'

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
}

/** A button's label and an mj-text's words are component content, not an attribute. */
export const LABEL_KEY = 'label'
export const SRC_KEY = 'src'

/**
 * Hiding on phones is a css-class, not an MJML attribute, so it is read and written through that list rather
 * than through the attribute map. The key is the panel's own name for it and never reaches the email.
 */
export const HIDE_MOBILE_KEY = 'cep-hide-on-phones'

export type EffectiveSource = 'block' | 'mj-attributes' | 'mj-all' | 'mjml-default'

export interface EffectiveValue {
  value: string | null
  source: EffectiveSource
}

/**
 * MJML's own defaults for the settings we edit, taken from the installed mjml-browser's defaultAttributes.
 * settings.defaults.test.ts reads them back out of the package and fails if this drifts.
 */
export const MJML_DEFAULTS: Record<string, Record<string, string>> = {
  'mj-section': { padding: '20px 0' },
  'mj-column': { 'vertical-align': 'top' },
  'mj-text': { align: 'left', color: '#000000', 'font-size': '13px', 'line-height': '1', padding: '10px 25px' },
  'mj-button': {
    align: 'center', 'background-color': '#414141', 'border-radius': '3px', color: '#ffffff',
    'inner-padding': '10px 25px', padding: '10px 25px',
  },
  'mj-image': { align: 'center', alt: '', padding: '10px 25px' },
  'mj-divider': { 'border-color': '#000000', 'border-width': '4px', padding: '10px 25px' },
  'mj-spacer': { height: '20px' },
  'mj-social': { align: 'center' },
  'mj-social-element': {},
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
const PADDING: UnitRule = { units: ['px', '%'], parts: 4 }
const LINE_HEIGHT: UnitRule = { units: ['px', '%', ''] }

/** Mirrors mjml's allowedAttributes for the settings we edit; the same drift test checks it. */
export const ATTRIBUTE_RULES: Record<string, Record<string, AttributeRule>> = {
  'mj-section': { 'background-color': 'color', padding: PADDING, 'border-radius': 'free', 'full-width': 'free' },
  'mj-column': { 'background-color': 'color', padding: PADDING, 'vertical-align': 'free', 'border-radius': PADDING },
  'mj-text': {
    'font-size': PX, color: 'color', align: 'free', 'line-height': LINE_HEIGHT, padding: PADDING, 'font-weight': 'free',
  },
  'mj-button': {
    href: 'free', 'background-color': 'color', color: 'color', 'border-radius': 'free', padding: PADDING,
    'inner-padding': PADDING, align: 'free', width: LENGTH,
  },
  'mj-image': { src: 'free', alt: 'free', href: 'free', align: 'free', width: PX, padding: PADDING },
  'mj-divider': { 'border-color': 'color', 'border-width': PX, padding: PADDING },
  'mj-spacer': { height: LENGTH },
  'mj-social': { align: 'free' },
  'mj-social-element': { href: 'free' },
}

/** The one line shown instead of content fields for a block whose words are edited on the canvas. */
export const CANVAS_TEXT_NOTE = 'Edit the text on the canvas.'

export const ALT_HELP = "Describe the image for people who can't see it."

export const HIDE_MOBILE_LABEL = 'Hide on phones'

/** Stacking is MJML's own doing below 480px, so it is something to say, not something to switch. */
export const STACK_NOTE = 'Columns stack on phones automatically.'

/** A closing line under a block's layout settings, for behaviour that has no field of its own. */
export const LAYOUT_NOTES: Record<string, string> = { 'mj-section': STACK_NOTE }

/** Every setting a block offers, in the order the panel shows it. A heading block is an mj-text. */
export const SETTINGS_BY_BLOCK: Record<string, SettingField[]> = {
  'mj-section': [
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'full-width', label: 'Full width', kind: 'toggle', section: 'layout' },
    { key: HIDE_MOBILE_KEY, label: HIDE_MOBILE_LABEL, kind: 'toggle', section: 'layout' },
    { key: 'background-color', label: 'Background color', kind: 'color', section: 'appearance' },
    { key: 'border-radius', label: 'Corner radius', kind: 'length', section: 'appearance', min: 0 },
  ],
  'mj-column': [
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'vertical-align', label: 'Vertical alignment', kind: 'valign', section: 'layout' },
    { key: 'background-color', label: 'Background color', kind: 'color', section: 'appearance' },
    { key: 'border-radius', label: 'Corner radius', kind: 'length', section: 'appearance', min: 0 },
  ],
  'mj-text': [
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'font-size', label: 'Font size', kind: 'length', section: 'appearance', min: 1 },
    { key: 'font-weight', label: 'Font weight', kind: 'select', section: 'appearance' },
    { key: 'line-height', label: 'Line height', kind: 'length', section: 'appearance', min: 0 },
    { key: 'color', label: 'Text color', kind: 'color', section: 'appearance' },
  ],
  'mj-button': [
    { key: LABEL_KEY, label: 'Label', kind: 'text', section: 'content' },
    { key: 'href', label: 'Link', kind: 'link', section: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'width', label: 'Width', kind: 'length', section: 'layout', min: 0 },
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'background-color', label: 'Background color', kind: 'color', section: 'appearance' },
    { key: 'color', label: 'Text color', kind: 'color', section: 'appearance' },
    { key: 'border-radius', label: 'Corner radius', kind: 'length', section: 'appearance', min: 0 },
    { key: 'inner-padding', label: 'Inner padding', kind: 'padding', section: 'appearance' },
  ],
  'mj-image': [
    { key: SRC_KEY, label: 'Image', kind: 'image', section: 'content' },
    { key: 'alt', label: 'Alt text', kind: 'text', section: 'content', help: ALT_HELP },
    { key: 'href', label: 'Link', kind: 'link', section: 'content' },
    { key: 'align', label: 'Alignment', kind: 'align', section: 'layout' },
    { key: 'width', label: 'Width', kind: 'length', section: 'layout', min: 0 },
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
  ],
  'mj-divider': [
    { key: 'padding', label: 'Padding', kind: 'padding', section: 'layout' },
    { key: 'border-color', label: 'Line color', kind: 'color', section: 'appearance' },
    { key: 'border-width', label: 'Line width', kind: 'length', section: 'appearance', min: 0 },
  ],
  'mj-spacer': [{ key: 'height', label: 'Height', kind: 'length', section: 'layout', min: 0 }],
  'mj-social': [{ key: 'align', label: 'Alignment', kind: 'align', section: 'layout' }],
  'mj-social-element': [{ key: 'href', label: 'Link', kind: 'link', section: 'content' }],
}

/** The blocks whose words belong to the canvas, not to a field. */
export const TEXT_ON_CANVAS = new Set(['mj-text'])

const SAFE_UNITS: readonly LengthUnit[] = ['px', '%']

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
  return (SETTINGS_BY_BLOCK[type] ?? []).map((field) =>
    field.kind === 'length' || field.kind === 'padding' ? { ...field, units: unitsFor(type, field.key) } : field,
  )
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

/** What this block sets on its own, ignoring anything it inherits. */
export function readSetting(component: Component, key: string): string | null {
  if (key === LABEL_KEY) return textOf(component)
  if (key === HIDE_MOBILE_KEY) return isHiddenOnPhones(component) ? HIDE_MOBILE_CLASS : null
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
  // hiding on phones is the block's own choice: there is nothing in mj-head or MJML for it to inherit
  if (own !== null || key === LABEL_KEY || key === HIDE_MOBILE_KEY) return { value: own, source: 'block' }

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
  if (key === LABEL_KEY) {
    if (value === null) return false
    writeContent(component, value)
    return true
  }
  // the class list, never the attribute map: every other class on the block, the footer's included, stays put
  if (key === HIDE_MOBILE_KEY) {
    setCssClass(component, HIDE_MOBILE_CLASS, value !== null)
    return true
  }
  if (value === null) {
    component.removeAttributes(key)
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
