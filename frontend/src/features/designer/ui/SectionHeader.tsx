import { ChevronDown } from 'lucide-react'

interface SectionHeaderProps {
  title: string
  /** give both to make it a disclosure button; the body it controls carries `controls` as its id */
  open?: boolean
  onToggle?: () => void
  controls?: string
}

/** A group label inside a side panel (12/600). Collapsible when it is given onToggle. */
export function SectionHeader({ title, open = true, onToggle, controls }: SectionHeaderProps) {
  if (!onToggle) return <h3 className="px-3 pt-3 pb-1 text-xs font-semibold text-ink-700">{title}</h3>

  return (
    <h3>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className="cep-focus-inset flex h-8 w-full items-center justify-between gap-2 px-3 text-left text-xs font-semibold text-ink-700 transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-ink-900"
      >
        {title}
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className={`shrink-0 transition-transform duration-base ease-standard motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
        />
      </button>
    </h3>
  )
}
