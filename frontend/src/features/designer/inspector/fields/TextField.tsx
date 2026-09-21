/** One line of plain text. Validation runs on commit, so half-typed text is never flagged as wrong. */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { TagPickerButton } from '../../tags/TagPickerButton'
import { spliceText } from '../../tags/insertAtCaret'
import { asToken } from '../../tags'
import { FieldRow } from './FieldRow'
import { controlClass } from './controls'
import { INHERITED_NOTE, type Field, type TagPickerSlot } from './types'

interface TextExtras {
  placeholder?: string
  /** returns the message to show, or null when the text is fine */
  validate?: (value: string) => string | null
  tagPicker?: TagPickerSlot
}

export type TextFieldProps = Field<TextExtras>

export function TextField({
  label, value, effective, onPreview, onCommit, onCancel, disabled = false, inherited = false, inheritedNote, placeholder, validate, tagPicker,
}: TextFieldProps) {
  const [text, setText] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing.current) return
    setText(value ?? '')
    setError(null)
  }, [value])

  const commitValue = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      editing.current = false
      setError(null)
      onCommit(null)
      return
    }
    const message = validate?.(trimmed) ?? null
    if (message !== null) {
      // the text stays on screen with the error beside it: retyping it from memory would be worse
      setError(message)
      return
    }
    editing.current = false
    setError(null)
    onCommit(trimmed)
  }
  const commit = () => commitValue(text)

  /** The token goes where the caret was — an input keeps its selection while the picker has focus — and the field commits as if it were typed. */
  const insertTag = (key: string) => {
    const field = input.current
    const start = field?.selectionStart ?? text.length
    const end = field?.selectionEnd ?? start
    const next = spliceText(text, start, end, asToken(key))
    editing.current = true
    setText(next.value)
    tagPicker?.onPick?.(key)
    commitValue(next.value)
    window.setTimeout(() => {
      field?.focus()
      field?.setSelectionRange(next.caret, next.caret)
    }, 0)
  }

  const revert = () => {
    editing.current = false
    setText(value ?? '')
    setError(null)
    onCancel?.()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      revert()
    }
  }

  return (
    <FieldRow
      label={label}
      inheritedNote={inherited && value === null ? (inheritedNote ?? INHERITED_NOTE) : undefined}
      error={error ?? undefined}
      canReset={value !== null}
      onReset={() => onCommit(null)}
      disabled={disabled}
    >
      {({ id, describedBy, invalid }) => (
        <div className="flex items-center gap-1">
          <input
            ref={input}
            id={id}
            type="text"
            autoComplete="off"
            value={text}
            disabled={disabled}
            placeholder={placeholder ?? effective ?? ''}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              editing.current = true
              setText(event.target.value)
              if (error !== null) setError(null)
              onPreview?.(event.target.value.trim())
            }}
            onKeyDown={onKeyDown}
            onBlur={commit}
            className={`${controlClass(invalid, disabled)} min-w-0 flex-1`}
          />
          {tagPicker ?
            <TagPickerButton tags={tagPicker.tags} channel={tagPicker.channel} recent={tagPicker.recent} disabled={disabled} onPick={insertTag} />
          : null}
        </div>
      )}
    </FieldRow>
  )
}
