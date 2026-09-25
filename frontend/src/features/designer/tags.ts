/** Personalization tag helpers shared by the designer, its preview and the tests. Syntax: {{tag_key}} */
import type { PersonalizationTag } from '@/lib/types'

const TAG_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g

/** Tag keys in order of first appearance. */
export function extractTags(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(TAG_PATTERN)) seen.add(match[1])
  }
  return [...seen]
}

export function unknownTags(used: string[], catalogue: PersonalizationTag[]): string[] {
  const known = new Set(catalogue.map((tag) => tag.tag_key))
  return used.filter((key) => !known.has(key))
}

const KIND_ORDER = ['STANDARD', 'CUSTOM', 'SYSTEM', 'SEGMENT', 'INNER_TEMPLATE']
const KIND_LABEL: Record<string, string> = {
  STANDARD: 'Customer', CUSTOM: 'Campaign List', SYSTEM: 'System', SEGMENT: 'Segment', INNER_TEMPLATE: 'Content Blocks',
}

export function groupTags(catalogue: PersonalizationTag[], channel = 'EMAIL'): { kind: string; label: string; tags: PersonalizationTag[] }[] {
  const usable = catalogue.filter((tag) => tag.is_active && (tag.applies_to_channels.length === 0 || tag.applies_to_channels.includes(channel)))
  const kinds = [...new Set(usable.map((tag) => tag.tag_kind))].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
  return kinds.map((kind) => ({
    kind,
    label: KIND_LABEL[kind] ?? kind,
    tags: usable.filter((tag) => tag.tag_kind === kind).sort((a, b) => a.label.localeCompare(b.label)),
  }))
}

export const asToken = (key: string) => `{{${key}}}`
