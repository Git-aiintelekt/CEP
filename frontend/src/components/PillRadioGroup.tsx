import { useRef, type KeyboardEvent } from 'react'

import { filterChipClass } from './filterChipStyles'

interface PillRadioGroupProps<V extends string> {
  /** the id of the element that names the group */
  labelledBy: string
  value: V
  onChange: (value: V) => void
  options: { value: V; label: string }[]
  disabled?: boolean
}

/** A short choice as pills: one is selected (Blue 100 fill, Blue 800 text, Blue 600 border). One tab stop; arrow keys move and choose. */
export function PillRadioGroup<V extends string>({ labelledBy, value, onChange, options, disabled = false }: PillRadioGroupProps<V>) {
  const refs = useRef(new Map<V, HTMLButtonElement | null>())
  const current = Math.max(0, options.findIndex((option) => option.value === value))
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current === last ? 0 : current + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current === 0 ? last : current - 1)
      : -1
    if (next === -1) return
    event.preventDefault()
    onChange(options[next].value)
    refs.current.get(options[next].value)?.focus()
  }
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-disabled={disabled || undefined} className="flex flex-wrap gap-2">
      {options.map((option, index) => (
        <button key={option.value} ref={(node) => { refs.current.set(option.value, node) }} type="button" role="radio" aria-checked={index === current}
          tabIndex={index === current ? 0 : -1} disabled={disabled} onClick={() => onChange(option.value)} onKeyDown={onKeyDown}
          className={`${filterChipClass(index === current)} px-5 disabled:cursor-not-allowed disabled:opacity-60`}>
          {option.label}
        </button>
      ))}
    </div>
  )
}
