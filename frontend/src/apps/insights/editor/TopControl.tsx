/** Top N: keep the first dimension's top values by the value the report is sorted by, and fold the rest into Others. */
import { Checkbox } from '@/components/Checkbox'
import { Select } from '@/components/Form'
import type { ReportDefinition } from '../types'
import { setTop } from './definition'

const SIZES = [3, 5, 10, 20, 50]

export function TopControl({ definition, onChange }: { definition: ReportDefinition; onChange: (next: ReportDefinition) => void }) {
  const top = definition.top
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-32"><Select aria-label="Top" controlSize="sm" value={String(top?.n ?? '')} onChange={(event) => onChange(setTop(definition, Number(event.target.value) || null, top?.others ?? true))}>
        <option value="">Every value</option>{SIZES.map((n) => <option key={n} value={n}>Top {n}</option>)}
      </Select></span>
      {top && <Checkbox label="Show the rest as Others" checked={top.others} onChange={(event) => onChange(setTop(definition, top.n, event.target.checked))} />}
    </div>
  )
}
