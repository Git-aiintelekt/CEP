/** A tag (or an emoji) going into the subject or the preheader, which the server caps at 300 characters. */
import { charCount } from '@/features/emoji/text'

import { spliceText } from './insertAtCaret'

export const HEADER_MAX = 300
export type HeaderField = 'subject' | 'preheader'

export const noRoomNote = (token: string, field: HeaderField) =>
  `No room for ${token}: the ${field === 'subject' ? 'subject line' : 'preheader'} is limited to ${HEADER_MAX} characters.`

/** The new value and caret, or the reason it was refused: a tag is never cut short to fit. */
export function insertIntoHeader(
  field: HeaderField, value: string, start: number, end: number, token: string,
): { value: string; caret: number } | { refused: string } {
  const next = spliceText(value, start, end, token)
  return charCount(next.value) > HEADER_MAX ? { refused: noRoomNote(token, field) } : next
}
