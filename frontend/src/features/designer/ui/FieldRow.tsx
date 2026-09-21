/**
 * The inspector's field frame. inline: a 64px label beside the control, the note, error and Reset on a line
 * under it (the compact properties panel). stacked: label above, for popovers and wider forms.
 */
import { useId, type ReactNode } from 'react'

export type FieldRowLayout = 'inline' | 'stacked'
export type FieldFootTone = 'default' | 'warning' | 'error'

const FOOT_TONE: Record<FieldFootTone, string> = {
  default: 'text-ink-500',
  warning: 'font-medium text-warning-text',
  error: 'font-medium text-danger-text',
}

interface FieldRowProps {
  label: string
  layout?: FieldRowLayout
  /** helper, inherited-from note, or a warning such as low contrast */
  note?: string
  noteTone?: Exclude<FieldFootTone, 'error'>
  error?: string
  /** shown when the block overrides an inherited value */
  onReset?: () => void
  resetLabel?: string
  disabled?: boolean
  /** given the ids to wire onto the control, since a radiogroup labels itself differently from an input */
  children: (ids: { id: string; labelId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function FieldRow({ label, layout = 'inline', note, noteTone = 'default', error, onReset, resetLabel = 'Reset', disabled = false, children }: FieldRowProps) {
  const id = useId()
  const labelId = `${id}-label`
  const footId = `${id}-foot`
  const foot = error ?? note
  const footTone: FieldFootTone = error ? 'error' : noteTone
  const showReset = Boolean(onReset) && !disabled
  const control = children({ id, labelId, describedBy: foot ? footId : undefined, invalid: Boolean(error) })

  const labelEl = (
    <label id={labelId} htmlFor={id} className={`text-xs ${disabled ? 'text-ink-300' : 'text-ink-700'} ${layout === 'inline' ? 'w-16 shrink-0 pt-2' : ''}`}>
      {label}
    </label>
  )

  const footRow = (foot || showReset) && (
    <div className={`mt-1 flex items-start gap-2 ${layout === 'inline' ? 'pl-18' : ''}`}>
      <p id={foot ? footId : undefined} className={`min-w-0 flex-1 text-xs ${FOOT_TONE[footTone]}`}>
        {foot}
      </p>
      {showReset && (
        // -my-2 keeps the 32px hit area without making the foot line 32px tall
        <button
          type="button"
          onClick={onReset}
          className="-my-2 -mr-2 inline-flex h-8 shrink-0 items-center rounded-sm px-2 text-xs font-semibold text-brand-800 transition-colors duration-fast ease-standard hover:bg-line-subtle active:bg-line"
        >
          {resetLabel}
        </button>
      )}
    </div>
  )

  if (layout === 'stacked') {
    return (
      <div className="flex flex-col gap-1 py-1.5">
        {labelEl}
        {control}
        {footRow}
      </div>
    )
  }

  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2">
        {labelEl}
        <div className="flex min-h-8 min-w-0 flex-1 items-center">{control}</div>
      </div>
      {footRow}
    </div>
  )
}
