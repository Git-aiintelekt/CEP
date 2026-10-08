/** The journey page's Webhook Calls card: the last calls the journey's Webhook steps made, from the integration log
 * (GET /journeys/{id}/webhook-calls/). Shown only when the journey has a Webhook step. */
import { useQuery } from '@tanstack/react-query'

import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { DetailCard } from '@/features/campaigns/parts'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { JourneyWebhookCall } from '@/lib/types'

const OUTCOME_LABEL: Record<string, string> = { OK: 'Delivered', RETRY: 'Retried', REJECTED: 'Refused', ERROR: 'Failed' }

export function WebhookCallsCard({ journeyId }: { journeyId: string }) {
  const query = useQuery({
    queryKey: ['journeys', journeyId, 'webhook-calls'],
    queryFn: ({ signal }) => api.get<JourneyWebhookCall[]>(`/journeys/${journeyId}/webhook-calls/`, { limit: 50 }, signal),
    refetchInterval: 60_000,
  })
  const rows = query.data ?? []
  return (
    <DetailCard title="Webhook Calls" flush>
      {query.isPending ? <div className="p-6"><Spinner /></div>
        : query.isError ? <div className="p-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
        : rows.length === 0 ? <p className="p-6 text-sm text-ink-800">No calls yet. Each call a Webhook step makes, and every test call, is listed here with the endpoint’s answer.</p>
        : (
          <table className="w-full text-sm" aria-label="Webhook calls">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                <th className="px-3 py-2">When</th><th className="px-3 py-2">Address</th><th className="px-3 py-2">Answer</th><th className="px-3 py-2">Step</th><th className="px-3 py-2">Took</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle last:border-0">
                  <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(row.called_at)}</td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-ink-900" title={row.url}>{row.url}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <StatusBadge status={row.outcome === 'OK' ? 'COMPLETED' : row.outcome === 'RETRY' ? 'PAUSED' : 'FAILED'} label={OUTCOME_LABEL[row.outcome] ?? row.outcome} />
                      <span className="cep-num text-xs text-ink-800">{row.status ?? row.error ?? ''}{row.attempt > 1 ? ` · try ${row.attempt}` : ''}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-800">{row.test ? 'Test call' : row.node_key ?? '—'}</td>
                  <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{row.duration_ms === null ? '—' : `${row.duration_ms} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </DetailCard>
  )
}
