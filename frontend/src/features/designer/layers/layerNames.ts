/** What a layer row is called and which glyph it carries. Pure: no GrapesJS, no editor. */
import {
  Box,
  Code,
  Columns2,
  Heading,
  Image,
  LayoutPanelTop,
  Link,
  Lock,
  Megaphone,
  Minus,
  MousePointerClick,
  MoveVertical,
  Rows3,
  Share2,
  Type,
  type LucideIcon,
} from 'lucide-react'

import { networkLabel } from '../inspector/social'

const NAMES: Record<string, string> = {
  'mj-body': 'Email Body',
  'mj-section': 'Section',
  'mj-column': 'Column',
  'mj-group': 'Column Group',
  'mj-text': 'Text',
  'mj-button': 'Button',
  'mj-image': 'Image',
  'mj-divider': 'Divider',
  'mj-spacer': 'Spacer',
  'mj-social': 'Social Links',
  'mj-social-element': 'Social Icon',
  'mj-raw': 'Custom HTML',
  link: 'Link',
  'cep-receipt-slot': 'Receipt Slot',
  'cep-receipt-brand-header': 'Brand Header',
  'cep-marketing': 'Marketing',
  'cep-receipt-button': 'Button',
  'cep-receipt-image': 'Image',
  'cep-receipt-divider': 'Divider',
  'cep-receipt-footer': 'Footer',
}

const ICONS: Record<string, LucideIcon> = {
  'mj-body': LayoutPanelTop,
  'mj-section': Rows3,
  'mj-column': Columns2,
  'mj-group': Columns2,
  'mj-text': Type,
  'mj-button': MousePointerClick,
  'mj-image': Image,
  'mj-divider': Minus,
  'mj-spacer': MoveVertical,
  'mj-social': Share2,
  'mj-social-element': Share2,
  'mj-raw': Code,
  link: Link,
  'mj-heading': Heading,
  'cep-receipt-slot': Lock,
  'cep-receipt-brand-header': LayoutPanelTop,
  'cep-marketing': Megaphone,
  'cep-receipt-button': MousePointerClick,
  'cep-receipt-image': Image,
  'cep-receipt-divider': Minus,
  'cep-receipt-footer': Rows3,
}

export const GENERIC_ICON = Box

/** mj-social-element -> "Facebook": the network is in the name attribute, which is far more useful than the tag. */
function network(attributes: Record<string, unknown> | undefined): string | null {
  return networkLabel(String(attributes?.name ?? ''))
}

/** mj-social-element -> "Social Element": a tag we have no name for still reads as words. */
export function humanise(kind: string): string {
  const words = kind.replace(/^mj-/, '').replace(/[-_]+/g, ' ').trim()
  if (words === '') return 'Block'
  return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export function defaultNameFor(kind: string, attributes?: Record<string, unknown>): string {
  if (kind === 'mj-social-element') return network(attributes) ?? NAMES[kind]
  return NAMES[kind] ?? humanise(kind)
}

/** A name the reader typed always wins; blank means they cleared it, so the default comes back. */
export function layerNameFor(kind: string, customName?: unknown, attributes?: Record<string, unknown>): string {
  const custom = String(customName ?? '').trim()
  return custom === '' ? defaultNameFor(kind, attributes) : custom
}

export function iconFor(kind: string): LucideIcon {
  return ICONS[kind] ?? GENERIC_ICON
}
