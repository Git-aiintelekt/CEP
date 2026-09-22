/** A few fixed colours, never a free picker. Selected is a 2px Blue 600 ring around the swatch. */
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { FieldRow } from './FieldRow'
import { INHERITED_NOTE, type Field } from './types'

export interface Swatch {
  value: string
  label: string
}

export type SwatchFieldProps = Field<{ swatches: Swatch[] }>

const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.toLowerCase()

export function SwatchField({ label, value, effective, onCommit, disabled = false, inherited = false, inheritedNote, swatches }: SwatchFieldProps) {
  const shown = value ?? effective ?? null
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const activeIndex = Math.max(0, swatches.findIndex((swatch) => same(shown, swatch.value)))

  const move = (event: ReactKeyboardEvent<HTMLDivElement>, delta: number) => {
    event.preventDefault()
    const focused = buttons.current.indexOf(document.activeElement as HTMLButtonElement)
    const next = ((focused === -1 ? activeIndex : focused) + delta + swatches.length) % swatches.length
    buttons.current[next]?.focus()
    onCommit(swatches[next].value)
  }

  return (
    <FieldRow label={label} inheritedNote={inherited && value === null ? (inheritedNote ?? INHERITED_NOTE) : undefined} disabled={disabled}>
      {({ labelId }) => (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="flex items-center gap-2 py-0.5"
          onKeyDown={(event) => {
            if (disabled) return
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1)
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1)
          }}
        >
          {swatches.map((swatch, index) => {
            const selected = same(shown, swatch.value)
            return (
              <button
                key={swatch.value}
                ref={(node) => {
                  buttons.current[index] = node
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={swatch.label}
                title={swatch.label}
                tabIndex={index === activeIndex ? 0 : -1}
                disabled={disabled}
                onClick={() => onCommit(swatch.value)}
                // the colour is the email's, not the app's: it is data, so it is the one inline style here
                style={{ backgroundColor: swatch.value }}
                className={`h-7 w-7 shrink-0 rounded-sm border border-line ring-offset-2 ring-offset-surface transition-shadow duration-base ease-standard ${
                  selected ? `ring-2 ${disabled ? 'ring-ink-300' : 'ring-brand-600'}` : ''
                } ${disabled ? 'cursor-not-allowed' : ''}`}
              />
            )
          })}
        </div>
      )}
    </FieldRow>
  )
}
