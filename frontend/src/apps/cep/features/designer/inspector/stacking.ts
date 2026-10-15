/**
 * What a section's columns do on a phone. MJML stacks them, left column first; that is what every email client
 * does with a plain section. Two other answers are possible without leaving MJML:
 *   keep     the columns wrapped in an mj-group, which MJML lays out side by side at every width (a menu bar);
 *   reverse  direction="rtl" on the section with the columns stored right to left: desktop shows them as before,
 *            a phone stacks the right one first. MJML sets direction:ltr on each column, so the words inside stay
 *            left to right.
 */
import type { Component } from 'grapesjs'

import type { SelectOption } from './fields/options'

export const STACKING_KEY = 'cep-stacking'
export const STACKING_LABEL = 'On Phones'
export const STACKING_HELP = 'What the columns do on a narrow screen. Side by side suits a menu bar; keep the columns few and short.'
export type Stacking = 'stack' | 'keep' | 'reverse'
export const STACKING_OPTIONS: SelectOption[] = [
  { value: 'stack', label: 'Stack, Left First' },
  { value: 'keep', label: 'Keep Side by Side' },
  { value: 'reverse', label: 'Stack, Right First' },
]

const GROUP = 'mj-group'
const COLUMN = 'mj-column'

function typeOf(component: Component): string {
  return String(component.get('type') ?? component.get('tagName') ?? '')
}

function childrenOf(component: Component): Component[] {
  const kids = component.components?.() as unknown as { map?: (fn: (child: Component) => Component) => Component[] } | undefined
  return typeof kids?.map === 'function' ? kids.map((child) => child) : []
}

/** The one group a "keep" section holds, else nothing. */
function groupOf(section: Component): Component | null {
  const kids = childrenOf(section)
  return kids.length === 1 && typeOf(kids[0]) === GROUP ? kids[0] : null
}

export function readStacking(section: Component): Stacking {
  if (groupOf(section)) return 'keep'
  return String(section.getAttributes().direction ?? '') === 'rtl' ? 'reverse' : 'stack'
}

function columnsOf(section: Component): Component[] {
  const group = groupOf(section)
  return childrenOf(group ?? section).filter((child) => typeOf(child) === COLUMN)
}

/** Puts `columns` into `parent` in this order, moving what is already there rather than copying it. */
function place(parent: Component, columns: Component[]): void {
  columns.forEach((column, index) => column.move(parent, { at: index }))
}

/** Returns false when the section is not one the panel can rearrange (no columns, or something it does not know). */
export function writeStacking(section: Component, value: string | null): boolean {
  const wanted: Stacking = value === 'keep' || value === 'reverse' ? value : 'stack'
  const current = readStacking(section)
  if (wanted === current) return true
  const columns = columnsOf(section)
  if (columns.length === 0) return false

  // back to plain stacking first: the two other answers are each one step away from it
  if (current === 'keep') {
    const group = groupOf(section) as Component
    place(section, columns)
    group.remove()
  } else if (current === 'reverse') {
    place(section, [...columns].reverse())
    section.removeAttributes('direction')
  }

  if (wanted === 'keep') {
    const added = section.append(`<${GROUP}></${GROUP}>`, { at: 0 })
    const group = Array.isArray(added) ? added[0] : added
    place(group, columnsOf(section))
  } else if (wanted === 'reverse') {
    place(section, [...columnsOf(section)].reverse())
    section.addAttributes({ direction: 'rtl' })
  }
  return true
}
