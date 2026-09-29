/**
 * A link inside a text block (a `link` component): its colour and underline. MJML has no attribute for either, so they
 * live in the link's own style attribute — which is what the email carries and what the canvas paints — beside whatever
 * the link already declared. Nothing said about the underline means the email app draws one.
 */
import type { Component } from 'grapesjs'

import { normaliseHex } from './fields/color/colorMath'
import type { SelectOption } from './fields/options'

export const LINK_COLOR_KEY = 'cep-link-color'
export const LINK_UNDERLINE_KEY = 'cep-link-underline'
export const UNDERLINE_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'No Underline' },
  { value: 'underline', label: 'Underlined' },
]

export const isLinkStyleKey = (key: string): boolean => key === LINK_COLOR_KEY || key === LINK_UNDERLINE_KEY

const PROPERTY: Record<string, string> = { [LINK_COLOR_KEY]: 'color', [LINK_UNDERLINE_KEY]: 'text-decoration' }

/** "color:#64748b; text-decoration : none;" -> [['color', '#64748b'], ['text-decoration', 'none']], in order, tidy. */
export function parseStyle(style: string | null | undefined): [string, string][] {
  return String(style ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(':')
      return at === -1 ? null : ([part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()] as [string, string])
    })
    .filter((pair): pair is [string, string] => pair !== null && pair[0] !== '' && pair[1] !== '')
}

export function serialiseStyle(declarations: [string, string][]): string {
  return declarations.map(([name, value]) => `${name}:${value};`).join('')
}

function declarationsOf(component: Component): [string, string][] {
  return parseStyle(String(component.getAttributes().style ?? ''))
}

export function readLinkStyle(component: Component, key: string): string | null {
  const property = PROPERTY[key]
  const found = declarationsOf(component).find(([name]) => name === property)
  if (!found) return null
  return property === 'color' ? (normaliseHex(found[1]) ?? found[1]) : found[1]
}

/** null clears the declaration. False when the value is not one the email could carry. */
export function writeLinkStyle(component: Component, key: string, value: string | null): boolean {
  const property = PROPERTY[key]
  if (!property) return false
  let next: string | null = value?.trim() || null
  if (next !== null && property === 'color') {
    next = normaliseHex(next)
    if (next === null) return false
  }
  if (next !== null && property === 'text-decoration' && !UNDERLINE_OPTIONS.some((option) => option.value === next)) return false

  // a rewritten declaration keeps its place; a new one goes last; a cleared one goes
  const current = declarationsOf(component)
  const present = current.some(([name]) => name === property)
  const declarations: [string, string][] =
    next === null ? current.filter(([name]) => name !== property)
    : present ? current.map(([name, value]) => (name === property ? [name, next as string] : [name, value]))
    : [...current, [property, next]]
  if (declarations.length === 0) component.removeAttributes('style')
  else component.addAttributes({ style: serialiseStyle(declarations) })
  return true
}
