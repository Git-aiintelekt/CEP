import { ArrowRight, TrendingUp } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatNumber } from '@/lib/format'

import { SeverityTag } from '../components/HomeTags'
import { SectionHeader } from '../components/SectionHeader'
import type { Attention, AttentionGroup, FunnelChannel, SectionResult } from '../data/types'
import { insightFrom, type Insight } from '../insightFrom'
import { rankGroups } from '../rankGroups'

const SHOWN = 4
const BOX = 'flex min-h-[176px] min-w-0 flex-col items-start gap-2 rounded-md bg-surface-subtle px-5 py-4'
const ACTION = 'inline-flex items-center gap-1.5 self-start text-sm font-semibold text-link hover:text-link-hover hover:underline'

function Action({ href, label, describedAs }: { href: string; label: string; describedAs?: string }) {
  return (
    <Link to={href} aria-label={describedAs ? `${label}: ${describedAs}` : undefined} className={ACTION}>
      {label}<ArrowRight size={16} strokeWidth={1.5} aria-hidden />
    </Link>
  )
}

/** The count, large, with "+" when it is a floor */
function Count({ group }: { group: AttentionGroup }) {
  return <span data-count className="font-display text-kpi font-semibold text-ink-900 cep-num">{formatNumber(group.count)}{group.atLeast ? '+' : ''}</span>
}

/** One alert group as a grey box: its severity tag, the count, the sentence, and the way to fix it. A group of separate problems (Drip Problems) lists each with its own link. */
function AlertBox({ group }: { group: AttentionGroup }) {
  const items = group.items ?? null
  return (
    <li className={BOX} data-alert={group.id}>
      <SeverityTag severity={group.severity} label={group.category} />
      <Count group={group} />
      {items === null ? (
        <>
          <span data-severity={group.severity} className="text-sm text-ink-800">{group.label}</span>
          <span className="mt-auto pt-2"><Action href={group.href} label={group.actionLabel} /></span>
        </>
      ) : items.length === 1 ? (
        <>
          <span data-severity={group.severity} className="line-clamp-3 text-sm text-ink-800">{items[0].text}</span>
          <span className="mt-auto pt-2"><Action href={items[0].href} label={items[0].actionLabel} /></span>
        </>
      ) : (
        <ul data-severity={group.severity} className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5">
              <span className="text-sm text-ink-800">{item.text}</span>
              <Action href={item.href} label={item.actionLabel} describedAs={item.text} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function InsightBox({ insight }: { insight: Insight }) {
  return (
    <li className={BOX} data-insight>
      <span className="inline-flex h-[22px] shrink-0 items-center gap-1 self-start rounded-sm bg-brand-100 px-2 text-xs font-semibold whitespace-nowrap text-brand-800">
        <TrendingUp size={12} strokeWidth={1.5} aria-hidden />Opportunity
      </span>
      <span className="text-card-title font-semibold text-ink-900">{insight.title}</span>
      <span className="text-sm text-ink-800">{insight.detail}</span>
      <span className="mt-auto pt-2"><Action href={insight.href} label="View Insight" /></span>
    </li>
  )
}

const GRID = 'grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2 @min-[960px]:grid-cols-4'

/**
 * One card under the greeting: the alert groups as grey boxes, most severe first, with the opportunity after them; four
 * show until View All. When the alerts were last checked sits in the header. The page leaves the section out when there
 * are no groups (see homeLayout).
 */
export function NeedsAttention({ result, funnel }: { result: SectionResult<Attention>; funnel?: SectionResult<FunnelChannel[]> }) {
  const [all, setAll] = useState(false)
  const titleId = useId()
  const gridId = useId()
  const groups = result.status === 'ready' ? rankGroups(result.data.groups) : []
  const insight = funnel?.status === 'ready' ? insightFrom(funnel.data) : null
  // the opportunity takes one of the four slots when there is one
  const room = insight ? SHOWN - 1 : SHOWN
  const more = groups.length > room
  const shown = all ? groups : groups.slice(0, room)

  return (
    <section aria-labelledby={titleId} className="@container flex min-w-0 flex-col rounded-lg border border-line bg-surface">
      <SectionHeader level="card" title="Needs Attention" titleId={titleId} count={result.status === 'ready' ? groups.length : undefined} countTone="danger"
        actions={result.status === 'ready' ? <span className="text-helper text-ink-800">{result.data.freshness}</span> : undefined} />
      <div className="px-6 pt-1 pb-6">
        {result.status === 'error' ? <ErrorState error={result.error} onRetry={result.retry} title="Alerts could not be loaded" />
          : result.status === 'loading' ? (
            <div data-attention="loading" className={GRID}>
              {Array.from({ length: SHOWN }, (_, index) => <div key={index} aria-hidden className={`${BOX} animate-pulse`}><span className="h-5 w-20 rounded-sm bg-fill-muted" /><span className="h-7 w-12 rounded-sm bg-fill-muted" /><span className="h-4 w-3/4 rounded-sm bg-fill-muted" /></div>)}
            </div>
          ) : (
            <ul id={gridId} className={GRID}>
              {shown.map((group) => <AlertBox key={group.id} group={group} />)}
              {insight && <InsightBox insight={insight} />}
            </ul>
          )}
        {more && (
          <button type="button" aria-expanded={all} aria-controls={gridId} className={`${buttonClass({ variant: 'secondary', size: 'sm' })} mt-4`} onClick={() => setAll(!all)}>
            {all ? 'Show Fewer' : `View All (${groups.length})`}
          </button>
        )}
      </div>
    </section>
  )
}
