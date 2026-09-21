/**
 * What a review needs from the MJML the editor holds: the links behind the Links pill, and the images
 * missing a description. Pure: parses the markup, talks to nothing.
 *
 * `kind` is PROVISIONAL. Click-tracking link rewriting is not implemented anywhere in this repo — the
 * `services/tracking` FastAPI service that owns the click redirect is listed as "to be scaffolded"
 * (services/README.md) and as not in this version (docs/DELIVERY_PROVIDERS.md section 13). Only the
 * `tracking_link` table exists. So there is no server rule to mirror yet: the split below follows the
 * schema's intent (a token resolving to a web target_url) and must be reconciled with the service when
 * it is built. Nothing depends on it beyond the wording of a tag.
 */
import type { PersonalizationTag } from '@/lib/types'

import { expandSelfClosing } from './mjml'
import { extractTags, unknownTags } from './tags'

export type LinkFlag = 'insecure' | 'unknown-tag' | 'empty'

/** What the reader clicked on, so an explanation can name it correctly. */
export type LinkElement = 'button' | 'social' | 'link'

export interface LinkEntry {
  id: string
  url: string
  label: string
  kind: 'tracked' | 'advisory'
  element: LinkElement
  flags: LinkFlag[]
  /**
   * Which block this is, counted among the blocks of its own tag in document order, so the editor can find
   * the same one in its component tree. An <a> written inside a text block is not a block of its own: null.
   */
  block: { tag: string; nth: number } | null
}

const LABEL_MAX = 40
/** Its own signed public endpoint (/public/unsubscribe/?t=), never a click redirect. */
const UNSUBSCRIBE = 'unsubscribe_url'

/** Schemes and targets a click redirect can never wrap. */
function isAdvisory(url: string): boolean {
  const value = url.trim().toLowerCase()
  if (value === '' || value.startsWith('#')) return true
  if (/^(mailto|tel|sms):/.test(value)) return true
  return value.includes(UNSUBSCRIBE) || value.includes('/unsubscribe')
}

function labelOf(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return fallback
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text
}

export function extractLinks(mjml: string, tags: PersonalizationTag[]): LinkEntry[] {
  const found: { url: string; label: string; element: LinkElement; empty: boolean; block: { tag: string; nth: number } | null }[] = []
  const counts = new Map<string, number>()

  try {
    // self-closing MJML tags are expanded first, or the HTML parser nests every later sibling inside them
    const doc = new DOMParser().parseFromString(expandSelfClosing(mjml ?? ''), 'text/html')
    for (const node of doc.querySelectorAll('mj-button, mj-image, mj-social-element, a')) {
      const tag = node.tagName.toLowerCase()
      const href = node.getAttribute('href')
      const url = (href ?? '').trim()
      // counted per tag, and before the empty-href skips below, so the count matches the component tree
      const nth = counts.get(tag) ?? 0
      counts.set(tag, nth + 1)
      const social = tag === 'mj-social-element'
      // a social icon carries no text of its own, so its network name is what tells the rows apart
      const text = tag === 'mj-image' ? node.getAttribute('alt') : social ? node.textContent?.trim() || node.getAttribute('name') : node.textContent
      if (tag === 'mj-image' && url === '') continue // an image with no href is not a link
      if (tag === 'a' && url === '') continue
      found.push({
        url,
        label: labelOf(text, tag === 'mj-image' ? 'Image link' : 'Link'),
        element: tag === 'mj-button' ? 'button' : social ? 'social' : 'link',
        empty: (tag === 'mj-button' || social) && url === '',
        block: tag === 'a' ? null : { tag, nth },
      })
    }
  } catch {
    return [] // malformed beyond parsing: the pill shows nothing rather than breaking the editor
  }

  const seen = new Set<string>()
  const links: LinkEntry[] = []
  found.forEach((item, index) => {
    const key = `${item.url}\u0000${item.label}`
    if (seen.has(key)) return
    seen.add(key)

    const unknown = unknownTags(extractTags(item.url), tags).filter((key) => key !== UNSUBSCRIBE)
    const flags: LinkFlag[] = []
    if (item.empty) flags.push('empty')
    if (/^http:\/\//i.test(item.url)) flags.push('insecure')
    if (unknown.length > 0) flags.push('unknown-tag')

    links.push({
      id: `${index}:${item.url}`,
      url: item.url,
      label: item.label,
      kind: isAdvisory(item.url) ? 'advisory' : 'tracked',
      element: item.element,
      flags,
      block: item.block,
    })
  })
  return links
}

export interface ImageRef {
  id: string
  label: string
  /** which mj-image this is, in document order, so the editor can select the same one */
  nth: number
}

export type ImageWithoutAlt = ImageRef

/** Images carrying no description, for the screen readers and the blocked-images view of an inbox. */
export function imagesWithoutAlt(mjml: string): ImageWithoutAlt[] {
  try {
    const doc = new DOMParser().parseFromString(expandSelfClosing(mjml ?? ''), 'text/html')
    const found: ImageRef[] = []
    ;[...doc.querySelectorAll('mj-image')].forEach((node, index) => {
      if ((node.getAttribute('alt') ?? '').trim() !== '') return
      // only a real file name reads as one: a placeholder path ends in something like 600x300
      const file = (node.getAttribute('src') ?? '').trim().split(/[?#]/)[0].split('/').pop() ?? ''
      found.push({ id: `image-no-alt:${index}`, label: labelOf(/\.[a-z0-9]+$/i.test(file) ? file : '', 'Image'), nth: index })
    })
    return found
  } catch {
    return []
  }
}

/** The unknown tag keys in a URL, for the row's explanation. */
export function unknownTagsIn(url: string, tags: PersonalizationTag[]): string[] {
  return unknownTags(extractTags(url), tags).filter((key) => key !== UNSUBSCRIBE)
}

/** Hosts that only ever serve stand-in artwork. Designs saved before the library existed still point at them. */
const PLACEHOLDER_HOSTS = ['placehold.co', 'placehold.it', 'placeholder.com']

function isPlaceholderSrc(src: string): boolean {
  const value = src.trim()
  if (value === '') return true
  try {
    const host = new URL(value, 'https://example.invalid').hostname.toLowerCase()
    return PLACEHOLDER_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))
  } catch {
    return false
  }
}

/** Images still showing a stand-in rather than a picture from the workspace library. Advice only. */
export function placeholderImages(mjml: string): ImageRef[] {
  try {
    const doc = new DOMParser().parseFromString(expandSelfClosing(mjml ?? ''), 'text/html')
    const found: ImageRef[] = []
    ;[...doc.querySelectorAll('mj-image')].forEach((node, index) => {
      if (!isPlaceholderSrc(node.getAttribute('src') ?? '')) return
      found.push({ id: `image-placeholder:${index}`, label: 'Image', nth: index })
    })
    return found
  } catch {
    return []
  }
}
