/** On or off. Off clears the setting rather than writing a falsy value, which is what MJML expects. */
import { FieldRow } from './FieldRow'
import { INHERITED_NOTE, type Field } from './types'

export type ToggleFieldProps = Field<{
  /** what to write when the switch is on; full-width writes the string "full-width" */
  onValue: string
}>

export function ToggleField({ label, value, onCommit, disabled = false, inherited = false, inheritedNote, onValue }: ToggleFieldProps) {
  const on = value === onValue

  return (
    <FieldRow
      label={label}
      inheritedNote={inherited && value === null ? (inheritedNote ?? INHERITED_NOTE) : undefined}
      canReset={value !== null}
      onReset={() => onCommit(null)}
      disabled={disabled}
    >
      {({ id, labelId }) => (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={() => onCommit(on ? null : onValue)}
          className={`flex h-5 w-9 items-center rounded-pill border p-0.5 transition-colors duration-base ease-standard ${
            // read-only still has to say whether it is on, so disabled keeps the distinction in greys
            disabled && on ? 'border-ink-300 bg-ink-300'
            : disabled ? 'border-line bg-line-subtle'
            : on ? 'border-brand-600 bg-brand-600' : 'border-line bg-ink-300'
          }`}
        >
          <span
            aria-hidden
            className={`h-3.5 w-3.5 rounded-pill bg-surface transition-transform duration-base ease-standard ${on ? 'translate-x-4' : 'translate-x-0'}`}
          />
        </button>
      )}
    </FieldRow>
  )
}
