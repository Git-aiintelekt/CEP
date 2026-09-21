import { Check } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: string
}

/** 16px, 2px radius. The native input keeps keyboard and form behaviour; the tick is drawn over it. */
export function Checkbox({ label, disabled, className = '', ...props }: CheckboxProps) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs ${disabled ? 'cursor-not-allowed text-ink-300' : 'cursor-pointer text-ink-900'} ${className}`}>
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          {...props}
          type="checkbox"
          disabled={disabled}
          className="peer h-4 w-4 appearance-none rounded-xs border border-ink-300 bg-surface transition-colors duration-base ease-standard checked:border-brand-600 checked:bg-brand-600 hover:not-checked:border-ink-500 disabled:border-line disabled:bg-line-subtle disabled:checked:bg-ink-300"
        />
        <Check size={12} strokeWidth={2} aria-hidden className="pointer-events-none absolute hidden text-white peer-checked:block" />
      </span>
      {label}
    </label>
  )
}
