interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** visible text beside the track; also the accessible name unless ariaLabel is given */
  label?: string
  ariaLabel?: string
  labelledBy?: string
  describedBy?: string
  id?: string
  disabled?: boolean
}

/** 32×18 pill track, 14px knob that slides in 110ms. Disabled keeps on and off apart so the setting stays readable. */
export function Switch({ checked, onChange, label, ariaLabel, labelledBy, describedBy, id, disabled = false }: SwitchProps) {
  const track =
    disabled ? (checked ? 'bg-ink-300' : 'bg-line')
    : checked ? 'bg-brand-600 group-hover:bg-brand-800'
    : 'bg-ink-300'
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 rounded-sm disabled:cursor-not-allowed"
    >
      <span aria-hidden className={`flex h-4.5 w-8 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-base ease-standard ${track}`}>
        <span
          className={`h-3.5 w-3.5 rounded-pill bg-surface transition-transform duration-base ease-standard motion-reduce:transition-none ${checked ? 'translate-x-3.5' : 'translate-x-0'}`}
        />
      </span>
      {label && <span className={`text-xs ${disabled ? 'text-ink-300' : 'text-ink-700'}`}>{label}</span>}
    </button>
  )
}
