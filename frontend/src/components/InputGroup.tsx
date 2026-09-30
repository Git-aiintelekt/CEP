import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

import { borderClass, type ControlSize, type ControlTone } from './controlStyles'

interface InputGroupProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  ref?: Ref<HTMLInputElement>
  /** an icon before the text */
  start?: ReactNode
  /** an xs IconButton after the text: clear, insert a field */
  end?: ReactNode
  /** a unit after the value: px, % */
  suffix?: string
  controlSize?: ControlSize
  tone?: ControlTone
  invalid?: boolean
  warning?: boolean
  describedBy?: string
}

const HEIGHT: Record<ControlSize, string> = { sm: 'h-8 rounded-control-md', md: 'h-10 rounded-control-lg' }

/**
 * A text input with things inside its border. The wrapper carries the border and the focus ring (focus-within),
 * so the ring surrounds the adornments too; the input itself is bare.
 */
export function InputGroup({ start, end, suffix, controlSize = 'sm', tone = 'default', invalid = false, warning = false, describedBy, disabled, className = '', ...props }: InputGroupProps) {
  const fill =
    disabled ? 'border-line bg-fill-subtle text-ink-300'
    : tone === 'sunken' ? `${invalid || warning ? borderClass(invalid, warning) : 'border-transparent'} bg-surface-sunken focus-within:bg-surface`
    : `${borderClass(invalid, warning)} bg-surface`
  return (
    <div
      className={`flex w-full items-center gap-1 border pr-1 pl-2 transition-colors duration-base ease-standard focus-within:border-brand-600 focus-within:shadow-focus ${HEIGHT[controlSize]} ${fill} ${className}`}
    >
      {start && <span className="flex shrink-0 items-center text-ink-800">{start}</span>}
      <input
        {...props}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="cep-input-bare h-full min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none disabled:text-ink-300"
      />
      {suffix && <span className={`shrink-0 pr-1 text-xs ${disabled ? 'text-ink-300' : 'text-ink-800'}`}>{suffix}</span>}
      {end}
    </div>
  )
}
