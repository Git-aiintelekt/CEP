/** What a layer row is called and which glyph it carries. Pure: no GrapesJS, no editor. */
import {
  Box,
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

const NAMES: Record<string, string> = {
  'mj-body': 'Email body',
  'mj-section': 'Section',
  'mj-column': 'Column',
  'mj-group': 'Column group',
  'mj-text': 'Text',
  'mj-button': 'Button',
  'mj-image': 'Image',
  'mj-divider': 'Divider',
  'mj-spacer': 'Spacer',
  'mj-social': 'Social links',
  'mj-social-element': 'Social icon',
  link: 'Link',
  'cep-receipt-slot': 'Receipt slot',
  'cep-receipt-brand-header': 'Brand header',
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
  const value = String(attributes?.name ?? '').trim()
  return value === '' ? null : value.charAt(0).toUpperCase() + value.slice(1)
}

/** mj-social-element -> "Social element": a tag we have no name for still reads as words. */
export function humanise(kind: string): string {
  const words = kind.replace(/^mj-/, '').replace(/[-_]+/g, ' ').trim()
  if (words === '') return 'Block'
  return words.charAt(0).toUpperCase() + words.slice(1)
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
