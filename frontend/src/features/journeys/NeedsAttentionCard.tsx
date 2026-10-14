/** The journey page's Needs Attention card: customers whose step failed for a temporary reason and is being retried, or was
 * given up on after the last try (GET /journeys/{id}/attention/, apps/journeys/engine/retries.py). Retry Now runs the step
 * again on the next pass; Skip Step records it as skipped and moves the customer on. Both need Journeys · Edit. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/auth/AuthContext'
import { DataTable } from '@/components/DataTable'
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
          <DataTable rows={rows} rowKey={(row) => row.id} caption="Customers needing attention" inset="card" framed={false} primary="customer" columns={[
            { key: 'customer', header: 'Customer', render: (row) => <span className="flex flex-col"><span className="text-card-title font-semibold text-ink-900">{row.name}</span>{row.email && <span className="text-helper text-ink-800">{row.email}</span>}</span> },
            { key: 'step', header: 'Step', render: (row) => <span className="text-ink-900">{row.label}</span> },
            { key: 'reason', header: 'What Happened', render: (row) => <span className="text-ink-800">{row.reason}<span className="block text-xs">Temporary</span></span> },
            { key: 'tries', header: 'Tries', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{Math.min(row.attempts, row.max_attempts)} of {row.max_attempts}</span> },
            { key: 'next', header: 'Next Try', render: (row) => <span className="text-ink-800">{nextWords(row)}</span> },
            ...(editable ? [{ key: 'actions', header: 'Actions', align: 'right' as const, render: (row: JourneyAttentionRow) => (
              <span className="flex flex-wrap justify-end gap-2">
                <button type="button" className={buttonSecondary} disabled={act.isPending} onClick={() => act.mutate({ id: row.id, what: 'retry' })}>Retry Now</button>
                <button type="button" className={buttonSecondary} disabled={act.isPending} onClick={() => act.mutate({ id: row.id, what: 'skip' })}>Skip Step</button>
              </span>
            ) }] : []),
          ]} />
        )}
    </DetailCard>
  )
}
