import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export type MenuRowTone = 'default' | 'error' | 'warning'

const TITLE_TONE: Record<MenuRowTone, string> = {
  default: 'text-ink-900',
  error: 'text-danger-text',
  warning: 'text-warning-text',
}

interface MenuRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  ref?: Ref<HTMLButtonElement>
  title: ReactNode
  detail?: ReactNode
  /** an icon, status glyph or swatch, top-aligned with the title */
  leading?: ReactNode
  /** a Tag, a shortcut or a small button */
  trailing?: ReactNode
  tone?: MenuRowTone
  /** the current choice: Gray 75 fill plus aria-current */
  selected?: boolean
  /** a hairline under the row; off for tight option lists */
  divider?: boolean
}

/**
 * A row in a Popover. Rendered as a button with data-dropdown-item so useSingleDropdown's arrow keys reach it;
 * disabled rows use aria-disabled and are skipped. Focus is drawn inset because the panel clips its edges.
 */
export function MenuRow({ title, detail, leading, trailing, tone = 'default', selected = false, divider = true, disabled, className = '', type = 'button', onClick, ...props }: MenuRowProps) {
  const state =
    disabled ? 'cursor-not-allowed text-ink-300'
    : selected ? 'bg-surface-subtle'
    : 'hover:bg-surface-hover active:bg-fill-subtle'
  return (
    <button
      {...props}
      type={type}
      data-dropdown-item
      aria-disabled={disabled || undefined}
      aria-current={selected || undefined}
      onClick={disabled ? undefined : onClick}
      className={`flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors duration-base ease-standard cep-focus-inset ${divider ? 'border-b border-line-subtle last:border-b-0' : ''} ${state} ${className}`}
    >
      {leading && <span className="mt-0.5 flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-helper font-semibold ${disabled ? '' : TITLE_TONE[tone]}`}>{title}</span>
        {detail && <span className={`text-helper ${disabled ? '' : 'text-ink-800'}`}>{detail}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center self-center">{trailing}</span>}
    </button>
  )
}
