import type { LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'

export interface SegmentOption<V extends string> {
  value: V
  label: string
  icon?: LucideIcon
}

/**
 * track: a Gray 100 track with a raised white segment (devices, preview width); the track is the 32px control.
 * outline: separate bordered 32px segments, the selected one in brand (alignment, units).
 */
export type SegmentedVariant = 'track' | 'outline'

interface SegmentedControlProps<V extends string> {
  /** the group's accessible name */
  label: string
  options: SegmentOption<V>[]
  value: V
  onChange: (value: V) => void
  variant?: SegmentedVariant
  /** show only icons; the label becomes the accessible name and hover hint */
  iconOnly?: boolean
  /** segments share the full width */
  stretch?: boolean
  disabled?: boolean
  labelledBy?: string
}

const GROUP: Record<SegmentedVariant, string> = {
  track: 'gap-0.5 rounded-sm bg-line-subtle p-0.5',
  outline: 'gap-1',
}

function segmentClass(variant: SegmentedVariant, selected: boolean, disabled: boolean, iconOnly: boolean, stretch: boolean): string {
  const base = `inline-flex items-center justify-center gap-1.5 rounded-sm border text-xs font-semibold whitespace-nowrap transition-colors duration-base ease-standard ${stretch ? 'flex-1' : ''}`
  if (variant === 'track') {
    const shape = `h-7 ${iconOnly ? 'w-8' : 'px-2.5'}`
    if (disabled) return `${base} ${shape} cursor-not-allowed ${selected ? 'border-line bg-surface text-ink-300' : 'border-transparent text-ink-300'}`
    return `${base} ${shape} ${selected ? 'border-line bg-surface text-ink-900' : 'border-transparent text-ink-700 hover:text-ink-900'}`
  }
  const shape = `h-8 ${iconOnly ? 'w-8' : 'min-w-8 px-2'}`
  // disabled keeps the choice readable: the selected segment stays a step darker than the rest
  if (disabled) return `${base} ${shape} cursor-not-allowed ${selected ? 'border-ink-300 bg-line text-ink-700' : 'border-line bg-line-subtle text-ink-300'}`
  return `${base} ${shape} ${selected ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-700 hover:bg-surface-subtle active:bg-line-subtle'}`
}

/** A radio group: one tab stop, arrow keys move and select, Home and End jump to the ends. */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  variant = 'track',
  iconOnly = false,
  stretch = false,
  disabled = false,
  labelledBy,
}: SegmentedControlProps<V>) {
  const refs = useRef(new Map<V, HTMLButtonElement | null>())
  const current = Math.max(0, options.findIndex((option) => option.value === value))

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current === last ? 0 : current + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current === 0 ? last : current - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1
    if (next === -1) return
    event.preventDefault()
    const target = options[next].value
    onChange(target)
    refs.current.get(target)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      className={`${stretch ? 'flex w-full' : 'inline-flex'} items-center ${GROUP[variant]}`}
    >
      {options.map((option, index) => {
        const selected = index === current
        const Icon = option.icon
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current.set(option.value, node)
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconOnly ? option.label : undefined}
            title={iconOnly ? option.label : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={segmentClass(variant, selected, disabled, iconOnly, stretch)}
          >
            {Icon && <Icon size={variant === 'track' ? 14 : 16} strokeWidth={1.5} aria-hidden />}
            {!iconOnly && option.label}
          </button>
        )
      })}
    </div>
  )
}
