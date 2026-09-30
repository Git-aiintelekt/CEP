/**
 * Settings → Approvals: whether a production publish needs a second person, and who those people are (every active user
 * whose role carries campaign.approve). Nobody approves their own request. Switching it on needs at least one approver.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ApprovalSettings } from '@/lib/types'

const KEY = ['workspace', 'approvals']

export function ApprovalsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<ApprovalSettings>('/workspace/approvals/', undefined, signal) })
  const change = useMutation({
    mutationFn: (require_approval: boolean) => api.put<ApprovalSettings>('/workspace/approvals/', { require_approval }),
    onSuccess: (next) => {
      queryClient.setQueryData(KEY, next)
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })

  if (settings.isError) return <ErrorState title="The approval settings could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = settings.data
  const noApprover = data.approvers.length === 0

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Approvals</h2>
        <p className="mt-0.5 text-sm text-ink-800">Whether a production publish needs a second person, and who can give it.</p>
      </div>

      <section className="rounded-lg border border-line bg-surface p-5">
        <Switch
          checked={data.require_approval}
          disabled={change.isPending || (noApprover && !data.require_approval)}
          onChange={(next) => change.mutate(next)}
          label="Require Approval Before a Production Publish"
          describedBy="approval-help"
        />
        <p id="approval-help" className="mt-2 text-sm text-ink-800">
          The author asks for approval on the Review & Publish step, everyone who can approve is emailed, and the campaign cannot be published until one of them approves.
          Any change to the campaign, its lists or its targets withdraws the request. Nobody approves their own campaign.
        </p>
        {noApprover && <p className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-text">Nobody can approve yet. Give a role the {data.permission} permission under Roles first.</p>}
        {change.isError && <div className="mt-3"><ErrorState title="The setting was not changed" error={change.error} /></div>}
        {data.require_approval && (
          <p className="mt-3 text-sm text-ink-800">
            {data.awaiting
              ? <><span className="cep-num font-semibold">{formatNumber(data.awaiting)}</span> campaign{data.awaiting === 1 ? '' : 's'} waiting for a decision. <Link to="/campaigns?saved=approval" className="font-semibold text-brand-800 hover:underline">Open Them</Link></>
              : 'No campaign is waiting for a decision.'}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
          <h3 className="font-display text-card-heading font-semibold text-ink-900">Who Can Approve</h3>
          <Link to="/settings/roles" className="text-sm font-semibold text-brand-800 hover:underline">Change in Roles</Link>
        </div>
        {noApprover ? (
          <div className="p-4"><EmptyState title="No Approvers" hint={`A user whose role carries ${data.permission} appears here.`} variant="plain" /></div>
        ) : (
          <ul aria-label="Approvers">
            {data.approvers.map((person) => (
              <li key={person.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-subtle px-4 py-3 last:border-b-0">
                <span className="font-semibold text-ink-900">{person.name}</span>
                <span className="text-sm text-ink-800">{person.email}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line-subtle px-4 py-3 text-xs text-ink-800">Every active user whose role carries {data.permission}. A service account counts too.</p>
      </section>
    </div>
  )
}
