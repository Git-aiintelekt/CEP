/**
 * Who the preview is read as, and what each {{tag}} becomes for them.
 *
 * The rule mirrors the server's renderer (backend apps/delivery/engine/render.py, Renderer._value): the contact's own
 * value, else the tag's default_value, else blank. An empty string counts as no value at every step, as it does there.
 * Two kinds of tag do not depend on the contact, so every profile reads them the same way:
 *  - a static value is the value (the server's STATIC source);
 *  - a SYSTEM tag (a shop link, the unsubscribe link) is filled by the platform at send, so its sample stands in.
 */
import type { PersonalizationTag } from '@/lib/types'

export type PreviewProfileId = 'sample' | 'full' | 'empty'

export interface PreviewProfile {
  id: PreviewProfileId
  label: string
  /** 'samples' reads each tag's own sample_value; otherwise the contact's values by tag key */
  values: 'samples' | Readonly<Record<string, string>>
}

export const PREVIEW_PROFILES: readonly PreviewProfile[] = [
  { id: 'sample', label: 'Sample Values', values: 'samples' },
  {
    id: 'full',
    label: 'Full Profile',
    values: {
      first_name: 'Aaliyah',
      last_name: 'Johnson',
      email: 'aaliyah@example.com',
      email_address: 'aaliyah@example.com',
      loyalty_tier: 'GOLD',
      loyalty_points: '1,250',
      offer_code: 'FALL017',
      discount_pct: '20',
    },
  },
  // only the address the email goes to: everything else falls back to its default, or goes blank
  { id: 'empty', label: 'Empty Profile', values: { email: 'no.details@example.com', email_address: 'no.details@example.com' } },
]

export const DEFAULT_PROFILE: PreviewProfile = PREVIEW_PROFILES[0]

export function profileById(id: PreviewProfileId): PreviewProfile {
  return PREVIEW_PROFILES.find((profile) => profile.id === id) ?? DEFAULT_PROFILE
}

/**
 * sample: a catalogue sample, under "Sample values"
 * value: a real value for this contact
 * default: the contact has none, so the tag's default stands in
 * blank: no value and no default; the email sends nothing here
 * unknown: not in the catalogue; the server refuses to activate a template using it
 */
export type FillKind = 'sample' | 'value' | 'default' | 'blank' | 'unknown'

export interface Fill {
  key: string
  kind: FillKind
  /** what the email carries: '' for blank, the {{tag}} itself for an unknown one */
  text: string
}

/** A piece of text: plain words, or a tag and what it became. */
export type Part = string | Fill

/** The same syntax the server reads (TAG_RE in render.py). A fresh copy per call: the g flag carries state. */
const tagPattern = () => /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g

const present = (value: string | null | undefined): value is string => value !== null && value !== undefined && value !== ''

export function resolveTag(key: string, catalogue: PersonalizationTag[] | Map<string, PersonalizationTag>, profile: PreviewProfile): Fill {
  const tag = catalogue instanceof Map ? catalogue.get(key) : catalogue.find((item) => item.tag_key === key)
  if (!tag) return { key, kind: 'unknown', text: `{{${key}}}` }

  const samples = profile.values === 'samples'
  if (present(tag.static_value)) return { key, kind: 'value', text: tag.static_value }
  if (tag.tag_kind === 'SYSTEM' && present(tag.sample_value)) return { key, kind: samples ? 'sample' : 'value', text: tag.sample_value }

  const own = samples ? tag.sample_value : (profile.values as Readonly<Record<string, string>>)[key]
  if (present(own)) return { key, kind: samples ? 'sample' : 'value', text: own }
  if (present(tag.default_value)) return { key, kind: 'default', text: tag.default_value }
  return { key, kind: 'blank', text: '' }
}

/** Text split into its plain words and its tags, each tag already resolved for the profile. */
export function previewParts(text: string, catalogue: PersonalizationTag[], profile: PreviewProfile): Part[] {
  const byKey = new Map(catalogue.map((tag) => [tag.tag_key, tag]))
  const parts: Part[] = []
  let at = 0
  for (const match of text.matchAll(tagPattern())) {
    const start = match.index ?? 0
    if (start > at) parts.push(text.slice(at, start))
    parts.push(resolveTag(match[1], byKey, profile))
    at = start + match[0].length
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

/** Python's html.escape(value, quote=True), which is what the server applies to a value in the HTML part. */
export function escapeLikeServer(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

/**
 * The text as this contact would receive it, with nothing of the preview's own in it: no chips, no markers.
 * Values are escaped for HTML, as the server does; pass escape: false for a plain-text context.
 */
export function fillForPreview(text: string, catalogue: PersonalizationTag[], profile: PreviewProfile, { escape = true } = {}): string {
  return previewParts(text, catalogue, profile)
    .map((part) => (typeof part === 'string' ? part : escape ? escapeLikeServer(part.text) : part.text))
    .join('')
}
