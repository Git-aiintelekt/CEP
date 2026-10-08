import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import { SkeletonLine } from '@/components/States'

import { CountUp } from '../intro'
import { useIntroRef } from '../introClock'

interface RingKpiProps {
  label: string
  icon: LucideIcon
  /** right of the label: "Email Only" */
  note?: string
  value?: string
  /** a sentence state in place of the figure: "Not Tracked" */
  quiet?: boolean
  /** under the figure: "53 opened" */
  supporting?: string
  /** the change chip and the plum benchmark chip */
  chips?: ReactNode
  /** how much of the ring fills, 0 to 100; null draws an empty ring */
  percent?: number | null
  loading?: boolean
}

/** A plum chip for a KPI's benchmark or detail ("Good · 53 opened"). */
export function PlumChip({ children }: { children: ReactNode }) {
  return <span data-plum-chip className="inline-flex h-[22px] items-center rounded-sm bg-plum-100 px-[7px] text-xs font-semibold whitespace-nowrap text-plum-800">{children}</span>
}

/** the share as a blue-into-plum ring around the icon, filling as the page opens */
function Ring({ fill, icon: Icon }: { fill: number; icon: LucideIcon }) {
  const [ref, playing] = useIntroRef<HTMLSpanElement>(fill > 0)
  return (
    <span ref={ref} aria-hidden data-ring={Math.round(fill)} className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${playing ? 'cep-intro-ring' : ''}`}
      style={{ '--intro-ring': `${fill}%`, background: 'conic-gradient(var(--color-brand-600) 0%, var(--color-plum-500) var(--intro-ring), var(--color-fill-subtle) var(--intro-ring) 100%)' } as CSSProperties}>
      <span className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-surface text-plum-700"><Icon size={18} strokeWidth={1.5} /></span>
    </span>
  )
}

/** One KPI with its share drawn as a blue-into-plum ring around the icon. */
export function RingKpi({ label, icon: Icon, note, value, quiet = false, supporting, chips, percent = null, loading = false }: RingKpiProps) {
  const fill = Math.min(100, Math.max(0, percent ?? 0))
  return (
    <div data-kpi={label} className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5 text-helper font-semibold text-ink-800">
          <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-plum-700" />
          <span className="truncate">{label}</span>
          {note && <span className="ml-auto shrink-0 text-xs font-normal">{note}</span>}
        </span>
        {loading ? (
          <div data-kpi-loading className="flex flex-col gap-1"><SkeletonLine width="60%" height={26} /><SkeletonLine width="80%" /></div>
        ) : (
          <>
            <span className={`font-display font-semibold cep-num ${quiet ? 'text-section-title text-ink-800' : 'text-kpi text-ink-900'}`}>{quiet ? value : <CountUp value={value ?? '—'} />}</span>
            {supporting && <span className="truncate text-xs text-ink-800">{supporting}</span>}
            {chips && <span className="flex flex-wrap items-center gap-1.5">{chips}</span>}
          </>
        )}
      </div>
      <Ring key={loading ? 'loading' : 'ready'} fill={loading ? 0 : fill} icon={Icon} />
    </div>
  )
}
