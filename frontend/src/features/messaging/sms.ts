/**
 * SMS length the way carriers bill it. Mirrors apps/templates/design.py (sms_metrics): the server's findings are the
 * record, this gives the same numbers while typing.
 *
 *  GSM-7  160 characters in one message, 153 per part when split. ^ { } \ [ ~ ] | € take two.
 *  UCS-2  any character outside GSM-7 (curly quotes, en dash, emoji) switches the WHOLE message: 70, then 67 per part.
 */
import type { PersonalizationTag } from '@/lib/types'

const GSM7_BASIC = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑܧ¿abcdefghijklmnopqrstuvwxyzäöñüà')
const GSM7_EXTENDED = new Set('^{}\\[~]|€\f')
const TAG_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g

export interface SmsMetrics {
  encoding: 'GSM-7' | 'UCS-2'
  /** billable characters */
  units: number
  segments: number
  perSegment: number
  /** the distinct characters that force UCS-2 */
  nonGsmCharacters: string[]
  /** characters left before the message grows by one more segment */
  remaining: number
}

export function smsMetrics(text: string): SmsMetrics {
  const characters = Array.from(text)
  const nonGsm = [...new Set(characters)].filter((ch) => !GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch))
  const unicode = nonGsm.length > 0
  const units = unicode ? text.length /* UTF-16 code units: an emoji is 2 */ : characters.reduce((total, ch) => total + (GSM7_EXTENDED.has(ch) ? 2 : 1), 0)
  const [single, multi] = unicode ? [70, 67] : [160, 153]
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi)
  const capacity = segments <= 1 ? single : segments * multi
  return { encoding: unicode ? 'UCS-2' : 'GSM-7', units, segments, perSegment: segments <= 1 ? single : multi, nonGsmCharacters: nonGsm.slice(0, 20), remaining: capacity - units }
}

/** Tags filled with their sample (or default) value: an estimate of what one recipient gets. Unknown tags stay as typed. */
export function renderWithSamples(text: string, tags: PersonalizationTag[]): string {
  const samples = new Map(tags.map((tag) => [tag.tag_key, tag.sample_value ?? tag.default_value ?? tag.static_value ?? '']))
  return text.replace(TAG_PATTERN, (whole, key: string) => samples.get(key) || whole)
}

const PLAIN: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '…': '...',
  ' ': ' ', '•': '*', '«': '"', '»': '"', '′': "'", '″': '"',
}

/** Word processors insert curly quotes, long dashes and ellipses; their plain twins keep the message in GSM-7. */
export function plainPunctuation(text: string): string {
  return Array.from(text, (ch) => PLAIN[ch] ?? ch).join('')
}

export const canBePlain = (characters: string[]) => characters.some((ch) => ch in PLAIN)

export const OPT_OUT_PATTERN = /\b(stop|unsubscribe|opt[\s-]?out)\b/i

export function describeCharacter(ch: string): string {
  const code = ch.codePointAt(0) ?? 0
  return `${ch === ' ' || ch === ' ' ? 'space' : ch} (U+${code.toString(16).toUpperCase().padStart(4, '0')})`
}
