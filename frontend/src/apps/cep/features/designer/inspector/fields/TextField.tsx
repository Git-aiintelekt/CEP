/** Plain text, one line or several. Validation runs on commit, so half-typed text is never flagged as wrong. */
import { Plus } from 'lucide-react'
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
  /** a text area: Enter starts a new line, and the words are committed when focus leaves */
  multiline?: boolean
  /** tags one tap away, as chips under the field */
  quickTags?: { key: string; label: string }[]
}

export type TextFieldProps = Field<TextExtras>

export function TextField({
  label, value, effective, onPreview, onCommit, onCancel, disabled = false, inherited = false, inheritedNote, placeholder, validate, tagPicker,
  multiline = false, quickTags,
}: TextFieldProps) {
  const [text, setText] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

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

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !multiline) {
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
      {({ id, describedBy, invalid }) => {
        const shared = {
          ref: input,
          id,
          value: text,
          disabled,
          placeholder: placeholder ?? effective ?? '',
          'aria-invalid': invalid || undefined,
          'aria-describedby': describedBy,
          onChange: (event: { target: { value: string } }) => {
            editing.current = true
            setText(event.target.value)
            if (error !== null) setError(null)
            onPreview?.(event.target.value.trim())
          },
          onKeyDown,
          onBlur: commit,
        }
        return (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              {multiline ?
                <textarea {...shared} rows={4} className={`${controlClass(invalid, disabled).replace('h-8', 'py-1.5')} min-w-0 flex-1 resize-y`} />
              : <input {...shared} type="text" autoComplete="off" className={`${controlClass(invalid, disabled)} min-w-0 flex-1`} />}
              {tagPicker ?
                <TagPickerButton tags={tagPicker.tags} channel={tagPicker.channel} recent={tagPicker.recent} disabled={disabled} onPick={insertTag} />
              : null}
            </div>
            {quickTags && quickTags.length > 0 ?
              <div className="flex flex-wrap gap-1">
                {quickTags.map((tag) => (
                  <button
                    key={tag.key}
                    type="button"
                    disabled={disabled}
                    aria-label={`Insert ${tag.label}`}
                    // keeps the caret where it was: the tag goes there, not wherever focus happened to land
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertTag(tag.key)}
                    className={`inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-xs transition-colors duration-base ease-standard ${
                      disabled ? 'border-line bg-fill-subtle text-ink-300' : 'border-line bg-surface text-ink-800 hover:bg-fill-subtle'
                    }`}
                  >
                    <Plus size={12} strokeWidth={1.5} aria-hidden />
                    {tag.label}
                  </button>
                ))}
              </div>
            : null}
          </div>
        )
      }}
    </FieldRow>
  )
}
