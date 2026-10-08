/** The journey page's Needs Attention card: customers whose step failed for a temporary reason and is being retried, or was
 * given up on after the last try (GET /journeys/{id}/attention/, apps/journeys/engine/retries.py). Retry Now runs the step
 * again on the next pass; Skip Step records it as skipped and moves the customer on. Both need Journeys · Edit. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/auth/AuthContext'
import { buttonSecondary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { DetailCard } from '@/features/campaigns/parts'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { JourneyAttentionRow } from '@/lib/types'

function nextWords(row: JourneyAttentionRow): string {
  if (row.gave_up_at) return `Gave up ${formatDateTime(row.gave_up_at)}`
  if (row.next_try_at) {
    const minutes = Math.max(0, Math.round((new Date(row.next_try_at).getTime() - Date.now()) / 60_000))
    return minutes === 0 ? 'Retrying now' : `Retrying in ${minutes} min`
  }
  return 'Retrying'
}

export function NeedsAttentionCard({ journeyId, published }: { journeyId: string; published: boolean }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const key = ['journeys', journeyId, 'attention']
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<JourneyAttentionRow[]>(`/journeys/${journeyId}/attention/`, undefined, signal),
    enabled: published,
    refetchInterval: 60_000,
  })
  const act = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'retry' | 'skip' }) => api.post(`/journeys/${journeyId}/customers/${id}/${what}/`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['journeys', journeyId, 'customers'] })
    },
  })
  const editable = can('journey.edit')
  const rows = query.data ?? []
  if (!published) return null
  return (
    <DetailCard title="Needs Attention" tag={rows.length ? <span className="cep-num text-helper text-ink-800">{rows.length}</span> : undefined} flush>
      {query.isPending ? <div className="p-6"><Spinner /></div>
        : query.isError ? <div className="p-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
        : rows.length === 0 ? <p className="p-6 text-sm text-ink-800">Nothing needs attention. A step that fails for a temporary reason is retried after 5, 15 and 60 minutes; what still fails lands here.</p>
        : (
          <table className="w-full text-sm" aria-label="Customers needing attention">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                <th className="px-3 py-2">Customer</th><th className="px-3 py-2">Step</th><th className="px-3 py-2">What Happened</th><th className="px-3 py-2">Tries</th><th className="px-3 py-2">Next</th>
                {editable && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle last:border-0">
                  <td className="px-3 py-2"><span className="font-medium text-ink-900">{row.name}</span>{row.email && <span className="block text-xs text-ink-800">{row.email}</span>}</td>
                  <td className="px-3 py-2 text-ink-900">{row.label}</td>
                  <td className="px-3 py-2 text-ink-800">{row.reason}<span className="block text-xs">Temporary</span></td>
                  <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{Math.min(row.attempts, row.max_attempts)} of {row.max_attempts}</td>
                  <td className="px-3 py-2 text-ink-800">{nextWords(row)}</td>
                  {editable && (
                    <td className="px-3 py-2">
                      <span className="flex justify-end gap-2">
                        <button type="button" className={buttonSecondary} disabled={act.isPending} onClick={() => act.mutate({ id: row.id, what: 'retry' })}>Retry Now</button>
                        <button type="button" className={buttonSecondary} disabled={act.isPending} onClick={() => act.mutate({ id: row.id, what: 'skip' })}>Skip Step</button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </DetailCard>
  )
}
