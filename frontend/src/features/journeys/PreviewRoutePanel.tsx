/** Preview Route: the builder's dry run. Pick a customer, and the saved version's graph is walked with their record as it is
 * now, sending and recording nothing (POST /journeys/{id}/versions/{n}/preview/). A step that depends on what has not
 * happened yet (this journey's messages, earlier steps, the goal) asks which way to assume. */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { controlClass } from '@/components/controlStyles'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { JourneyPreviewCustomer, JourneyPreviewRoute } from '@/lib/types'

import { SidePanel } from './SidePanel'

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function PreviewRoutePanel({ journeyId, versionNumber, dirty, onClose }: { journeyId: string; versionNumber: number; dirty: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const settled = useDebounced(search, 300)
  const [customer, setCustomer] = useState<JourneyPreviewCustomer | null>(null)
  const [assumptions, setAssumptions] = useState<Record<string, 'YES' | 'NO'>>({})
  const found = useQuery({
    queryKey: ['journeys', 'preview-customers', settled.trim()],
    queryFn: ({ signal }) => api.get<JourneyPreviewCustomer[]>('/journeys/preview-customers/', { q: settled.trim() }, signal),
    enabled: settled.trim().length >= 2 && customer === null,
  })
  const route = useQuery({
    queryKey: ['journeys', journeyId, 'preview', versionNumber, customer?.party_id, assumptions],
    queryFn: () => api.post<JourneyPreviewRoute>(`/journeys/${journeyId}/versions/${versionNumber}/preview/`, { party_id: customer!.party_id, assumptions }),
    enabled: customer !== null,
    placeholderData: (previous) => previous,
  })
  return (
    <SidePanel title="Preview Route" subtitle={`Version ${versionNumber} · nothing is sent, nothing is recorded`} wide onClose={onClose}>
      <div className="space-y-4">
        {dirty && <p className="rounded-control-lg border border-line-subtle bg-surface-subtle px-3 py-2 text-sm text-ink-800">The preview walks the last saved draft. Save Draft to include the changes on the canvas.</p>}
        <div>
          <label htmlFor="preview-as" className="block text-sm font-medium text-ink-800">Preview As</label>
          {customer ? (
            <div className="mt-1 flex items-center justify-between gap-3 rounded-control-lg border border-line px-3 py-2 text-sm">
              <span className="min-w-0 truncate"><span className="font-medium text-ink-900">{customer.name}</span>{customer.email && <span className="text-ink-800"> · {customer.email}</span>}{customer.summary && <span className="text-ink-800"> · {customer.summary}</span>}</span>
              <button type="button" onClick={() => { setCustomer(null); setAssumptions({}) }} className="shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700">Change</button>
            </div>
          ) : (
            <>
              <input id="preview-as" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email" autoFocus className={`${controlClass({ size: 'sm' })} mt-1`} />
              {found.isFetching && <p className="mt-2 flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Searching</p>}
              {found.data && found.data.length === 0 && <p className="mt-2 text-sm text-ink-800">No customer matches.</p>}
              {found.data && found.data.length > 0 && (
                <ul className="mt-2 divide-y divide-line-subtle rounded-control-lg border border-line" aria-label="Matching customers">
                  {found.data.map((item) => (
                    <li key={item.party_id}>
                      <button type="button" onClick={() => setCustomer(item)} className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-subtle">
                        <span className="text-sm font-medium text-ink-900">{item.name}</span>
                        <span className="text-xs text-ink-800">{[item.email, item.summary].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="mt-1 text-xs text-ink-800">Walks the graph with this customer’s record as it is now.</p>
        </div>

        {customer && route.isPending && <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Walking the journey</p>}
        {customer && route.isError && <ErrorState error={route.error} onRetry={() => void route.refetch()} />}
        {customer && route.data && (
          <ol className="flex flex-col" aria-label="Preview route">
            <li className="flex items-start gap-3 border-b border-line-subtle py-3">
              <span className="cep-num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fill-subtle text-xs font-semibold text-ink-900">1</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">Entry</p>
                <p className={`text-helper ${route.data.entry?.enters === false ? 'text-danger-text' : 'text-ink-800'}`}>{route.data.entry?.outcome}</p>
              </div>
            </li>
            {route.data.steps.map((step, index) => (
              <li key={`${step.node_key ?? 'end'}-${index}`} className="flex items-start gap-3 border-b border-line-subtle py-3 last:border-0" data-preview-step={step.node_key ?? undefined}>
                <span className="cep-num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fill-subtle text-xs font-semibold text-ink-900">{index + 2}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{step.label}</p>
                  <p className="text-helper text-ink-800">{step.outcome}{step.at && step.node_type === 'WAIT' ? '' : step.at && (step.node_type === 'EXIT' || step.node_type === 'END') ? '' : ''}</p>
                  {step.depends && step.node_key && (
                    <div className="mt-1.5">
                      <SegmentedControl label={`Assume for ${step.label}`} variant="outline"
                        options={step.node_type === 'GOAL' ? [{ value: 'NO', label: 'Assume not reached' }, { value: 'YES', label: 'Assume reached' }] : [{ value: 'NO', label: 'Assume No' }, { value: 'YES', label: 'Assume Yes' }]}
                        value={assumptions[step.node_key] ?? step.assumed ?? 'NO'} onChange={(value) => setAssumptions((current) => ({ ...current, [step.node_key as string]: value as 'YES' | 'NO' }))} />
                    </div>
                  )}
                  {step.at && (step.node_type === 'WAIT') && <p className="cep-num mt-0.5 text-xs text-ink-800">{formatDateTime(step.at)}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-ink-800">Test Publish still sends real messages to the test list; Preview Route is the no-send check before it.</p>
      </div>
    </SidePanel>
  )
}
