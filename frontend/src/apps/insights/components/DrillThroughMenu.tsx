/**
 * Drill Through: the menu a right-click on a value opens. It lists the detail reports on the same dataset that take the
 * value's field (their own choice, in the editor's Detail Report), and opens the one picked filtered to the value.
 */
import { useQuery } from '@tanstack/react-query'
import { FileText, MessageSquarePlus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { Spinner } from '@/components/States'
import { insightsApi } from '../api'
import { throughPath } from './drill'

export interface ThroughTarget {
  dataset: string
  field: string
  fieldLabel: string
  value: unknown
  valueWords: string
  /** where the click was, in the window */
  at: { x: number; y: number }
  /** the report clicked on: its name for the note on the detail report, its id to leave out */
  from: { id?: string; name: string }
}

export function DrillThroughMenu({ target, onClose, onComment }: { target: ThroughTarget; onClose: () => void; onComment?: (target: ThroughTarget) => void }) {
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const reports = useQuery({ queryKey: ['insights', 'reports', { dataset: target.dataset, detail_for: target.field }], queryFn: () => insightsApi.reports({ dataset: target.dataset, detail_for: target.field }) })
  const offered = (reports.data?.reports ?? []).filter((report) => report.id !== target.from.id)
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    box.current?.focus()
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape) }
  }, [onClose])
  const left = Math.max(8, Math.min(target.at.x, window.innerWidth - 288))
  const top = Math.max(8, Math.min(target.at.y, window.innerHeight - 220))
  return (
    <div ref={box} role="menu" aria-label="Drill Through" tabIndex={-1} style={{ left, top }}
      className="fixed z-50 w-72 overflow-hidden rounded-md border border-line bg-surface-overlay shadow-menu outline-none animate-popover-in motion-reduce:animate-none">
      <p className="border-b border-line-subtle px-3 py-2 text-xs font-semibold text-ink-800">Drill Through · {target.fieldLabel}: {target.valueWords}</p>
      {reports.isPending ? <div className="p-3"><Spinner size="sm" label="Finding detail reports" /></div>
        : reports.isError ? <p className="p-3 text-xs text-danger-text">The detail reports could not be read.</p>
        : offered.length === 0 ? <p className="p-3 text-xs text-ink-800">No detail report takes {target.fieldLabel}. In the editor, Detail Report marks one for a field.</p>
        : (
          <ul className="max-h-60 overflow-y-auto py-1">
            {offered.map((report) => (
              <li key={report.id}>
                <button type="button" role="menuitem" onClick={() => { onClose(); navigate(throughPath(report.id, target.field, target.value, target.from.name)) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none">
                  <FileText size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />
                  <span className="min-w-0 flex-1 truncate">{report.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {onComment && (
        <button type="button" role="menuitem" onClick={() => { onClose(); onComment(target) }}
          className="flex w-full items-center gap-2 border-t border-line-subtle px-3 py-2 text-left text-sm text-ink-900 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none">
          <MessageSquarePlus size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />Comment on This Value
        </button>
      )}
    </div>
  )
}
