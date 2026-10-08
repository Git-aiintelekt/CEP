import { Slash } from 'lucide-react'
import type { ButtonHTMLAttributes, Ref } from 'react'

interface SwatchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'children'> {
  ref?: Ref<HTMLButtonElement>
  /** a CSS colour; empty means "no colour" and shows a slash */
  color?: string
  /** the colour's name: accessible name and hover hint */
  label: string
  /** sm (24px) in palettes; md (32px) as the field's trigger */
  size?: 'sm' | 'md'
  selected?: boolean
}

/**
 * One colour chip. The fill is the user's colour, so it is the one inline style; selection is a 2px brand border,
 * never a tick alone. Pass aria-pressed or aria-checked for the group's semantics.
 */
export function Swatch({ color, label, size = 'sm', selected = false, disabled, type = 'button', className = '', title, style, ...props }: SwatchProps) {
  const ring =
    selected ? 'border-2 border-link'
    : disabled ? 'border border-line'
    : 'border border-line hover:border-ink-300'
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      style={{ backgroundColor: color || undefined, ...style }}
      className={`flex shrink-0 items-center justify-center rounded-sm transition-colors duration-base ease-standard disabled:cursor-not-allowed ${size === 'md' ? 'h-8 w-8' : 'h-6 w-6'} ${color ? '' : 'bg-surface'} ${ring} ${className}`}
    >
      {!color && <Slash size={size === 'md' ? 16 : 14} strokeWidth={1.5} aria-hidden className="text-ink-300" />}
    </button>
  )
}
