import { Minus, Plus } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

import { borderClass } from '@/components/controlStyles'

interface StepperProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'value'> {
  value: string
  onChange: (text: string) => void
  onDecrement: () => void
  onIncrement: () => void
  unit?: string
  invalid?: boolean
  canDecrement?: boolean
  canIncrement?: boolean
  describedBy?: string
}

const STEP =
  'flex h-full w-7 shrink-0 items-center justify-center text-ink-700 transition-colors duration-fast ease-standard hover:bg-line-subtle active:bg-line disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-300'

/**
 * A number field with − and + either side. The buttons are pointer affordances only (tabIndex -1): keyboard users
 * already step with ArrowUp and ArrowDown in the input, so the field stays a single tab stop.
 */
export function Stepper({ value, onChange, onDecrement, onIncrement, unit, invalid = false, canDecrement = true, canIncrement = true, describedBy, disabled, className = '', ...props }: StepperProps) {
  const frame = disabled ? 'border-line bg-line-subtle' : `${borderClass(invalid)} bg-surface`
  return (
    <div className={`flex h-8 w-full items-center overflow-hidden rounded-sm border transition-colors duration-base ease-standard focus-within:border-brand-600 focus-within:shadow-focus ${frame} ${className}`}>
      <button type="button" tabIndex={-1} aria-label="Decrease" title="Decrease" disabled={disabled || !canDecrement} onClick={onDecrement} className={STEP}>
        <Minus size={14} strokeWidth={1.5} aria-hidden />
      </button>
      <input
        {...props}
        type="text"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="cep-input-bare cep-num h-full min-w-0 flex-1 bg-transparent text-center text-sm text-ink-900 outline-none disabled:text-ink-300"
      />
      {unit && <span className={`shrink-0 pr-1 text-xs ${disabled ? 'text-ink-300' : 'text-ink-500'}`}>{unit}</span>}
      <button type="button" tabIndex={-1} aria-label="Increase" title="Increase" disabled={disabled || !canIncrement} onClick={onIncrement} className={STEP}>
        <Plus size={14} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  )
}
