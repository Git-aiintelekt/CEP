import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { SkeletonLine } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'

import type { Benchmark } from '../benchmarks'
import { ChangeChip, type ChangeUnit } from './ChangeChip'
import { BenchmarkTag } from './HomeTags'

/** unavailable: the figure can't be known yet (no data source), so a grey dash and a sentence, no chips */
export type KpiState = 'ready' | 'loading' | 'notTracked' | 'notSetUp' | 'unavailable'

interface KpiTileProps {
  label: string
  /** right of the label: "Email Only" */
  note?: string
  /** already formatted: "1,584,560", "37.5%", "$1.39M" */
  value?: string
  state?: KpiState
  change?: { value: number | null; unit: ChangeUnit }
  benchmark?: Benchmark
  supporting?: ReactNode
  /** a thin bar under the figures, 0 to 100 */
  progress?: { value: number; label: string }
  /** the supporting line when not tracked */
  notTrackedText?: string
  /** notSetUp: admins get the Settings link, everyone else a sentence (Settings is admin-only) */
  canSetUp?: boolean
  setUpHref?: string
}

const QUIET_VALUE = 'font-display text-xl leading-tight font-semibold whitespace-nowrap text-ink-800'

/** One KPI: label, the figure, its change and benchmark, a supporting line and an optional bar. */
export function KpiTile({ label, note, value, state = 'ready', change, benchmark, supporting, progress, notTrackedText = 'SMS does not report opens', canSetUp = false, setUpHref = '/settings/integrations' }: KpiTileProps) {
  return (
    <div data-kpi={label} className="flex min-w-0 flex-col gap-2 bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-helper font-semibold text-ink-800">{label}</span>
        {note && <span className="text-xs text-ink-800">{note}</span>}
      </div>
      {state === 'loading' ? (
        <div data-kpi-loading className="flex flex-col gap-1"><SkeletonLine width="60%" height={28} /><SkeletonLine width="40%" /><SkeletonLine width="80%" /></div>
      ) : state === 'notTracked' ? (
        <>
          <p className={QUIET_VALUE}>Not Tracked</p>
          <p className="text-helper text-ink-800">{notTrackedText}</p>
        </>
      ) : state === 'unavailable' ? (
        <>
          <p className="font-display text-[28px] leading-tight font-semibold text-ink-800">—</p>
          {supporting && <p className="text-helper text-ink-800">{supporting}</p>}
        </>
      ) : state === 'notSetUp' ? (
        <>
          <p className={QUIET_VALUE}>Not Set Up Yet</p>
          {canSetUp
            ? <Link to={setUpHref} className={`${buttonClass({ variant: 'link', size: 'sm' })} -ml-3 self-start`}>Set Up Attribution</Link>
            : <p className="text-helper text-ink-800">Ask an admin to set up attribution.</p>}
        </>
      ) : (
        <>
          <p className="font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink-900 cep-num">{value ?? '—'}</p>
          {(change || benchmark) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {change && <ChangeChip value={change.value} unit={change.unit} />}
              {benchmark && <BenchmarkTag benchmark={benchmark} />}
            </div>
          )}
          {progress && (
            <div role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, Math.max(0, progress.value)))}
              className="mt-2 h-1 w-full overflow-hidden rounded-pill bg-fill-subtle">
              <div className="h-full rounded-pill bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, progress.value))}%` }} />
            </div>
          )}
          {supporting && <p className="text-helper text-ink-800">{supporting}</p>}
        </>
      )}
    </div>
  )
}

/** Six tiles in one bordered card with 1px dividers between them: one row from 1200px, 3 × 2 below, fewer columns on small screens. */
export function KpiStrip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line min-[640px]:grid-cols-2 min-[768px]:grid-cols-3 min-[1200px]:grid-cols-6">
      {children}
    </div>
  )
}
