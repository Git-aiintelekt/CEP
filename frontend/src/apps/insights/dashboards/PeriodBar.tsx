/** The dashboard's period, one for every tile: the presets, the two dates for a custom one, Compare With Previous Period, and the dates in words. */
import { TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Switch } from '@/components/Switch'
import { useFiscalYear } from '../api'
import type { Period, PeriodBounds, PeriodPreset } from '../types'
import { periodBounds, periodWords, presetsFor } from './layout'

export function PeriodBar({ period, onPeriod, compare, onCompare, bounds }: { period: Period; onPeriod: (next: Period) => void; compare: boolean; onCompare: (next: boolean) => void; bounds?: PeriodBounds }) {
  const start = useFiscalYear().data?.start ?? 1
  const shown = bounds ?? periodBounds(period, new Date(), start)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SegmentedControl label="Period" options={presetsFor(start)} value={period.preset} onChange={(preset: PeriodPreset) => onPeriod(preset === 'custom' ? { preset, from: shown.from, to: shown.to } : { preset })} />
      {period.preset === 'custom' && (
        <span className="flex items-center gap-1.5 text-xs text-ink-800">
          <span className="w-36"><TextInput aria-label="From" type="date" controlSize="sm" value={period.from ?? ''} max={period.to} onChange={(event) => onPeriod({ ...period, from: event.target.value })} /></span>
          <span>to</span>
          <span className="w-36"><TextInput aria-label="To" type="date" controlSize="sm" value={period.to ?? ''} min={period.from} onChange={(event) => onPeriod({ ...period, to: event.target.value })} /></span>
        </span>
      )}
      <Switch checked={compare} onChange={onCompare} label="Compare With Previous Period" />
      <span className="ml-auto text-xs text-ink-800">{periodWords(shown)}</span>
    </div>
  )
}
