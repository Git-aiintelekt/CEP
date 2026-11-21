/**
 * Pasting into a text message: curly quotes, long dashes, ellipses and invisible spaces from Word, Google Docs or a web page
 * become their plain twins as they land, so one stray character does not turn the whole message into Unicode (70 characters
 * a part instead of 160). The note says what changed and offers Keep as Pasted, until the text is edited again.
 */
import { useState, type ClipboardEvent } from 'react'

import { plainChanges, plainPunctuation } from './sms'

interface PasteNote {
  count: number
  /** the text as it reads now, with the plain characters: the note shows only while it still reads so */
  after: string
  /** the text as it would read with the paste kept as it was */
  asPasted: string
}

export function usePlainPaste(value: string, setValue: (next: string) => void) {
  const [note, setNote] = useState<PasteNote | null>(null)

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain')
    const count = plainChanges(pasted)
    if (!count) return
    event.preventDefault()
    const element = event.currentTarget
    const start = element.selectionStart ?? value.length
    const end = element.selectionEnd ?? value.length
    const plain = plainPunctuation(pasted)
    const after = value.slice(0, start) + plain + value.slice(end)
    setValue(after)
    setNote({ count, after, asPasted: value.slice(0, start) + pasted + value.slice(end) })
    requestAnimationFrame(() => element.setSelectionRange(start + plain.length, start + plain.length))
  }

  const shown = note !== null && note.after === value ? note : null
  return {
    onPaste,
    note: shown && { count: shown.count, keepAsPasted: () => { setValue(shown.asPasted); setNote(null) } },
  }
}
