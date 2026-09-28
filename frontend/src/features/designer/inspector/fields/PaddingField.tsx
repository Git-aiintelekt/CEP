/** The four sides, written back as the shortest MJML shorthand. Linked edits all four from whichever you type in. */
import { Link2, Unlink2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { FieldRow } from './FieldRow'
import { controlClass } from './controls'
import { EMPTY_PADDING, PADDING_SIDES, formatPadding, parsePadding, sideToWritten, type Padding, type PaddingSide } from './padding'
import { DEFAULT_EM_BASE } from './length'
import { INHERITED_NOTE, type Field } from './types'

export const PADDING_ERROR = 'Use a number in px or %, or em / rem (written as px)'
export const LINK_SIDES_LABEL = 'Edit All Four Sides Together'

export function PaddingField({ label, value, effective, onPreview, onCommit, onCancel, disabled = false, inherited = false, inheritedNote, emBase = DEFAULT_EM_BASE }: Field<{ emBase?: number }>) {
  const own = parsePadding(value)
  const fromEmail = parsePadding(effective)

  const [sides, setSides] = useState<Padding>(own ?? EMPTY_PADDING)
  const [linked, setLinked] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)

  useEffect(() => {
    if (editing.current) return
    setSides(parsePadding(value) ?? EMPTY_PADDING)
    setError(null)
  }, [value])

  const allEmpty = (next: Padding) => PADDING_SIDES.every((side) => next[side.key].trim() === '')

  const type = (key: PaddingSide, amount: string) => {
    editing.current = true
    const next = linked ? { top: amount, right: amount, bottom: amount, left: amount } : { ...sides, [key]: amount }
    setSides(next)
    if (allEmpty(next)) {
      setError(null)
      return
    }
    const written = formatPadding(next.top, next.right, next.bottom, next.left, emBase)
    setError(written === null ? PADDING_ERROR : null)
    if (written !== null) onPreview?.(written)
  }

  const commit = () => {
    if (allEmpty(sides)) {
      editing.current = false
      setError(null)
      onCommit(null)
      return
    }
    const written = formatPadding(sides.top, sides.right, sides.bottom, sides.left, emBase)
    if (written === null) {
      setError(PADDING_ERROR)
      return
    }
    editing.current = false
    setError(null)
    // a side typed in em or rem settles on the px it became
    setSides({ top: sideToWritten(sides.top, emBase) ?? '', right: sideToWritten(sides.right, emBase) ?? '', bottom: sideToWritten(sides.bottom, emBase) ?? '', left: sideToWritten(sides.left, emBase) ?? '' })
    onCommit(written)
  }

  const revert = () => {
    editing.current = false
    setSides(own ?? EMPTY_PADDING)
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

  const bad = (amount: string) => error !== null && amount.trim() !== '' && sideToWritten(amount, emBase) === null

  return (
    <FieldRow
      label={label}
      inheritedNote={inherited && value === null ? (inheritedNote ?? INHERITED_NOTE) : undefined}
      error={error ?? undefined}
      canReset={value !== null}
      onReset={() => onCommit(null)}
      disabled={disabled}
    >
      {({ labelId, describedBy }) => (
        <div className="flex items-start gap-1" role="group" aria-labelledby={labelId}>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
            {PADDING_SIDES.map((side) => (
              <div key={side.key} className="flex min-w-0 items-center gap-1">
                <span aria-hidden className={`w-2 shrink-0 text-xs ${disabled ? 'text-ink-300' : 'text-ink-500'}`}>
                  {side.letter}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={side.label}
                  aria-invalid={bad(sides[side.key]) || undefined}
                  aria-describedby={describedBy}
                  value={sides[side.key]}
                  disabled={disabled}
                  placeholder={fromEmail?.[side.key] ?? ''}
                  onChange={(event) => type(side.key, event.target.value)}
                  onKeyDown={onKeyDown}
                  onBlur={commit}
                  className={`${controlClass(bad(sides[side.key]), disabled)} cep-num min-w-0 flex-1 px-1.5`}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            aria-label={LINK_SIDES_LABEL}
            aria-pressed={linked}
            disabled={disabled}
            onClick={() => setLinked((was) => !was)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors duration-base ease-standard ${
              disabled && linked ? 'border-ink-300 bg-line text-ink-700'
              : disabled ? 'border-line bg-line-subtle text-ink-300'
              : linked ? 'border-brand-600 bg-brand-100 text-brand-800'
              : 'border-line bg-surface text-ink-700 hover:bg-line-subtle'
            }`}
          >
            {linked ?
              <Link2 size={16} strokeWidth={1.5} aria-hidden />
            : <Unlink2 size={16} strokeWidth={1.5} aria-hidden />}
          </button>
        </div>
      )}
    </FieldRow>
  )
}
