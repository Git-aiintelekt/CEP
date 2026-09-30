/**
 * A number and its unit. px and % are what the email can carry; em and rem can be typed and are written as px the
 * moment the value is committed, with the px shown while it is being typed so nothing is a surprise.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { FieldRow } from './FieldRow'
import { controlClass } from './controls'
import { DEFAULT_EM_BASE, fromPx, isNumber, lengthError, offeredUnits, splitLength, toPx, written, type LengthUnit, type TypedUnit } from './length'
import { INHERITED_NOTE, type Field } from './types'

interface LengthExtras {
  min?: number
  max?: number
  step?: number
  units?: readonly LengthUnit[]
  /** the px behind 1em on this block: its effective font size */
  emBase?: number
}

export type LengthFieldProps = Field<LengthExtras>

const converts = (unit: TypedUnit) => unit === 'em' || unit === 'rem'

export function LengthField({
  label, value, effective, onPreview, onCommit, onCancel, disabled = false, inherited = false, inheritedNote,
  min, max, step = 1, units = ['px'], emBase = DEFAULT_EM_BASE,
}: LengthFieldProps) {
  const own = splitLength(value, units)
  const fromEmail = splitLength(effective, units)
  const offered = offeredUnits(units)

  const [text, setText] = useState(own?.amount ?? '')
  const [unit, setUnit] = useState<TypedUnit>(own?.unit ?? fromEmail?.unit ?? units[0])
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

  /** a typed em / rem amount is checked as the px it becomes, which is what min and max are about */
  const acceptable = (amount: string, at: TypedUnit = unit): boolean => {
    if (!isNumber(amount)) return false
    const parsed = converts(at) ? toPx(Number(amount), at, emBase) : Number(amount)
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
    onPreview?.(written(next, unit, emBase))
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
    const out = written(trimmed, unit, emBase)
    // typed in em or rem: the field settles on the px the email gets
    if (converts(unit)) {
      setText(out.slice(0, -2))
      setUnit('px')
    }
    onCommit(out)
  }

  const revert = () => {
    editing.current = false
    setText(own?.amount ?? '')
    setUnit(own?.unit ?? fromEmail?.unit ?? units[0])
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
    onPreview?.(written(next, unit, emBase))
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

  /** the amount in the box as the px it stands for, when it is one that can be carried between px, em and rem */
  const pxInBox = (): number | null => {
    const trimmed = text.trim()
    if (!isNumber(trimmed) || unit === '%') return null
    return toPx(Number(trimmed), unit, emBase)
  }

  const pickUnit = (next: TypedUnit) => {
    const px = pxInBox()
    // em and rem are a way of typing: the amount is shown in that unit, and nothing is written until it is committed
    if (converts(next)) {
      editing.current = true
      setUnit(next)
      setError(null)
      if (px !== null) setText(String(fromPx(px, next, emBase)))
      return
    }
    editing.current = false
    setUnit(next)
    // back to px from em or rem: the box shows the px; px and % are written as they are
    const amount = next === 'px' && px !== null ? String(px) : text.trim()
    if (converts(unit)) setText(amount)
    if (amount === '' || !acceptable(amount, next)) return
    onCommit(written(amount, next, emBase))
  }

  const trimmed = text.trim()
  const asPx = converts(unit) && isNumber(trimmed) ? `= ${toPx(Number(trimmed), unit, emBase)}px in the email` : null

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
        <div className="flex flex-col gap-1">
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
            {offered.length === 1 ?
              <span className={`shrink-0 text-xs ${disabled ? 'text-ink-300' : 'text-ink-800'}`}>{unit}</span>
            : <div role="radiogroup" aria-label={`${label} Unit`} className="flex shrink-0 items-center gap-0.5">
                {offered.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={unit === option}
                    disabled={disabled}
                    title={converts(option) ? `Typed in ${option}, written as px` : undefined}
                    onClick={() => pickUnit(option)}
                    className={`h-8 rounded-sm border px-1.5 text-xs transition-colors duration-base ease-standard ${
                      disabled && unit === option ? 'border-ink-300 bg-fill-muted text-ink-800'
                      : disabled ? 'border-line bg-fill-subtle text-ink-300'
                      : unit === option ? 'border-brand-600 bg-brand-100 text-brand-800'
                      : 'border-line bg-surface text-ink-800 hover:bg-fill-subtle'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            }
          </div>
          {asPx ? <p className="cep-num text-xs text-ink-800" data-as-px>{asPx}</p> : null}
        </div>
      )}
    </FieldRow>
  )
}
