/** The journey page's Suppressions card: customers this one journey never enters or messages (GET / POST / DELETE
 * /journeys/{id}/suppressions/, apps/journeys/suppressions.py). Adding one takes a customer who is inside out at once.
 * Writing needs the Journeys · Suppress permission. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { DetailCard } from '@/apps/cep/features/campaigns/parts'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { JourneySuppression } from '@/lib/types'

export function SuppressionsCard({ journeyId }: { journeyId: string }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [given, setGiven] = useState('')
  const [note, setNote] = useState('')
  const key = ['journeys', journeyId, 'suppressions']
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api.get<JourneySuppression[]>(`/journeys/${journeyId}/suppressions/`, undefined, signal) })
  const add = useMutation({
    mutationFn: () => api.post<{ added: boolean; exited: number; suppressions: JourneySuppression[] }>(`/journeys/${journeyId}/suppressions/`, { given: given.trim(), note: note.trim() }),
    onSuccess: (result) => {
      queryClient.setQueryData(key, result.suppressions)
      void queryClient.invalidateQueries({ queryKey: ['journeys', journeyId, 'customers'] })
      setGiven('')
      setNote('')
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/journeys/${journeyId}/suppressions/${id}/`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  })
  const editable = can('journey.suppress')
  const error = add.error instanceof ApiError && add.error.status === 400 ? String((add.error.problem.errors?.given as string[] | string | undefined) ?? 'The customer was not added.') : add.error ? 'The customer was not added.' : null
  const rows = query.data ?? []
  return (
    <DetailCard title="Suppressions" tag={rows.length ? <span className="cep-num text-helper text-ink-800">{rows.length}</span> : undefined}>
      <p className="text-sm text-ink-800">Customers this journey never enters or messages. Workspace suppressions and consent apply before these.</p>
      {editable && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (given.trim()) add.mutate() }}>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink-800">
            Email, mobile number or customer id
            <input value={given} onChange={(event) => setGiven(event.target.value)} aria-label="Customer to suppress" placeholder="e.g. dolores@example.com"
              className="h-9 w-full rounded-control-lg border border-line-control bg-surface px-3 text-sm text-ink-900" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink-800">
            Note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value)} aria-label="Suppression note" maxLength={200} placeholder="e.g. asked to be left out"
              className="h-9 w-full rounded-control-lg border border-line-control bg-surface px-3 text-sm text-ink-900" />
          </label>
          <button type="submit" className={buttonPrimary} disabled={!given.trim() || add.isPending}>{add.isPending ? <Spinner size="sm" /> : null} Suppress</button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-danger-text">{error}</p>}
      {add.data && add.data.exited > 0 && <p role="status" className="mt-2 text-sm text-ink-800">Taken out of the journey now.</p>}
      {query.isPending ? <div className="mt-3"><Spinner /></div>
        : query.isError ? <div className="mt-3"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
        : rows.length === 0 ? <p className="mt-3 text-sm text-ink-800">Nobody is suppressed for this journey.</p>
        : (
          <ul className="mt-3 divide-y divide-line-subtle" aria-label="Suppressed customers">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{row.name}{row.email ? <span className="font-normal text-ink-800"> · {row.email}</span> : null}</p>
                  <p className="text-xs text-ink-800">{[row.note, `${formatDateTime(row.created_at)}${row.created_by_name ? ` by ${row.created_by_name}` : ''}`].filter(Boolean).join(' · ')}</p>
                </div>
                {editable && <button type="button" className={buttonSecondary} disabled={remove.isPending} onClick={() => remove.mutate(row.id)}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
    </DetailCard>
  )
}
