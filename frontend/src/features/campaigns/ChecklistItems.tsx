/**
 * The pre-publish checklist as the API answers it (GET /campaigns/{id}/checklist/): a green tick for what is done, a red mark
 * with the API's own problem line for what blocks, a dashed amber circle for advice. Review & Publish and a drip's Test &
 * Publish both list it; a problem of several lines (a drip names each message) shows one line each.
 */
import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'

import type { CampaignChecklist } from '@/lib/types'

type Item = CampaignChecklist['items'][number]

export function ChecklistItems({ items, after }: { items: Item[]; /** under an item that isn't done: a way to fix it */ after?: (item: Item) => ReactNode }) {
  return (
    <ul className="space-y-3" aria-label="Pre-Publish Checklist">
      {items.map((item) => (
        <li key={item.key} data-check={item.key} data-ok={item.ok || undefined} className="flex items-start gap-2.5 text-sm">
          {item.ok ? <CircleCheck size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-success-text" aria-hidden />
            : item.advisory ? <CircleDashed size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
            : <CircleAlert size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-danger-text" aria-hidden />}
          <span className="min-w-0">
            <span className="font-medium text-ink-900">{item.label}</span>
            <span className="sr-only">{item.ok ? ': done' : item.advisory ? ': recommended' : ': to do'}</span>
            {!item.ok && item.problem && item.problem.split('\n').map((line) => (
              <span key={line} className={`block ${item.advisory ? 'text-ink-800' : 'text-danger-text'}`}>{line}</span>
            ))}
            {!item.ok && after?.(item)}
          </span>
        </li>
      ))}
    </ul>
  )
}
