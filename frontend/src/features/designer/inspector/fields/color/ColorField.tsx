/** A swatch that opens the picker, plus the hex in writing. Both commit the same six-digit lowercase value. */
import { Info, Slash } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { FieldRow } from '../FieldRow'
import { controlClass } from '../controls'
import { INHERITED_NOTE, type Field } from '../types'
import { ColorPicker } from './ColorPicker'
import { isHardToRead, normaliseHex } from './colorMath'
import { nameForHex } from './palette'

export const HEX_ERROR = 'Use a six-digit hex colour'
export const CONTRAST_HINT = 'Hard to read on this background'
export const NO_COLOR_NAME = 'No colour'
export const SWATCH_LABEL = 'Choose a colour'

/** The panel measures 426px with every group shown; below this much room it opens upwards instead. */
const PANEL_HEIGHT = 430

export type ColorFieldProps = Field<{
  /** the colour this one will be seen against, when we know it: only used for the readability hint */
  against?: string | null
  recent?: string[]
  onRecentUse?: (hex: string) => void
}>

export function ColorField({
  label, value, effective, onPreview, onCommit, onCancel, disabled = false, inherited = false, inheritedNote,
  against, recent = [], onRecentUse,
}: ColorFieldProps) {
  const dropdown = useSingleDropdown<'picker'>()
  const [text, setText] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)
  const [flip, setFlip] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const editing = useRef(false)

  useEffect(() => {
    if (editing.current) return
    setText(value ?? '')
    setError(null)
  }, [value])

  const shown = normaliseHex(value ?? '') ?? normaliseHex(effective ?? '')
  const trigger = dropdown.triggerProps('picker')

  const openPicker = () => {
    const box = wrapper.current?.getBoundingClientRect()
    if (box) setFlip(window.innerHeight - box.bottom < PANEL_HEIGHT && box.top > PANEL_HEIGHT)
    trigger.onClick()
  }

  const commitText = () => {
    const trimmed = text.trim()
    if (trimmed === '') {
      editing.current = false
      setError(null)
      onCommit(null)
      return
    }
    const written = normaliseHex(trimmed)
    if (written === null) {
      setError(HEX_ERROR)
      return
    }
    editing.current = false
    setError(null)
    setText(written)
    onCommit(written)
    onRecentUse?.(written)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitText()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      editing.current = false
      setText(value ?? '')
      setError(null)
      onCancel?.()
    }
  }

  const hint = against && shown && isHardToRead(shown, against) ? CONTRAST_HINT : null

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
        <div ref={wrapper} className="relative">
          <div className="flex items-center gap-1">
            <button
              {...trigger}
              type="button"
              onClick={disabled ? undefined : openPicker}
              aria-label={`${SWATCH_LABEL}: ${shown === null ? NO_COLOR_NAME : nameForHex(shown)}`}
              aria-disabled={disabled || undefined}
              style={shown === null ? undefined : { backgroundColor: shown }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors duration-base ease-standard ${
                disabled ? 'border-line' : 'border-line hover:border-ink-300'
              } ${shown === null ? 'bg-surface' : ''}`}
            >
              {shown === null ? <Slash size={16} strokeWidth={1.5} className="text-ink-300" aria-hidden /> : null}
            </button>
            <input
              id={id}
              type="text"
              autoComplete="off"
              size={12}
              value={text}
              disabled={disabled}
              placeholder={normaliseHex(effective ?? '') ?? ''}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(event) => {
                editing.current = true
                setText(event.target.value)
                if (error !== null) setError(null)
              }}
              onKeyDown={onKeyDown}
              onBlur={commitText}
              className={`${controlClass(invalid, disabled)} cep-num min-w-0 flex-1`}
            />
          </div>

          {dropdown.isOpen('picker') && !disabled ?
            <ColorPicker
              value={value ?? shown}
              recent={recent}
              flip={flip}
              panelProps={dropdown.panelProps('picker')}
              onPreview={onPreview}
              onCommit={onCommit}
              onCancel={onCancel}
              onRecentUse={onRecentUse}
            />
          : null}

          {hint !== null ?
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
              <Info size={12} strokeWidth={1.5} className="shrink-0" aria-hidden />
              {hint}
            </p>
          : null}
        </div>
      )}
    </FieldRow>
  )
}
