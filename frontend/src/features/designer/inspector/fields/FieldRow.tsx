/** The frame every inspector field sits in: label above, note and error below, Reset when the block sets its own. */
import { useId, type ReactNode } from 'react'

import { RESET_LABEL } from './types'

interface FieldRowProps {
  label: string
  inheritedNote?: string
  error?: string
  canReset?: boolean
  onReset?: () => void
  disabled?: boolean
  /** given the ids to wire onto the control, since a radiogroup labels itself differently from an input */
  children: (ids: { id: string; labelId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function FieldRow({ label, inheritedNote, error, canReset = false, onReset, disabled = false, children }: FieldRowProps) {
  const id = useId()
  const labelId = `${id}-label`
  const noteId = `${id}-note`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, inheritedNote ? noteId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="py-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <label id={labelId} htmlFor={id} className="text-xs text-ink-800">
          {label}
        </label>
        {canReset && !disabled ?
          // -my-1 keeps the 32px hit area without making every label row 32px tall
          <button
            type="button"
            onClick={onReset}
            className="-my-1 -mr-2 inline-flex h-8 shrink-0 items-center rounded-sm px-2 text-xs font-medium text-brand-800 transition-colors duration-base ease-standard hover:bg-fill-subtle"
          >
            {RESET_LABEL}
          </button>
        : null}
      </div>

      <div className="mt-1">{children({ id, labelId, describedBy, invalid: Boolean(error) })}</div>

      {inheritedNote ?
        <p id={noteId} className="mt-1 text-xs text-ink-800">
          {inheritedNote}
        </p>
      : null}
      {error ?
        <p id={errorId} className="mt-1 text-xs font-medium text-danger-text">
          {error}
        </p>
      : null}
    </div>
  )
}
