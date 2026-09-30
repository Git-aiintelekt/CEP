import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface TreeRowProps {
  /** 1 is the top level; each level indents 12px */
  level: number
  icon: LucideIcon
  selected?: boolean
  /** hidden on the canvas: muted text and icon */
  muted?: boolean
  /** the expand/collapse chevron, or an empty spacer to keep names aligned */
  expander?: ReactNode
  /** the name button, or a rename input while renaming */
  children: ReactNode
  /** 22px row actions, revealed on hover and keyboard focus and always shown on the selected row */
  actions?: ReactNode
  /** a status glyph after the name, e.g. hidden */
  trailing?: ReactNode
}

/** A 30px row in the layers tree: a 2px brand bar and Blue 100 fill when selected, Gray 75 on hover. */
export function TreeRow({ level, icon: Icon, selected = false, muted = false, expander, children, actions, trailing }: TreeRowProps) {
  const tone = selected ? 'border-brand-600 bg-brand-100' : 'border-transparent hover:bg-surface-subtle'
  const iconTone = muted ? 'text-ink-300' : selected ? 'text-brand-600' : 'text-ink-800'

  return (
    <div className={`group flex h-[30px] shrink-0 items-center gap-[2px] border-l-2 pr-1.5 ${tone}`}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: (level - 1) * 12 + 12 }}>
        {expander}
        <Icon size={14} strokeWidth={1.5} aria-hidden className={`shrink-0 ${iconTone}`} />
        {children}
      </div>
      {trailing}
      {actions && (
        <div className={`flex shrink-0 items-center gap-[2px] group-focus-within:flex group-hover:flex ${selected ? '' : 'hidden'}`}>{actions}</div>
      )}
    </div>
  )
}
