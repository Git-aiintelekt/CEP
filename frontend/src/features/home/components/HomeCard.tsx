import type { LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { ErrorState, SkeletonLine } from '@/components/States'

import type { SectionResult } from '../data/types'
import { SectionHeader } from './SectionHeader'

interface HomeCardProps<T> {
  title: string
  icon?: LucideIcon
  count?: number
  helper?: string
  actions?: ReactNode
  /** under a divider: usually one link such as "View All Campaigns" */
  footer?: ReactNode
  /** no body padding, for tables that run edge to edge */
  flush?: boolean
  /** the header on the plum strip */
  strip?: boolean
  /** the section's data; 'unavailable' hides the whole card */
  result?: SectionResult<T>
  children: ReactNode | ((data: T) => ReactNode)
}

/** A Home section as a card: white, 1px hairline, 16px corners, no shadow; the header runs straight into the body. */
export function HomeCard<T>({ title, icon, count, helper, actions, footer, flush = false, strip = false, result, children }: HomeCardProps<T>) {
  const titleId = useId()
  if (result?.status === 'unavailable') return null
  const body =
    result?.status === 'loading' ? <div data-card-loading><SkeletonLine width="60%" /><SkeletonLine width="85%" /><SkeletonLine width="40%" /></div>
    : result?.status === 'error' ? <ErrorState error={result.error} onRetry={result.retry} />
    : typeof children === 'function' ? (result?.status === 'ready' ? children(result.data) : null)
    : children
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface">
      <SectionHeader level="card" title={title} titleId={titleId} icon={icon} count={count} helper={helper} actions={actions} strip={strip} />
      <div className={`flex-1 ${flush && result?.status !== 'loading' && result?.status !== 'error' ? '' : 'px-6 pt-1 pb-6'}`}>{body}</div>
      {footer && <div className="border-t border-line-subtle px-6 py-3">{footer}</div>}
    </section>
  )
}
