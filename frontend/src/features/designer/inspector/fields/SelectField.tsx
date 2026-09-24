/** A fixed set of values. Native select: it is the one control that already behaves on every platform. */
import { FieldRow } from './FieldRow'
import { controlClass } from './controls'
import type { SelectOption } from './options'
import { INHERITED_NOTE, type Field } from './types'

export type SelectFieldProps = Field<{
  options: SelectOption[]
  /** the row shown when the block sets nothing; picking it clears the setting */
  emptyLabel?: string
  /** the block always has one of the options: no empty row, nothing to reset */
  required?: boolean
}>

export function SelectField({
  label, value, effective, onCommit, disabled = false, inherited = false, inheritedNote, options, emptyLabel = 'Default', required = false,
}: SelectFieldProps) {
  const fromEmail = options.find((option) => option.value === effective)
  // a value the design carries that the list does not offer (a font from an imported template) is still shown, as itself
  const rows = value === null || options.some((option) => option.value === value) ? options : [{ value, label: value }, ...options]
  const effectiveLabel = fromEmail?.label ?? effective ?? null

  return (
    <FieldRow
      label={label}
      inheritedNote={inherited && value === null ? (inheritedNote ?? INHERITED_NOTE) : undefined}
      canReset={!required && value !== null}
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
          {required ? null : <option value="">{effectiveLabel ? `${emptyLabel} (${effectiveLabel})` : emptyLabel}</option>}
          {rows.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldRow>
  )
}
