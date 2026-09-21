/** A segmented control of three alignments. Selected is a Blue 600 outline over a light tint, never a blue fill. */
import { createElement, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { FieldRow } from './FieldRow'
import { ALIGN_OPTIONS, type AlignAxis } from './options'
import { INHERITED_NOTE, type Field } from './types'

export type AlignFieldProps = Field<{ axis?: AlignAxis }>

export function AlignField({
  label, value, effective, onCommit, disabled = false, inherited = false, inheritedNote, axis = 'horizontal',
}: AlignFieldProps) {
  const options = ALIGN_OPTIONS[axis]
  const shown = value ?? effective ?? null
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // with nothing chosen the first option is the one the Tab key reaches, so the group is never a dead end
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === shown))

  /**
   * Counted from whichever button has focus, not from the value: the parent takes a frame to send the new value
   * back, and two quick presses would otherwise both move from the same stale place.
   */
  const move = (event: ReactKeyboardEvent<HTMLDivElement>, delta: number) => {
    event.preventDefault()
    const focused = buttons.current.indexOf(document.activeElement as HTMLButtonElement)
    const from = focused === -1 ? activeIndex : focused
    const next = (from + delta + options.length) % options.length
    buttons.current[next]?.focus()
    onCommit(options[next].value)
  }

  return (
    <FieldRow
      label={label}
      inheritedNote={inherited && value === null ? (inheritedNote ?? INHERITED_NOTE) : undefined}
      canReset={value !== null}
      onReset={() => onCommit(null)}
      disabled={disabled}
    >
      {({ labelId }) => (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="flex items-center gap-1"
          onKeyDown={(event) => {
            if (disabled) return
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1)
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1)
          }}
        >
          {options.map((option, index) => {
            const selected = option.value === shown
            return (
              <button
                key={option.value}
                ref={(node) => {
                  buttons.current[index] = node
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                tabIndex={index === activeIndex ? 0 : -1}
                disabled={disabled}
                onClick={() => onCommit(option.value)}
                // read-only still has to say which one is chosen, so disabled keeps the distinction in greys
                className={`flex h-8 flex-1 items-center justify-center rounded-sm border transition-colors duration-base ease-standard ${
                  disabled && selected ? 'border-ink-300 bg-line text-ink-700'
                  : disabled ? 'border-line bg-line-subtle text-ink-300'
                  : selected ? 'border-brand-600 bg-brand-100 text-brand-800'
                  : 'border-line bg-surface text-ink-700 hover:bg-line-subtle'
                }`}
              >
                {createElement(option.icon, { size: 16, strokeWidth: 1.5, 'aria-hidden': true })}
              </button>
            )
          })}
        </div>
      )}
    </FieldRow>
  )
}
