/** Tags as chips: Enter or comma adds one, Backspace on an empty field takes the last off, and the workspace's tags are suggested as you type. */
import { X } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'

import { iconButtonClass } from '@/components/buttonStyles'
import { formatNumber } from '@/lib/format'

import { TAG_PATTERN } from '../schema'

export const MAX_TAGS = 20

export function TagInput({ value, onChange, suggestions, error, disabled = false }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[]; error?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const [active, setActive] = useState(-1)
  const id = useId()
  const listId = `${id}-suggestions`
  const hintId = `${id}-hint`
  const full = value.length >= MAX_TAGS
  const typed = draft.trim().toLowerCase()
  const matches = typed ? suggestions.filter((tag) => tag.toLowerCase().includes(typed) && !value.some((item) => item.toLowerCase() === tag.toLowerCase())).slice(0, 6) : []
  const open = matches.length > 0

  function add(raw: string) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    if (!tag) return
    if (!TAG_PATTERN.test(tag)) return setProblem('A tag is up to 40 letters, digits and spaces.')
    if (full) return setProblem('Up to 20 tags.')
    if (!value.some((item) => item.toLowerCase() === tag.toLowerCase())) onChange([...value, tag])
    setDraft('')
    setProblem('')
    setActive(-1)
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setActive((now) => (event.key === 'ArrowDown' ? (now + 1) % matches.length : (now - 1 + matches.length) % matches.length))
    } else if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault() // Enter must not submit the pop-up
      add(open && active >= 0 ? matches[active] : draft)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation() // closes the suggestions, not the pop-up
      setDraft('')
      setActive(-1)
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) onChange(value.slice(0, -1))
  }

  const message = error || problem
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="block text-sm font-semibold text-ink-900">Tags</label>
        <span className="cep-num text-helper text-ink-800">{formatNumber(value.length)} of {MAX_TAGS}</span>
      </div>
      <div className="relative mt-1.5">
        <div className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1 focus-within:border-focus focus-within:shadow-focus ${message ? 'border-danger' : 'border-line-control'}`}>
          {value.map((tag) => (
            <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-sm bg-fill-subtle pr-0.5 pl-2 text-xs font-semibold text-ink-800">
              {tag}
              <button type="button" aria-label={`Remove the tag ${tag}`} disabled={disabled} onClick={() => onChange(value.filter((item) => item !== tag))} className={iconButtonClass({ size: 'xs' })}>
                <X size={12} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          ))}
          <input id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-describedby={hintId}
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} value={draft} disabled={disabled}
            onChange={(event) => { setDraft(event.target.value); setActive(-1); setProblem('') }} onKeyDown={onKey} onBlur={() => add(draft)}
            placeholder={value.length === 0 ? 'e.g. Loyalty' : ''} className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-ink-900 outline-none placeholder:text-ink-300" />
        </div>
        {open && (
          <ul id={listId} role="listbox" aria-label="Tags in this workspace" className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface-overlay py-1 shadow-menu">
            {matches.map((tag, index) => (
              <li key={tag} id={`${listId}-${index}`} role="option" aria-selected={index === active}
                onMouseDown={(event) => { event.preventDefault(); add(tag) }}
                className={`cursor-pointer px-3 py-2 text-sm text-ink-900 ${index === active ? 'bg-surface-subtle' : 'hover:bg-surface-hover'}`}>{tag}</li>
            ))}
          </ul>
        )}
      </div>
      <p id={hintId} className={message ? 'mt-1.5 text-helper font-medium text-danger-text' : 'mt-1.5 text-helper text-ink-800'}>
        {message || 'Press Enter or comma to add a tag'}
      </p>
    </div>
  )
}
