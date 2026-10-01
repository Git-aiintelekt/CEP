import { ArrowRight, BellRing } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorState } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatNumber } from '@/lib/format'

import { SeverityIcon } from '../components/HomeTags'
import { SectionHeader, type CountTone } from '../components/SectionHeader'
import type { Attention, AttentionGroup, SectionResult, Severity } from '../data/types'
import { rankGroups } from '../rankGroups'

const SHOWN = 4
const TINT: Record<Severity, CountTone> = { critical: 'danger', blocking: 'warning', governance: 'callout' }
/** one strip; a cell never squeezes its words, it wraps whole to the next line (the bottom hairline is each cell's, so a wrapped line closes too) */
const STRIP = 'flex max-w-full flex-wrap self-start overflow-hidden rounded-lg border border-b-0 border-line'
const CELL = 'min-w-0 border-r border-b border-r-line-subtle border-b-line'

function Freshness({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-helper text-ink-800">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
      {text}
    </span>
  )
}

function AlertCell({ group }: { group: AttentionGroup }) {
  return (
    <Link to={group.href} data-alert={group.id}
      className="flex min-h-16 items-center gap-3 px-4 whitespace-nowrap transition-colors duration-fast ease-standard hover:bg-surface-subtle">
      <SeverityIcon severity={group.severity} />
      <span className="font-display text-xl leading-none font-semibold text-ink-900 cep-num">{formatNumber(group.count)}{group.atLeast ? '+' : ''}</span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm text-ink-900">{group.label}</span>
        <span data-severity={group.severity} className="text-xs text-ink-800">{group.category}</span>
      </span>
      <span className="ml-1 flex h-8 items-center gap-1 border-l border-line-subtle pl-4 text-sm font-semibold text-brand-600">
        {group.actionLabel}
        <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
      </span>
    </Link>
  )
}

/** The alert groups as one strip of cells, most severe first; four show until View All. The page leaves it out when there are none (see homeLayout). */
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
          <div data-attention="loading" className={STRIP}>
            {Array.from({ length: SHOWN }, (_, index) => <div key={index} aria-hidden className={`${CELL} flex h-16 w-72 items-center gap-3 px-4`}><span className="h-8 w-8 rounded-control-md bg-surface-sunken" /><span className="h-5 w-6 rounded-sm bg-surface-sunken" /><span className="h-3.5 w-36 rounded-sm bg-surface-sunken" /></div>)}
          </div>
        ) : (
          <ul id={gridId} className={STRIP}>
            {(all ? groups : groups.slice(0, SHOWN)).map((group) => <li key={group.id} className={CELL}><AlertCell group={group} /></li>)}
          </ul>
        )}
    </section>
  )
}
