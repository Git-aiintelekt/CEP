import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export type PillTone = 'neutral' | 'danger' | 'warning'

const BASE =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control-md border px-[10px] text-label font-medium whitespace-nowrap transition-colors duration-base ease-standard'

/** Neutral pills walk the grey ramp; a tinted pill has no darker fill in the system, so its edge carries the state. */
const TONE: Record<PillTone, string> = {
  neutral: 'border-line bg-surface text-ink-800 hover:bg-surface-subtle active:bg-fill-subtle',
  danger: 'border-danger bg-danger-bg text-danger-text hover:border-danger-text active:border-danger-text',
  warning: 'border-warning bg-warning-bg text-warning-text hover:border-warning-text active:border-warning-text',
}

const DISABLED = 'cursor-not-allowed border-line bg-fill-subtle text-ink-300'

interface PillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  ref?: Ref<HTMLButtonElement>
  tone?: PillTone
  icon?: LucideIcon
  /** the panel this pill opens is showing: the chevron points up */
  open?: boolean
  /** off for a pill that opens nothing */
  chevron?: boolean
  disabled?: boolean
  children: ReactNode
}

/** A 32px status pill in a bar: a 14px icon, a short count and the chevron of the panel it opens. */
export function Pill({ tone = 'neutral', icon: Icon, open = false, chevron = true, disabled = false, type = 'button', className = '', children, onClick, ...props }: PillProps) {
  const Chevron = open ? ChevronUp : ChevronDown
  return (
    <button
      {...props}
      type={type}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={`${BASE} ${disabled ? DISABLED : TONE[tone]} ${className}`}
    >
      {Icon && <Icon size={14} strokeWidth={1.5} aria-hidden />}
      {children}
      {chevron && <Chevron size={14} strokeWidth={1.5} aria-hidden />}
    </button>
  )
}
