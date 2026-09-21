/** Subject or preview text: the label and its counter above a filled field, with the tag picker inside it. */
import { useCallback, useState, type ComponentProps, type FocusEvent, type RefObject } from 'react'

import { HEADER_MAX } from './tags/insertIntoHeader'
import { TagPickerButton } from './tags/TagPickerButton'

export interface HeaderFieldProps {
  id: string
  label: string
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  placeholder: string
  readOnly: boolean
  /** where inboxes start cutting this field off, and the server's own limit */
  advisory: number
  max: number
  /** why the last tag did not go in, or null */
  note: string | null
  onChange: (value: string) => void
  picker: ComponentProps<typeof TagPickerButton>
}

const FIELD_SHELL =
  'flex h-8 min-w-0 items-center gap-[2px] rounded-sm border bg-line-subtle pr-1 pl-2 transition-colors duration-base ease-standard focus-within:border-brand-600 focus-within:bg-surface focus-within:shadow-focus'

export function HeaderField({ id, label, inputRef, value, placeholder, readOnly, advisory, max, note, onChange, picker }: HeaderFieldProps) {
  const noteId = `${id}-note`
  // the { } button appears with the caret and stays while its own picker is open
  const [focused, setFocused] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const onOpenChange = useCallback((open: boolean) => setPickerOpen(open), [])

  const over = value.length > max
  const long = !over && value.length > advisory
  const counter = `${value.length} / ${advisory}${value.length > advisory ? ` · max ${max}` : ''}`
  const message = note ?? (long ? `Over ${advisory} characters may be cut off in some inboxes.` : null)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <label htmlFor={id} className="text-xs font-semibold text-ink-700">
          {label}
        </label>
        <span className="flex-1" />
        <span className={`cep-num text-[11px] ${over ? 'text-danger-plain' : long ? 'text-warning-text' : 'text-ink-700'}`}>{counter}</span>
      </div>
      <div
        className={`${FIELD_SHELL} ${over ? 'border-danger' : long ? 'border-warning' : 'border-transparent'}`}
        onFocus={() => setFocused(true)}
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        <input
          ref={inputRef}
          id={id}
          className={`cep-input-bare h-[30px] w-full min-w-0 border-none bg-transparent text-[13px] outline-none ${readOnly ? 'text-ink-700' : 'text-ink-900'}`}
          value={value}
          maxLength={HEADER_MAX}
          disabled={readOnly}
          aria-describedby={message ? noteId : undefined}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        {!readOnly && (focused || pickerOpen) && <TagPickerButton {...picker} variant="inset" onOpenChange={onOpenChange} />}
      </div>
      <p id={noteId} role="status" aria-live="polite" className={`text-xs ${note ? 'text-danger-text' : 'text-warning-text'} ${message ? '' : 'sr-only'}`}>
        {message ?? ''}
      </p>
    </div>
  )
}
