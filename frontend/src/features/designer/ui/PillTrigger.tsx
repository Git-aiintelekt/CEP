import { ChevronDown, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, Ref } from 'react'

export type PillTone = 'neutral' | 'error' | 'warning' | 'success'

const TONE: Record<PillTone, { frame: string; open: string; icon: string }> = {
  neutral: { frame: 'border-line bg-surface text-ink-700 hover:bg-surface-subtle', open: 'bg-surface-subtle', icon: '' },
  success: { frame: 'border-line bg-surface text-ink-700 hover:bg-surface-subtle', open: 'bg-surface-subtle', icon: 'text-success' },
  error: { frame: 'border-danger bg-danger-bg text-danger-text hover:border-danger-plain', open: 'border-danger-plain', icon: '' },
  warning: { frame: 'border-warning bg-warning-bg text-warning-text hover:border-warning-text', open: 'border-warning-text', icon: '' },
}

interface PillTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>
  icon: LucideIcon
  tone?: PillTone
  open: boolean
}

/**
 * The 32px trigger for the editor's summary dropdowns (History, Errors, Links). The tone says what is inside
 * before it is opened. Spread useSingleDropdown's triggerProps onto it.
 */
export function PillTrigger({ icon: Icon, tone = 'neutral', open, type = 'button', className = '', children, ...props }: PillTriggerProps) {
  const style = TONE[tone]
  return (
    <button
      {...props}
      type={type}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors duration-fast ease-standard ${style.frame} ${open ? style.open : ''} ${className}`}
    >
      <Icon size={14} strokeWidth={1.5} aria-hidden className={style.icon} />
      {children}
      <ChevronDown
        size={14}
        strokeWidth={1.5}
        aria-hidden
        className={`transition-transform duration-base ease-standard motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
      />
    </button>
  )
}
