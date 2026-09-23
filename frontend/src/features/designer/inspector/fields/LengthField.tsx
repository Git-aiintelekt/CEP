/** A number and its unit. px and % are the only units MJML accepts here; em, rem and a bare number are errors. */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { FieldRow } from './FieldRow'
import { controlClass } from './controls'
import { isNumber, lengthError, splitLength, type LengthUnit } from './length'
import { INHERITED_NOTE, type Field } from './types'

interface LengthExtras {
  min?: number
  max?: number
  step?: number
  units?: readonly LengthUnit[]
}

export type LengthFieldProps = Field<LengthExtras>

export function LengthField({
  label, value, effective, onPreview, onCommit, onCancel, disabled = false, inherited = false, inheritedNote,
  min, max, step = 1, units = ['px'],
}: LengthFieldProps) {
  const own = splitLength(value, units)
  const fromEmail = splitLength(effective, units)

  const [text, setText] = useState(own?.amount ?? '')
  const [unit, setUnit] = useState<LengthUnit>(own?.unit ?? fromEmail?.unit ?? units[0])
  const [error, setError] = useState<string | null>(null)
  // the value can change under us (another field, an undo), so the input follows it unless it is being edited
  const editing = useRef(false)

  useEffect(() => {
    if (editing.current) return
    setText(own?.amount ?? '')
    setUnit(own?.unit ?? fromEmail?.unit ?? units[0])
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the incoming value only
  }, [value, effective])

  const acceptable = (amount: string): boolean => {
    if (!isNumber(amount)) return false
    const parsed = Number(amount)
    if (min !== undefined && parsed < min) return false
    return !(max !== undefined && parsed > max)
  }

  const type = (next: string) => {
    editing.current = true
    setText(next)
    if (next.trim() === '') {
      setError(null)
      return
    }
    if (!acceptable(next.trim())) {
      setError(lengthError(units))
      return
    }
    setError(null)
    onPreview?.(`${next.trim()}${unit}`)
  }

  const commit = () => {
    editing.current = false
    const trimmed = text.trim()
    if (trimmed === '') {
      setError(null)
      onCommit(null)
      return
    }
    if (!acceptable(trimmed)) {
      setError(lengthError(units))
      return
    }
    setError(null)
    onCommit(`${trimmed}${unit}`)
  }

  const revert = () => {
    editing.current = false
    setText(own?.amount ?? '')
    setError(null)
    onCancel?.()
  }

  const nudge = (direction: 1 | -1, large: boolean) => {
    const from = Number(isNumber(text) ? text.trim() : (own?.amount ?? fromEmail?.amount ?? '0'))
    const moved = from + direction * step * (large ? 10 : 1)
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, moved))
    // a float step can leave 0.30000000000000004 behind
    const next = String(Math.round(bounded * 1000) / 1000)
    editing.current = true
    setText(next)
    setError(null)
    onPreview?.(`${next}${unit}`)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      nudge(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      revert()
    }
  }

  const pickUnit = (next: LengthUnit) => {
    setUnit(next)
    editing.current = false
    const trimmed = text.trim()
    if (trimmed !== '' && acceptable(trimmed)) onCommit(`${trimmed}${next}`)
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
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            disabled={disabled}
            placeholder={fromEmail?.amount ?? ''}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(event) => type(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            className={`${controlClass(invalid, disabled)} cep-num min-w-0 flex-1`}
          />
          {units.length === 1 ?
            <span className={`shrink-0 text-xs ${disabled ? 'text-ink-300' : 'text-ink-500'}`}>{unit}</span>
          : <div role="radiogroup" aria-label={`${label} unit`} className="flex shrink-0 items-center gap-0.5">
              {units.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={unit === option}
                  disabled={disabled}
                  onClick={() => pickUnit(option)}
                  className={`h-8 rounded-sm border px-1.5 text-xs transition-colors duration-base ease-standard ${
                    disabled && unit === option ? 'border-ink-300 bg-line text-ink-700'
                    : disabled ? 'border-line bg-line-subtle text-ink-300'
                    : unit === option ? 'border-brand-600 bg-brand-100 text-brand-800'
                    : 'border-line bg-surface text-ink-700 hover:bg-line-subtle'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          }
        </div>
      )}
    </FieldRow>
  )
}
