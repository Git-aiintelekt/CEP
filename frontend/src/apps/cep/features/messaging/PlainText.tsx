/**
 * The text editors' notes on the SMS alphabet: what a paste changed (with Keep as Pasted), and, while a message is Unicode
 * because of punctuation or invisible spaces, Use Plain Punctuation. Shared by the template editor and the drip editor.
 */
import { buttonClass } from '@/components/buttonStyles'

import { canBePlain, describeCharacter, smsMetrics } from './sms'

export function PasteNote({ note }: { note: { count: number; keepAsPasted: () => void } | null }) {
  if (!note) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-helper text-ink-800" role="status">
      Changed {note.count} pasted {note.count === 1 ? 'character' : 'characters'} (curly quotes, long dashes or invisible spaces) to plain ones, so the text stays in the standard SMS alphabet.
      <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={note.keepAsPasted}>Keep as Pasted</button>
    </p>
  )
}

/** Shown while the text is Unicode and plain punctuation would help. `text` is what is counted (tags filled with samples). */
export function PlainPunctuationNotice({ text, onPlain, readOnly = false, showCharacters = false }:
  { text: string; onPlain: () => void; readOnly?: boolean; showCharacters?: boolean }) {
  const metrics = smsMetrics(text)
  if (metrics.encoding !== 'UCS-2' || !canBePlain(metrics.nonGsmCharacters) || readOnly) return null
  return (
    <div className="flex flex-col items-start gap-0.5">
      <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={onPlain}>Use Plain Punctuation</button>
      <p className="text-helper text-ink-800">
        Swaps curly quotes, long dashes, ellipses and invisible spaces for plain ones, so the text stays in the standard SMS alphabet
        {showCharacters ? ` (now Unicode because of ${metrics.nonGsmCharacters.map(describeCharacter).join(', ')}: 70 characters a part instead of 160).` : '.'}
      </p>
    </div>
  )
}
