/** The journey page's Webhook Calls card: the last calls the journey's Webhook steps made, from the integration log
 * (GET /journeys/{id}/webhook-calls/). Shown only when the journey has a Webhook step. */
import { useQuery } from '@tanstack/react-query'

import { DataTable } from '@/components/DataTable'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { DetailCard } from '@/apps/cep/features/campaigns/parts'
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
          <DataTable rows={rows} rowKey={(row) => String(row.id)} caption="Webhook calls" inset="card" framed={false} primary="when" columns={[
            { key: 'when', header: 'When', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDateTime(row.called_at)}</span> },
            { key: 'url', header: 'Address', render: (row) => <span className="block max-w-[16rem] truncate text-ink-900" title={row.url}>{row.url}</span> },
            { key: 'answer', header: 'Answer', render: (row) => (
              <span className="flex items-center gap-2">
                <StatusBadge status={row.outcome === 'OK' ? 'COMPLETED' : row.outcome === 'RETRY' ? 'PAUSED' : 'FAILED'} label={OUTCOME_LABEL[row.outcome] ?? row.outcome} />
                <span className="cep-num text-xs text-ink-800">{row.status ?? row.error ?? ''}{row.attempt > 1 ? ` · try ${row.attempt}` : ''}</span>
              </span>
            ) },
            { key: 'step', header: 'Step', render: (row) => <span className="text-ink-800">{row.test ? 'Test call' : row.node_key ?? '—'}</span> },
            { key: 'took', header: 'Took', align: 'right', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{row.duration_ms === null ? '—' : `${row.duration_ms} ms`}</span> },
          ]} />
        )}
    </DetailCard>
  )
}
