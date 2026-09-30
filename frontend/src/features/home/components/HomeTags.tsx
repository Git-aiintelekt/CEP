import { CircleAlert, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react'

import { Tag, type TagTone } from '@/components/StatusBadge'

import type { Benchmark } from '../benchmarks'
import type { Severity } from '../data/types'

const BENCHMARK_TONE: Record<Benchmark, TagTone> = { Good: 'success', Fair: 'warning', Poor: 'error' }

/** The plain tag, no dot: the word carries the meaning. */
export function BenchmarkTag({ benchmark }: { benchmark: Benchmark }) {
  return <Tag tone={BENCHMARK_TONE[benchmark]}>{benchmark}</Tag>
}

const SEVERITY: Record<Severity, { colours: string; icon: LucideIcon; iconColour: string }> = {
  critical: { colours: 'bg-danger-bg text-danger-text', icon: CircleAlert, iconColour: '' },
  blocking: { colours: 'bg-warning-bg text-warning-text', icon: TriangleAlert, iconColour: '' },
  governance: { colours: 'bg-callout-bg text-callout-text', icon: ShieldCheck, iconColour: 'text-callout-icon' },
}

/** An alert group's category ("Delivery Failure", "Blocking a Send", "Governance") with its severity's colour and icon. */
export function SeverityTag({ severity, label }: { severity: Severity; label: string }) {
  const { colours, icon: Icon, iconColour } = SEVERITY[severity]
  return (
    <span data-severity={severity} className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${colours}`}>
      <Icon size={12} strokeWidth={1.5} aria-hidden className={iconColour} />
      {label}
    </span>
  )
}
