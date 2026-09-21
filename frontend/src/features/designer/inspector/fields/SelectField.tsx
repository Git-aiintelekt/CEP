/** A fixed set of values. Native select: it is the one control that already behaves on every platform. */
import { FieldRow } from './FieldRow'
import { controlClass } from './controls'
import type { SelectOption } from './options'
import { INHERITED_NOTE, type Field } from './types'

export type SelectFieldProps = Field<{
  options: SelectOption[]
  /** the row shown when the block sets nothing; picking it clears the setting */
  emptyLabel?: string
}>

export function SelectField({
  label, value, effective, onCommit, disabled = false, inherited = false, inheritedNote, options, emptyLabel = 'Default',
}: SelectFieldProps) {
  const fromEmail = options.find((option) => option.value === effective)

  return (
    <FieldRow
      label={label}
      inheritedNote={inherited && value === null ? (inheritedNote ?? INHERITED_NOTE) : undefined}
      canReset={value !== null}
      onReset={() => onCommit(null)}
      disabled={disabled}
    >
      {({ id, describedBy }) => (
        <select
          id={id}
          value={value ?? ''}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
          className={controlClass(false, disabled)}
        >
          <option value="">{fromEmail ? `${emptyLabel} (${fromEmail.label})` : emptyLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldRow>
  )
}
