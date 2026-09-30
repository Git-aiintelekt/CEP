import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatNumber, formatPercent } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import type { Governance, HomeFilters } from '../data/types'

/** neutral parts of one whole: Blue, Teal, Periwinkle (not green or amber, since no reason is good or bad) */
const REASONS: { key: keyof Governance['reasons']; label: string; colour: string }[] = [
  { key: 'frequencyCap', label: 'Frequency Cap', colour: 'bg-chart-1' },
  { key: 'noConsent', label: 'No Consent', colour: 'bg-chart-5' },
  { key: 'suppression', label: 'Suppression List', colour: 'bg-chart-6' },
]

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-display text-2xl leading-tight font-semibold text-ink-900 cep-num">{value}</span>
      <span className="text-helper text-ink-800">{label}</span>
    </div>
  )
}

function Body({ data }: { data: Governance }) {
  const audience = data.contacted + data.heldBack
  const share = (count: number) => (data.heldBack ? (count / data.heldBack) * 100 : 0)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Figure value={formatNumber(data.contacted)} label="Customers Contacted" />
        <Figure value={formatNumber(data.heldBack)} label={`Held Back · ${formatPercent(audience ? (data.heldBack / audience) * 100 : 0)}`} />
      </div>
      <div aria-hidden data-held-back-bar className="flex h-2 gap-0.5 overflow-hidden rounded-xs">
        {REASONS.filter(({ key }) => data.reasons[key] > 0).map(({ key, colour }) => <span key={key} data-reason={key} className={`h-full basis-0 ${colour}`} style={{ flexGrow: data.reasons[key] }} />)}
      </div>
      <ul aria-label="Held back by reason" className="flex flex-col gap-2">
        {REASONS.map(({ key, label, colour }) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-xs ${colour}`} />
            <span className="min-w-0 flex-1 text-ink-900">{label}</span>
            <span className="text-ink-900 cep-num">{formatNumber(data.reasons[key])}</span>
            <span className="w-10 text-right text-helper text-ink-800 cep-num">{Math.round(share(data.reasons[key]))}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** How many customers the period's sends reached, and how many governance held back and why. */
export function GovernanceTile({ filters }: { filters: HomeFilters }) {
  const { source, viewer } = useHomeData()
  const result = source.useGovernance(filters)
  if (result.status === 'unavailable') return null
  return (
    <HomeCard title="Governance" icon={ShieldCheck}
      actions={viewer.can('user.admin') ? <Link to="/settings/suppressions" className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`}>Open Governance</Link> : undefined}>
      {result.status === 'loading' ? <div className="flex flex-col gap-3"><SkeletonLine width="70%" height={28} /><SkeletonLine width="100%" /><SkeletonLine width="60%" /></div>
        : result.status === 'error' ? <ErrorState error={result.error} onRetry={result.retry} title="Governance figures could not be loaded" />
        : <Body data={result.data} />}
    </HomeCard>
  )
}
