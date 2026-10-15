import type { ReactNode } from 'react'

import { CountUp } from '../intro'

export type HeroTone = 'navy' | 'plum'

// navy is the solid blue card; plum is the light blue one beside it (trial: no plum)
const TONE: Record<HeroTone, { card: string; text: string; label: string; strong: string; soft: string; rule: string; chip: string; skeleton: string; line: string }> = {
  navy: { card: 'cep-home-hero-navy', text: 'text-on-brand', label: 'text-on-brand', strong: 'text-on-brand', soft: 'text-on-brand-soft', rule: 'border-home-hero-rule', chip: 'bg-surface text-brand-800', skeleton: 'bg-brand-fill-hover', line: 'text-plum-200' },
  plum: { card: 'cep-home-hero-light border border-plum-200', text: 'text-ink-900', label: 'text-brand-800', strong: 'text-ink-900', soft: 'text-ink-800', rule: 'border-plum-200', chip: 'cep-home-hero-chip bg-surface text-brand-800', skeleton: 'bg-plum-200', line: 'text-brand-600' },
}

interface HeroCardProps {
  tone: HeroTone
  label: string
  chip?: string
  /** already formatted; a sentence state ("Not Set Up Yet") passes `quiet` */
  value?: string
  quiet?: boolean
  /** after the figure: "from $127 spent" */
  sub?: string
  /** the trend (a Sparkline) */
  spark?: ReactNode
  /** under the trend: where it starts, and its highlight */
  axis?: [string, string]
  footLeft?: ReactNode
  footRight?: ReactNode
  /** the right-hand foot in amber: behind its goal */
  footWarning?: boolean
  loading?: boolean
  /** in place of the trend: a link or a sentence (Not Set Up Yet) */
  children?: ReactNode
}

/** The two cards that open the figures: Attributed Revenue on solid blue (light-scoped, the same in both themes), Campaign ROI on light blue, which turns deep navy in dark mode. */
export function HeroCard({ tone, label, chip, value, quiet = false, sub, spark, axis, footLeft, footRight, footWarning = false, loading = false, children }: HeroCardProps) {
  const t = TONE[tone]
  return (
    // the blue hero keeps the light token values in both themes so its chip and soft text read the same; the light one follows the theme
    <div data-kpi={label} data-hero={tone} data-theme={tone === 'navy' ? 'light' : undefined} className={`${t.card} flex min-h-[276px] min-w-0 flex-col gap-3.5 rounded-lg px-5 py-5 ${t.text}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${t.label}`}>{label}</span>
        {chip && <span className={`inline-flex h-[22px] items-center rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${t.chip}`}>{chip}</span>}
      </div>
      {loading ? (
        <div data-kpi-loading className="flex flex-col gap-3">
          <span className={`h-10 w-1/2 rounded-sm ${t.skeleton}`} />
          <span className={`h-16 w-full rounded-sm ${t.skeleton}`} />
        </div>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className={`font-display font-semibold cep-num ${quiet ? 'text-kpi' : 'text-home-hero'}`}>{quiet ? value : <CountUp value={value ?? '—'} />}</span>
            {sub && <span className={`text-sm ${t.soft}`}>{sub}</span>}
          </p>
          {children}
          {spark && (
            <div className={t.line}>
              <div className="h-[76px]">{spark}</div>
              {axis && <div className={`mt-1.5 flex justify-between gap-2 text-xs ${t.soft}`}><span>{axis[0]}</span><span className={`font-semibold ${t.strong}`}>{axis[1]}</span></div>}
            </div>
          )}
        </>
      )}
      {(footLeft || footRight) && !loading && (
        <div className={`mt-auto flex items-center justify-between gap-2 border-t pt-3 text-helper ${t.rule} ${t.soft}`}>
          <span className="min-w-0">{footLeft}</span>
          {footRight && <span data-hero-goal className={`shrink-0 font-semibold ${footWarning ? 'text-warning' : t.strong}`}>{footRight}</span>}
        </div>
      )}
    </div>
  )
}
