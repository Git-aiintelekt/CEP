/**
 * A box's suggestion: grey text that Tab (or the right arrow) puts in while the box is empty; on a touch screen a "Use"
 * button does it. Any other time Tab moves on as usual, and Shift+Tab always moves back. The text goes in through the
 * native value setter and an input event, so a controlled box's onChange and a react-hook-form register both see it.
 * The control takes `peer` and the extra (the tag, the screen-reader words) goes right after it, inside a relative parent.
 */
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'

type Box = HTMLInputElement | HTMLTextAreaElement

export interface SuggestionOptions<T extends Box> {
  /** null or empty: no suggestion, the box shows its own placeholder */
  suggestion?: string | null
  placeholder?: string
  describedBy?: string
  onKeyDown?: (event: KeyboardEvent<T>) => void
  /** where the cursor lands once it is in: the end, or the start for a line meant to stay last (a text's opt-out) */
  cursor?: 'start' | 'end'
  /** centred in a one-line box, at the bottom right of a text area */
  placement?: 'center' | 'bottom'
}

export function fillBox(element: Box, text: string, cursor: 'start' | 'end' = 'end') {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, text)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  const at = cursor === 'start' ? 0 : text.length
  element.focus()
  element.setSelectionRange(at, at)
}

const PLACEMENT = { center: 'top-1/2 right-2 -translate-y-1/2', bottom: 'right-6 bottom-2' } as const

export function useSuggestion<T extends Box>({ suggestion, placeholder, describedBy, onKeyDown, cursor = 'end', placement = 'center' }: SuggestionOptions<T>) {
  const id = useId()
  const [said, setSaid] = useState('')
  const text = suggestion?.trim() ? suggestion : null
  const wordsId = `${id}-suggestion`

  const take = (element: Box) => {
    if (!text) return
    fillBox(element, text, cursor)
    setSaid('Suggestion used')
  }
  const handleKey = (event: KeyboardEvent<T>) => {
    onKeyDown?.(event)
    setSaid('')
    if (event.defaultPrevented || !text) return
    const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing
    if (!plain || (event.key !== 'Tab' && event.key !== 'ArrowRight') || event.currentTarget.value !== '') return
    event.preventDefault()
    event.stopPropagation()       // a dialog's Tab trap must not move focus on after the text went in
    take(event.currentTarget)
  }

  const controlProps = text
    ? { placeholder: text, onKeyDown: handleKey, 'aria-describedby': [describedBy, wordsId].filter(Boolean).join(' '), 'data-suggestion': id }
    : { placeholder, onKeyDown: handleKey, 'aria-describedby': describedBy }

  const extra: ReactNode = (
    <>
      {text && (
        <>
          <span id={wordsId} className="sr-only">Suggestion: {text.trim()}. Press Tab to use it.</span>
          <button type="button" tabIndex={-1} aria-hidden data-suggestion-tag
            onPointerDown={(event) => event.preventDefault()}   // the box keeps its focus, so the tag stays to be clicked
            onClick={() => { const box = Array.from(document.querySelectorAll<Box>('[data-suggestion]')).find((element) => element.dataset.suggestion === id); if (box && box.value === '') take(box) }}
            className={`absolute ${PLACEMENT[placement]} hidden cursor-pointer items-center peer-focus:peer-placeholder-shown:inline-flex`}>
            <kbd className="rounded-xs border border-b-2 border-line bg-surface-subtle px-1.5 pt-[3px] pb-[2px] font-mono text-[11px] leading-none font-medium text-ink-800 pointer-coarse:hidden">Tab</kbd>
            <span className="hidden px-1 text-sm font-medium text-brand-800 pointer-coarse:inline">Use</span>
          </button>
        </>
      )}
      <span aria-live="polite" className="sr-only" data-suggestion-said>{said}</span>
    </>
  )
  return { controlProps, extra, offered: Boolean(text) }
}
