import { ArrowRight, BellRing } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatNumber } from '@/lib/format'

import { SeverityTag } from '../components/HomeTags'
import { SectionHeader, type CountTone } from '../components/SectionHeader'
import type { Attention, AttentionGroup, SectionResult, Severity } from '../data/types'
import { rankGroups } from '../rankGroups'

const SHOWN = 4
const TINT: Record<Severity, CountTone> = { critical: 'danger', blocking: 'warning', governance: 'callout' }
const GRID = 'grid grid-cols-1 gap-4 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-4'

function Freshness({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-helper text-ink-800">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
      {text}
    </span>
  )
}

function AlertCard({ group }: { group: AttentionGroup }) {
  return (
    <Link to={group.href} data-alert={group.id}
      className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4 transition-colors duration-fast ease-standard hover:bg-surface-subtle">
      <span className="self-start"><SeverityTag severity={group.severity} label={group.category} /></span>
      <span className="font-display text-[28px] leading-tight font-semibold text-ink-900 cep-num">{formatNumber(group.count)}{group.atLeast ? '+' : ''}</span>
      <span className="flex-1 text-sm text-ink-900">{group.label}</span>
      <span aria-hidden className="border-t border-line-subtle" />
      <span className="flex items-center justify-between gap-2 text-sm font-semibold text-brand-600">
        {group.actionLabel}
        <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
      </span>
    </Link>
  )
}

/** The alert groups as cards, most severe first; four show until View All. The page leaves it out when there are none (see homeLayout). */
export function NeedsAttention({ result }: { result: SectionResult<Attention> }) {
  const [all, setAll] = useState(false)
  const titleId = useId()
  const gridId = useId()

  const groups = result.status === 'ready' ? rankGroups(result.data.groups) : []
  const more = groups.length > SHOWN
  const right = result.status === 'ready' && (
    <>
      <Freshness text={result.data.freshness} />
      {more && (
        <>
          <span aria-hidden className="h-4 w-px bg-line" />
          <button type="button" aria-expanded={all} aria-controls={gridId} className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`} onClick={() => setAll(!all)}>
            {all ? 'Show Fewer' : `View All (${groups.length})`}
          </button>
        </>
      )}
    </>
  )
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <SectionHeader level="page" title="Needs Attention" titleId={titleId} icon={BellRing} count={groups.length || undefined} countTone={groups[0] ? TINT[groups[0].severity] : 'neutral'} actions={right || undefined} />
      {result.status === 'error' ? <ErrorState error={result.error} onRetry={result.retry} title="Alerts could not be loaded" />
        : result.status === 'loading' ? (
          <div data-attention="loading" className={GRID}>
            {Array.from({ length: SHOWN }, (_, index) => <div key={index} aria-hidden className="h-[196px] rounded-lg border border-line bg-surface p-4"><span className="block h-[22px] w-28 rounded-sm bg-surface-sunken" /><span className="mt-4 block h-7 w-16 rounded-sm bg-surface-sunken" /><span className="mt-4 block h-3.5 w-3/4 rounded-sm bg-surface-sunken" /></div>)}
          </div>
        ) : (
          <ul id={gridId} className={GRID}>
            {(all ? groups : groups.slice(0, SHOWN)).map((group) => <li key={group.id} className="min-w-0"><AlertCard group={group} /></li>)}
          </ul>
        )}
    </section>
  )
}
