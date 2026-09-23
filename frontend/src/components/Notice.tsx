import { CircleAlert, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type NoticeTone = 'info' | 'warning' | 'error'

const TONE: Record<NoticeTone, { frame: string; icon: string; text: string; Icon: LucideIcon }> = {
  // info is the periwinkle callout family, never a blue-tinted box
  info: { frame: 'border-line bg-callout-bg', icon: 'text-callout-icon', text: 'text-callout-text', Icon: Info },
  warning: { frame: 'border-warning bg-warning-bg', icon: 'text-warning', text: 'text-warning-text', Icon: TriangleAlert },
  error: { frame: 'border-danger bg-danger-bg', icon: 'text-danger', text: 'text-danger-text', Icon: CircleAlert },
}

const LAYOUT = {
  /** full width under a bar, hairline below */
  strip: 'items-center gap-2.5 border-b px-6 py-2 text-helper animate-popover-in motion-reduce:animate-none',
  /** inside a panel or dialog */
  box: 'items-start gap-2 rounded-sm border px-3 py-2 text-xs',
  /** under a grid in a side panel: inset from the panel's own padding */
  panel: 'mx-2 mb-2 items-start gap-2 rounded-sm border px-2.5 py-2 text-xs',
}

interface NoticeProps {
  tone?: NoticeTone
  /** overrides the tone's icon colour, for a strip the design draws with the plain icon grey */
  iconClass?: string
  /** overrides the tone's text colour, likewise */
  textClass?: string
  layout?: keyof typeof LAYOUT
  icon?: LucideIcon
  /** usually a small secondary Button, pushed to the far end */
  action?: ReactNode
  children: ReactNode
}

/** Errors interrupt (role=alert); info and warnings are announced politely. */
export function Notice({ tone = 'info', layout = 'strip', icon, iconClass, textClass, action, children }: NoticeProps) {
  const style = TONE[tone]
  const Icon = icon ?? style.Icon
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex shrink-0 ${LAYOUT[layout]} ${style.frame}`}>
      <Icon size={layout === 'strip' ? 16 : 14} strokeWidth={1.5} aria-hidden className={`shrink-0 ${iconClass ?? style.icon} ${layout === 'strip' ? '' : 'mt-px'}`} />
      <div className={`min-w-0 flex-1 ${textClass ?? style.text}`}>{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
