/**
 * The component a report is listed under (docs/mockups/report-component.html, option A): Automatic (its dataset's component) or
 * any component of the suite. The list comes from the catalogue (suite_component), so a component added to the suite later is
 * offered with no change here. Hidden until the database can keep a report's own component (patch 0075).
 */
import { Select } from '@/components/Form'
import { useComponents } from '../reportComponents'

export function ComponentSelect({ value, auto, onChange, disabled, label = 'Component', inline = false, id, describedBy }: {
  value: string | null
  /** the dataset's component key, which Automatic stands for; null before a dataset is chosen */
  auto: string | null
  onChange: (key: string | null) => void
  disabled?: boolean
  label?: string
  /** a label beside a small select (the report page, the editor, Ask for a Report's bar) rather than a form field's select */
  inline?: boolean
  id?: string
  describedBy?: string
}) {
  const { components, ready, nameOf } = useComponents()
  if (!ready) return null
  const autoName = nameOf(auto)
  const select = (
    <Select id={id} describedBy={describedBy} aria-label={inline ? label : undefined} controlSize={inline ? 'sm' : undefined} value={value ?? ''} disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{autoName ? `Automatic (${autoName})` : 'Automatic'}</option>
      {components.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
    </Select>
  )
  if (!inline) return select
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-800">
      <span>{label}</span>
      <span className="w-44">{select}</span>
    </label>
  )
}
