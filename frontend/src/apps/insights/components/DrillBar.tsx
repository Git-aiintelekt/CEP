/**
 * Where a drilled chart is: the top level, then each value clicked (each a way back up), then the level shown. At the
 * top it only says that a click drills, when there is a level below. Shared by the report viewer and a dashboard tile.
 */
import { ArrowUp, ChevronRight } from 'lucide-react'

import { useFiscalYear } from '../api'
import type { DrillInfo, DrillStep } from '../types'
import { canDrill, stepWords } from './drill'

export function DrillBar({ info, onPath, compact = false, table = false }: { info: DrillInfo; onPath: (path: DrillStep[]) => void; compact?: boolean; table?: boolean }) {
  const level = info.levels[info.depth]
  const more = canDrill(info)
  const fiscal = useFiscalYear().data
  if (info.depth === 0) {
    const how = table ? 'Click a row label (the arrows in a hierarchy)' : 'Click a bar, a slice or a stage'
    return more ? <p className="text-xs text-ink-700">{compact ? `Click a value to see it by ${info.levels[1].label.replace(/^.* by /, '')}` : `${how} to drill down to ${info.levels[1].label}.`}</p> : null
  }
  return (
    <nav aria-label="Drill path" className="flex flex-wrap items-center gap-1 text-xs text-ink-800">
      <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => onPath([])}>{info.levels[0].label}</button>
      {info.path.map((step, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          <ChevronRight size={12} strokeWidth={1.5} aria-hidden className="text-ink-700" />
          {index < info.path.length - 1
            ? <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => onPath(info.path.slice(0, index + 1))}>{stepWords(step, fiscal)}</button>
            : <span className="font-semibold text-ink-900" aria-current="location">{stepWords(step, fiscal)}</span>}
        </span>
      ))}
      <span className="text-ink-700">· {level.label}{more ? ', click to go deeper' : ''}</span>
      <button type="button" className="ml-1 inline-flex items-center gap-1 font-semibold text-brand-800 hover:underline" onClick={() => onPath(info.path.slice(0, -1))}>
        <ArrowUp size={12} strokeWidth={1.5} aria-hidden />Up One Level
      </button>
    </nav>
  )
}
