import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { buttonDanger, buttonPrimary, buttonSecondary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber, humanize } from '@/lib/format'
import type { Campaign, CampaignRun } from '@/lib/types'

const PUBLISHABLE = new Set(['DRAFT', 'TEST_PUBLISHED'])

const runColumns: Column<CampaignRun>[] = [
  { key: 'number', header: 'Run', render: (run) => <span className="font-medium text-ink-900">#{run.run_number}</span> },
  { key: 'type', header: 'Type', render: (run) => humanize(run.run_type) },
  { key: 'status', header: 'Status', render: (run) => <StatusBadge status={run.status} /> },
  { key: 'mode', header: 'Mode', render: (run) => <Tag>{run.test_mode ? 'TEST' : 'PRODUCTION'}</Tag> },
  { key: 'scheduled', header: 'Scheduled', render: (run) => formatDateTime(run.scheduled_at) },
  { key: 'started', header: 'Started', render: (run) => formatDateTime(run.started_at) },
  { key: 'completed', header: 'Completed', render: (run) => formatDateTime(run.completed_at) },
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-ink-900">{children}</dd>
    </div>
  )
}

export function CampaignDetailPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const campaign = useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${id}/`, undefined, signal),
  })

  const publish = useMutation({
    mutationFn: () => api.post<CampaignRun>(`/campaigns/${id}/publish/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/campaigns/${id}/`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      navigate('/campaigns', { replace: true })
    },
  })

  if (campaign.isPending) {
    return (
      <p className="flex items-center gap-3 text-sm text-ink-500">
        <Spinner /> Loading campaign
      </p>
    )
  }
  if (campaign.isError) return <ErrorState error={campaign.error} onRetry={() => void campaign.refetch()} />

  const data = campaign.data
  const canPublish = can('campaign.publish') && PUBLISHABLE.has(data.status)
  const canEdit = can('campaign.edit') && PUBLISHABLE.has(data.status) && !data.is_journey_generated
  const canDelete = can('campaign.edit') && data.status === 'DRAFT' && data.runs.length === 0

  return (
    <section>
      <Link to="/campaigns" className="mb-3 inline-block text-sm font-medium text-brand-700 hover:underline">
        ← Campaigns
      </Link>
      <PageHeader
        title={data.name}
        description={data.description ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {canDelete && (
              <button
                type="button"
                disabled={remove.isPending}
                className={buttonDanger}
                onClick={() => {
                  if (window.confirm(`Delete the draft "${data.name}"? This cannot be undone from here.`)) remove.mutate()
                }}
              >
                Delete draft
              </button>
            )}
            {canEdit && (
              <Link to={`/campaigns/${data.id}/edit`} className={buttonSecondary}>
                Edit
              </Link>
            )}
            {canPublish && (
              <button type="button" onClick={() => publish.mutate()} disabled={publish.isPending} className={buttonPrimary}>
                {publish.isPending && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                Publish to production
              </button>
            )}
          </div>
        }
      />

      {publish.isError && (
        <div className="mb-4">
          <ErrorState title="This campaign is not ready to publish" error={publish.error} />
        </div>
      )}
      {remove.isError && (
        <div className="mb-4">
          <ErrorState title="Could not delete the campaign" error={remove.error} />
        </div>
      )}

      <dl className="mb-6 grid grid-cols-2 gap-5 rounded-xl border border-line bg-surface p-5 md:grid-cols-4">
        <Field label="Code">{data.code ?? '—'}</Field>
        <Field label="Status">
          <StatusBadge status={data.status} label={data.status_label} />
        </Field>
        <Field label="Type">{humanize(data.campaign_type)}</Field>
        <Field label="Channel">
          <Tag>{data.channel}</Tag>
        </Field>
        <Field label="Solicitation">{humanize(data.solicitation_type)}</Field>
        <Field label="Scheduled">{formatDateTime(data.scheduled_at)}</Field>
        <Field label="Template">{data.template_name ?? 'Not chosen yet'}</Field>
        <Field label="Sender">{data.sender_profile_name ?? 'Not chosen yet'}</Field>
        <Field label="Source">{data.is_journey_generated ? 'Generated by a journey' : 'Created directly'}</Field>
        <Field label="Updated">{formatDateTime(data.updated_at)}</Field>
      </dl>

      {data.campaign_type !== 'E_RECEIPT' && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Audience</h2>
          {data.contact_list_details.length === 0 ? (
            <div className="mb-6">
              <EmptyState title="No contact list attached" hint="Attach at least one list before publishing." />
            </div>
          ) : (
            <ul className="mb-6 divide-y divide-line rounded-xl border border-line bg-surface">
              {data.contact_list_details.map((list) => (
                <li key={list.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-ink-900">{list.name}</span>
                    <Tag>{list.list_kind}</Tag>
                    {list.is_master && <Tag>MASTER</Tag>}
                  </span>
                  <span className="text-ink-700 tabular-nums">{formatNumber(list.member_count)} members</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold text-ink-900">Runs</h2>
      {data.runs.length === 0 ? (
        <EmptyState title="No runs yet" hint="Publishing the campaign creates run #1. Recurring and drip campaigns add a run per send." />
      ) : (
        <DataTable columns={runColumns} rows={data.runs} rowKey={(run) => run.id} caption="Campaign runs" />
      )}
    </section>
  )
}
