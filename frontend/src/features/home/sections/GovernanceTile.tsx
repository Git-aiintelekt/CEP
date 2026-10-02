import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorState, SkeletonLine } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { formatNumber, formatPercent } from '@/lib/format'

import { HomeCard } from '../components/HomeCard'
import { useHomeData } from '../data/homeDataContext'
import { capCompliance } from '../capCompliance'
import type { Governance, HomeFilters } from '../data/types'

/** neutral parts of one whole: Blue, Teal, Periwinkle (not green or amber, since no reason is good or bad) */
const REASONS: { key: keyof Governance['reasons']; label: string; colour: string }[] = [
  { key: 'frequencyCap', label: 'Frequency Cap', colour: 'bg-chart-1' },
  { key: 'noConsent', label: 'No Consent', colour: 'bg-chart-5' },
  { key: 'suppression', label: 'Suppression List', colour: 'bg-chart-6' },
]

export function Figure({ value, label, muted = false }: { value: string; label: string; muted?: boolean }) {
  return (
    <div data-figure className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-subtle px-4 py-3">
      <span className={`font-display leading-tight font-semibold cep-num ${muted ? 'text-xl text-ink-800' : 'text-2xl text-ink-900'}`}>{value}</span>
      <span className="text-helper text-ink-800">{label}</span>
    </div>
  )
}

function Body({ data }: { data: Governance }) {
  const audience = data.contacted + data.heldBack
  const share = (count: number) => (data.heldBack ? (count / data.heldBack) * 100 : 0)
  const compliance = capCompliance(data)
  const issues = data.reasons.noConsent + data.reasons.suppression
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Figure value={formatNumber(data.contacted)} label="Customers Contacted" />
        <Figure value={formatNumber(data.heldBack)} label={data.heldBack ? `Held Back · ${formatPercent(audience ? (data.heldBack / audience) * 100 : 0)}` : 'Held Back'} />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-helper">
          <span className="text-ink-900">Frequency Cap Compliance</span>
          <span data-compliance className="font-semibold text-ink-900 cep-num">{formatPercent(compliance, compliance === 100 ? 0 : 1)}</span>
        </div>
        <div role="progressbar" aria-label="Frequency cap compliance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(compliance)} className="h-1.5 w-full overflow-hidden rounded-pill bg-fill-subtle">
          <div className="h-full rounded-pill bg-brand-600" style={{ width: `${compliance}%` }} />
        </div>
      </div>
      {issues === 0 ? (
        <p data-no-issues className="text-helper text-ink-800">No consent or suppression issues detected in the selected period.</p>
      ) : (
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
      )}
    </div>
  )
}

/** How many customers the period's sends reached, how well the frequency cap held, and what else held people back. */
export function GovernanceTile({ filters }: { filters: HomeFilters }) {
  const { source, viewer } = useHomeData()
  const result = source.useGovernance(filters)
  if (result.status === 'unavailable') return null
  return (
    <HomeCard title="Governance & Audience Health" icon={ShieldCheck}
      actions={viewer.can('user.admin') ? <Link to="/settings/suppressions" className={`${buttonClass({ variant: 'link', size: 'sm' })} -mr-3`}>Open Governance</Link> : undefined}>
      {result.status === 'loading' ? <div className="flex flex-col gap-3"><SkeletonLine width="70%" height={28} /><SkeletonLine width="100%" /><SkeletonLine width="60%" /></div>
        : result.status === 'error' ? <ErrorState error={result.error} onRetry={result.retry} title="Governance figures could not be loaded" />
        : <Body data={result.data} />}
    </HomeCard>
  )
}
