/**
 * Decomposition Tree: a value split level by level by any dimension, in the order the person chooses. Each level is a column
 * of the values under the one picked in the level before; Split By offers the dimensions left, and the AI splits pick the
 * dimension whose largest (High Value) or smallest (Low Value) part goes furthest.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, X } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/Button'
import { MenuRow } from '@/components/MenuRow'
import { ErrorState, Spinner } from '@/components/States'
import { ApiError } from '@/lib/api'
import { insightsApi } from '../api'
import { formatCell } from '../components/resultWords'
import type { AnalysisSource, DecomposeResult, ReportView, RunResult } from '../types'
import { VisualReason } from './common'

type Level = { by: string; picked: number | null }
type Step = { field: string; value: unknown }

function useSplit(source: AnalysisSource | undefined, measure: string | undefined, path: Step[], by: string | null) {
  return useQuery({
    queryKey: ['insights', 'decompose', source, measure, path, by],
    queryFn: () => insightsApi.decompose(source as AnalysisSource, { measure, path, ...(by ? { by } : {}) }),
    enabled: Boolean(source && measure),
    retry: false,
    staleTime: 60_000,
  })
}

function SplitMenu({ options, onPick }: { options: DecomposeResult['explain_by']; onPick: (by: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!options.length) return null
  return (
    <div className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((now) => !now)}
        className="inline-flex h-8 items-center gap-1 rounded-control-md border border-dashed border-line-control px-2.5 text-xs font-semibold text-ink-800 hover:bg-surface-hover">
        <Plus size={14} strokeWidth={1.5} aria-hidden />Split By
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-surface-overlay shadow-menu">
          <MenuRow role="menuitem" divider={false} leading={<Sparkles size={14} strokeWidth={1.5} aria-hidden className="text-plum-700" />} title="High Value" detail="The field with the largest part" onClick={() => { setOpen(false); onPick('auto_high') }} />
          <MenuRow role="menuitem" leading={<Sparkles size={14} strokeWidth={1.5} aria-hidden className="text-plum-700" />} title="Low Value" detail="The field with the smallest part" onClick={() => { setOpen(false); onPick('auto_low') }} />
          {options.map((option) => <MenuRow key={option.field} role="menuitem" divider={false} title={option.label} detail={option.bucket ? 'By month' : undefined} onClick={() => { setOpen(false); onPick(option.field) }} />)}
        </div>
      )}
    </div>
  )
}

function LevelColumn({ source, measure, path, level, onPick, onRemove, onSplit }: {
  source: AnalysisSource; measure: string; path: Step[]; level: Level; onPick: (index: number, value: unknown, field: string) => void; onRemove: () => void; onSplit: (by: string) => void
}) {
  const query = useSplit(source, measure, path, level.by)
  const data = query.data
  const peak = Math.max(0, ...(data?.rows ?? []).map((row) => Math.abs(Number(row.measure) || 0)))
  return (
    <section aria-label={data?.by_label ?? 'Level'} className="flex w-56 shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2 border-b border-line-subtle pb-1.5">
        <span className="flex items-center gap-1 text-xs font-semibold text-ink-900">
          {data?.chosen && <Sparkles size={12} strokeWidth={1.5} aria-label={data.chosen === 'auto_high' ? 'Picked by High Value' : 'Picked by Low Value'} className="text-plum-700" />}
          {data?.by_label ?? 'Splitting…'}
        </span>
        <IconButton label={`Remove the ${data?.by_label ?? ''} level`} icon={X} size="xs" onClick={onRemove} />
      </div>
      {query.isPending ? <Spinner label="Splitting" /> : query.isError ? (
        <p className="text-xs text-ink-800">{query.error instanceof ApiError ? query.error.problem?.detail ?? query.error.message : 'The split did not run.'}</p>
      ) : data && (
        <>
          <ul className="flex flex-col gap-1">
            {(data.rows ?? []).map((row, index) => (
              <li key={index}>
                <button type="button" aria-pressed={level.picked === index} onClick={() => onPick(index, row.value, data.by as string)}
                  className={`flex w-full flex-col gap-1 rounded-md border px-2 py-1.5 text-left ${level.picked === index ? 'border-brand-600 bg-brand-100' : 'border-line hover:bg-surface-hover'}`}>
                  <span className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-ink-900">{row.label}</span><span className="cep-num shrink-0 font-semibold text-ink-900">{formatCell(data.measure.column, row.measure)}</span></span>
                  <span className="h-1.5 rounded-full bg-chart-1" style={{ width: `${Math.max(3, (Math.abs(Number(row.measure) || 0) / (peak || 1)) * 100)}%` }} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {data.more && <p className="text-xs text-ink-700">The largest {data.rows?.length} are shown.</p>}
          {level.picked !== null && <SplitMenu options={data.explain_by.filter((o) => o.field !== data.by)} onPick={onSplit} />}
        </>
      )}
    </section>
  )
}

export function DecompositionTree({ source, view, result, minHeight }: { source?: AnalysisSource; view: ReportView; result: RunResult; minHeight: number }) {
  const measures = result.columns.filter((column) => column.aggregate && !column.compare)
  const chosen = measures.some((m) => m.key === view.measure) ? view.measure : measures[0]?.key
  const [levels, setLevels] = useState<Level[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const client = useQueryClient()
  const root = useSplit(source, chosen, [], null)
  if (!source) return <VisualReason minHeight={minHeight}>The Decomposition Tree runs in the report itself. Open the report to see it.</VisualReason>
  if (!measures.length) return <VisualReason minHeight={minHeight}>The Decomposition Tree splits a value: add one, such as Sent Count.</VisualReason>
  const reset = () => { setLevels([]); setSteps([]) }
  const split = (at: number, by: string) => { setLevels((now) => [...now.slice(0, at), { by, picked: null }]); setSteps((now) => now.slice(0, at)) }
  const pick = (at: number, index: number, value: unknown, field: string) => {
    setLevels((now) => [...now.slice(0, at), { ...now[at], picked: index }])
    setSteps((now) => [...now.slice(0, at), { field, value }])
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4" style={{ minHeight }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">Decomposition Tree</h2>
        {levels.length > 0 && <button type="button" className="text-xs font-semibold text-brand-800 hover:underline" onClick={() => { reset(); void client.invalidateQueries({ queryKey: ['insights', 'decompose'] }) }}>Start Again</button>}
      </div>
      {root.isPending ? <Spinner label="Totalling" /> : root.isError ? (
        root.error instanceof ApiError && root.error.status === 422 ? <p className="text-sm text-ink-800">{root.error.problem?.detail}</p> : <ErrorState error={root.error} onRetry={() => root.refetch()} />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          <section aria-label="Total" className="flex w-44 shrink-0 flex-col gap-2">
            <span className="border-b border-line-subtle pb-1.5 text-xs font-semibold text-ink-900">{root.data.measure.label}</span>
            <span className="cep-num rounded-md border border-brand-600 bg-brand-100 px-2 py-1.5 text-sm font-semibold text-ink-900">{formatCell(root.data.measure.column, root.data.total)}</span>
            {levels.length === 0 && <SplitMenu options={root.data.explain_by} onPick={(by) => split(0, by)} />}
          </section>
          {levels.map((level, at) => (
            <LevelColumn key={`${at}:${level.by}`} source={source} measure={chosen as string} path={steps.slice(0, at)} level={level}
              onPick={(index, value, field) => pick(at, index, value, field)} onRemove={() => { setLevels((now) => now.slice(0, at)); setSteps((now) => now.slice(0, at)) }}
              onSplit={(by) => split(at + 1, by)} />
          ))}
        </div>
      )}
      <p className="text-xs text-ink-700">Pick a value in a level, then Split By to break it down further. High Value and Low Value let AI pick the field.</p>
    </div>
  )
}
