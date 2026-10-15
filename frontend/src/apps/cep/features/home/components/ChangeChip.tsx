import { ArrowDown, ArrowUp } from 'lucide-react'

import { formatPercentChange, formatPointChange } from '@/lib/format'

export type ChangeUnit = '%' | 'pt'

const TONE = { up: 'bg-success-bg text-success-text', down: 'bg-danger-bg text-danger-text', flat: 'bg-fill-subtle text-ink-800' }

/** The change on the previous period: borderless, green up, red down, grey with no arrow when flat or unknown. */
export function ChangeChip({ value, unit, comparison = 'on the previous period' }: { value: number | null | undefined; unit: ChangeUnit; comparison?: string }) {
  const known = value !== null && value !== undefined && !Number.isNaN(value)
  const rounded = known ? Math.round(value * 10) / 10 : 0
  const direction = !known || rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down'
  const text = known ? (unit === '%' ? formatPercentChange(rounded) : formatPointChange(rounded)) : '—'
  const size = `${Math.abs(rounded).toFixed(1)}${unit === '%' ? '%' : ' pt'}`
  const spoken = !known ? `No figure to compare ${comparison}` : direction === 'flat' ? `No change ${comparison}` : `${direction === 'up' ? 'Up' : 'Down'} ${size} ${comparison}`
  const Arrow = direction === 'up' ? ArrowUp : ArrowDown
  return (
    <span role="img" aria-label={spoken} data-change={direction} className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-semibold whitespace-nowrap cep-num ${TONE[direction]}`}>
      {direction !== 'flat' && <Arrow size={12} strokeWidth={2} aria-hidden />}
      {text}
    </span>
  )
}
