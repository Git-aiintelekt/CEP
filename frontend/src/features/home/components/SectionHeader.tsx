import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type SectionLevel = 'page' | 'card'
export type CountTone = 'neutral' | 'danger' | 'warning' | 'callout'

const COUNT_TONE: Record<CountTone, string> = {
  neutral: 'bg-fill-subtle text-ink-800',
  danger: 'bg-danger-bg text-danger-text',
  warning: 'bg-warning-bg text-warning-text',
  callout: 'bg-callout-bg text-callout-text',
}

interface SectionHeaderProps {
  level: SectionLevel
  title: string
  /** the heading's id, for the section's aria-labelledby */
  titleId: string
  /** a 16px Lucide icon on a 28px plum square before the title; the header's only plum */
  icon?: LucideIcon
  count?: number
  /** the count badge's tint; neutral grey by default */
  countTone?: CountTone
  /** 13px text after the title: "Showing 6 of 15" */
  helper?: string
  /** right-hand slot: links, chips, legends */
  actions?: ReactNode
}

const TITLE: Record<SectionLevel, string> = {
  page: 'font-display text-section-title font-semibold text-ink-900',
  card: 'font-display text-card-heading font-semibold text-ink-900',
}

/** A section's title row. "page" sits on the page with no card; "card" is a card's header with a divider under it. */
export function SectionHeader({ level, title, titleId, icon: Icon, count, countTone = 'neutral', helper, actions }: SectionHeaderProps) {
  return (
    <div data-section-header={level} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-3 ${level === 'card' ? 'border-b border-line px-4 py-3' : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        {Icon && (
          <span aria-hidden data-plum-icon className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control-md bg-plum-100 text-plum-700">
            <Icon size={16} strokeWidth={1.5} />
          </span>
        )}
        <h2 id={titleId} className={`min-w-0 ${TITLE[level]}`}>{title}</h2>
        {count !== undefined && <span data-count-badge className={`inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 text-xs font-semibold cep-num ${COUNT_TONE[countTone]}`}>{count}</span>}
        {helper && <span className="text-helper text-ink-800">{helper}</span>}
      </div>
      {/* the whole group moves under the title when the row runs out of room, never one item at a time */}
      {actions && <div data-section-actions className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
