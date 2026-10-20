/**
 * The designer's canvas runs what a design holds, so a design is cleaned before it reaches it: a saved project before
 * loadProjectData, and every HTML the editor parses (Custom HTML, code import, pasted content) through its parse:html event.
 * Cleaning drops component scripts, inline event handlers, embedded pages (iframe, object, embed, frame), base and meta
 * elements and javascript: links, and runs DOMPurify over HTML held as a component's content. The server refuses such a
 * design on save too (backend apps/templates/design.py unsafe_state); this covers designs saved before that check.
 */
import DOMPurify from 'dompurify'

const UNSAFE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta'])
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background', 'lowsrc', 'dynsrc'])
const UNSAFE_URL = /^(javascript|vbscript|data:text\/html)/i

type Json = unknown
type Plain = Record<string, Json>

/** the text without spaces and control characters, as a browser reads a link's scheme */
const withoutBlanks = (text: string) => Array.from(text).filter((c) => c.charCodeAt(0) > 32).join('')

const isPlain = (value: Json): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value)

function unsafeTag(value: Plain): boolean {
  return ['tagName', 'type'].some((key) => typeof value[key] === 'string' && UNSAFE_TAGS.has((value[key] as string).toLowerCase()))
}

function cleanAttributes(attributes: Plain): Plain {
  const kept: Plain = {}
  for (const [name, value] of Object.entries(attributes)) {
    const lowered = name.toLowerCase()
    if (lowered.startsWith('on') || lowered === 'srcdoc') continue
    if (URL_ATTRIBUTES.has(lowered) && UNSAFE_URL.test(withoutBlanks(String(value)))) continue
    kept[name] = value
  }
  return kept
}

/** HTML held as text: cleaned when it is markup, left alone when it is plain text */
export function cleanHtml(html: string): string {
  return html.includes('<') ? DOMPurify.sanitize(html, { FORBID_TAGS: [...UNSAFE_TAGS], FORBID_ATTR: ['srcdoc'] }) : html
}

/** a component definition, a list of them, or any JSON holding them (a whole project), with the unsafe parts left out.
 * Components held as a string are left to the parser, whose output is cleaned in turn (cleanParsed). */
export function cleanDesign<T>(value: T): T {
  if (Array.isArray(value)) return value.filter((item) => !(isPlain(item) && unsafeTag(item))).map((item) => cleanDesign(item)) as T
  if (!isPlain(value)) return value
  const out: Plain = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'script' || key === 'script-export') continue
    if (key === 'attributes' && isPlain(item)) out[key] = cleanAttributes(item)
    else if (key === 'content' && typeof item === 'string') out[key] = value.type === 'textnode' ? item : cleanHtml(item)   // a text node's content is text, shown escaped
    else out[key] = cleanDesign(item)
  }
  return out as T
}

/** the parser's output, its shape kept (one definition or a list): an unsafe element alone becomes empty text */
export function cleanParsed(html: unknown): unknown {
  if (Array.isArray(html)) return cleanDesign(html)
  if (isPlain(html) && unsafeTag(html)) return { type: 'textnode', content: '' }
  return cleanDesign(html)
}
