/**
 * A report's result in one card (docs/mockups/report-page.html): the toolbar along the top, a drill path under it when
 * drilled, the result, and a footer line saying how to read it: a pivot's "Amount · Campaign down, Month across", a
 * hierarchy's levels, and the hint the caller gives (how to drill).
 */
import type { ReactNode } from 'react'

import type { ReportView, RunResult } from '../types'
import { split } from './shape'

function caption(result: RunResult, view: ReportView): string | null {
  const { dims, meas, spread, down } = split(result, view.across)
  if (view.type === 'hierarchy') return dims.length ? dims.map(({ column }) => column.label).join(', then ') : null
  if (view.type !== 'pivot' || !spread || !down.length) return null
  const values = meas.filter(({ column }) => !column.compare).map(({ column }) => column)
  const shown = view.matrix && values.length > 1 ? values.map((column) => column.label).join(', ') : (values.find((column) => column.key === view.measure) ?? values[0])?.label
  return shown ? `${shown} · ${down[0].column.label} down, ${spread.column.label} across` : null
}

export function ResultCard({ bar, drill, hint, result, view, children }: { bar: ReactNode; drill?: ReactNode; hint?: ReactNode; result: RunResult; view: ReportView; children: ReactNode }) {
  const words = caption(result, view)
  return (
    <section aria-label="Report result" className="flex flex-col rounded-lg border border-line bg-surface">
      <div className="border-b border-line-subtle px-4 py-3">{bar}</div>
      {drill && <div className="px-4 pt-3">{drill}</div>}
      <div className="p-4">{children}</div>
      {(words || hint) && (
        <div data-result-footer className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 text-helper text-ink-800">
          {words && <span>{words}</span>}
          {hint}
        </div>
      )}
    </section>
  )
}
