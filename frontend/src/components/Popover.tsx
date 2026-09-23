import { X } from 'lucide-react'
import type { HTMLAttributes, ReactNode, Ref } from 'react'

import { IconButton } from './Button'

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

const PLACEMENT: Record<PopoverPlacement, string> = {
  'bottom-start': 'top-full left-0 mt-1.5',
  'bottom-end': 'top-full right-0 mt-1.5',
  'top-start': 'bottom-full left-0 mb-1.5',
  'top-end': 'bottom-full right-0 mb-1.5',
}

interface PopoverProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
  /** the region's accessible name */
  label: string
  title?: string
  onClose?: () => void
  /** px; the panel never grows wider than the viewport */
  width?: number
  /** absolute, relative to a `relative` wrapper around the trigger; `none` leaves positioning to the caller */
  placement?: PopoverPlacement | 'none'
  stickyHeader?: boolean
  children: ReactNode
}

/**
 * The one menu surface: white, hairline, 6px, the menu shadow, a 110ms fade in. Behaviour (open state, Escape,
 * arrow keys) comes from useSingleDropdown; spread its panelProps onto this.
 */
export function Popover({ label, title, onClose, width, placement = 'bottom-start', stickyHeader = false, className = '', style, children, ...props }: PopoverProps) {
  return (
    <div
      {...props}
      role="region"
      aria-label={label}
      style={{ ...(width ? { width, maxWidth: 'calc(100vw - 32px)' } : {}), ...style }}
      className={`${placement === 'none' ? '' : `absolute ${PLACEMENT[placement]}`} z-40 overflow-hidden rounded-md border border-line bg-surface shadow-menu animate-popover-in motion-reduce:animate-none ${className}`}
    >
      {title !== undefined && (
        <PopoverHeading sticky={stickyHeader} end={onClose && <IconButton label="Close" icon={X} size="xs" onClick={onClose} className="-my-1 -mr-1" />}>
          {title}
        </PopoverHeading>
      )}
      {children}
    </div>
  )
}

/** A panel's title row, also used for section breaks inside one ("Errors", "Warnings"). */
export function PopoverHeading({ children, sticky = false, end }: { children: ReactNode; sticky?: boolean; end?: ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-2 border-b border-line-subtle bg-surface px-3 py-2.5 ${sticky ? 'sticky top-0 z-10' : ''}`}>
      <span className="text-xs font-semibold text-ink-700">{children}</span>
      {end}
    </div>
  )
}
