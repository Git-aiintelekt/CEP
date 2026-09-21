/** Audience: the attached and excluded lists, who the campaign would reach (or did reach: the frozen Campaign List), a sample, and the export. */
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { buttonSecondary } from '@/components/Form'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber, humanize } from '@/lib/format'
import type { Campaign, CampaignAudience } from '@/lib/types'

import { AudiencePicture } from '../AudiencePicture'
import { Panel } from '../parts'

const REASON: Record<string, string> = {
  EXCLUDED_LIST: 'In an excluded list', UNKNOWN_PARTY: 'Not a known customer', NO_EMAIL: 'No email address', NO_PHONE: 'No mobile number', UNSUBSCRIBED: 'Unsubscribed',
  NO_CONSENT: 'No consent on record', HARD_BOUNCE: 'Bounced: the address does not exist', SOFT_BOUNCE: 'Bounced repeatedly', COMPLAINT: 'Marked a message as spam',
  BLOCKED: 'Blocked', SUPPRESSED: 'Suppressed', INVALID_ADDRESS: 'Invalid address', FREQUENCY_CAP: 'Over the frequency limit',
}

export function AudienceTab({ campaign }: { campaign: Campaign }) {
  const [problem, setProblem] = useState('')
  const audience = useQuery({
    queryKey: ['campaigns', 'audience', campaign.id, campaign.row_version],
    queryFn: ({ signal }) => api.get<CampaignAudience>(`/campaigns/${campaign.id}/audience/`, undefined, signal),
    enabled: campaign.campaign_type !== 'E_RECEIPT',
  })

  if (campaign.campaign_type === 'E_RECEIPT') {
    return <EmptyState title="No audience to attach" hint="An e-receipt goes to the customer of each purchase. The point of sale or the web shop asks for every receipt." />
  }
  if (audience.isPending) return <p className="flex items-center gap-3 text-sm text-ink-500"><Spinner /> Working out the audience</p>
  if (audience.isError) return <ErrorState title="The audience could not be worked out" error={audience.error} onRetry={() => void audience.refetch()} />

  const data = audience.data
  const frozen = data.frozen

  async function exportCsv() {
    setProblem('')
    try {
      const blob = await api.download(`/campaigns/${campaign.id}/audience/export/`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${campaign.code ?? campaign.name}-audience.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setProblem(`The export was not produced. ${problemText(error)}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Contact lists" description="Lists are merged into one Campaign List, one entry per customer, when a send starts."
          actions={data.lists.length > 0 && <button type="button" className={buttonSecondary} onClick={() => void exportCsv()}><Download size={16} strokeWidth={1.5} aria-hidden /> Export CSV</button>}>
          {problem && <p role="alert" className="mb-3 text-sm font-medium text-danger-text">{problem}</p>}
          {data.lists.length === 0 ? <p className="text-sm text-ink-500">No contact list is attached yet. Attach at least one before publishing.</p> : (
            <ul className="divide-y divide-line">
              {data.lists.map((list) => (
                <li key={`${list.role}-${list.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link to={`/contact-lists/${list.id}`} className="truncate font-medium text-brand-800 hover:underline">{list.name}</Link>
                    <Tag>{list.role === 'EXCLUDE' ? 'Excluded' : 'Send to'}</Tag>
                    {list.list_environment === 'TEST' && <StatusBadge status="TEST" label="Test" />}
                    <span className="text-xs text-ink-500">{humanize(list.source_type)}</span>
                  </span>
                  <span className="cep-num text-ink-700">{formatNumber(list.member_count)} contacts</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={frozen ? 'If it were sent today' : 'Audience estimate'} className="self-start"><AudiencePicture audience={data} /></Panel>
      </div>

      {frozen && (
        <Panel title="Frozen Campaign List" description={`What the last production send actually used, frozen ${formatDateTime(frozen.generated_at)}. Later changes to the contact lists do not touch it.`}>
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 py-1.5 font-semibold text-ink-900"><dt>People in the list</dt><dd className="cep-num">{formatNumber(frozen.members)}</dd></div>
            <div className="flex justify-between gap-3 py-1.5 font-semibold text-ink-900"><dt>Sent to</dt><dd className="cep-num">{formatNumber(frozen.eligible)}</dd></div>
            {Object.entries(frozen.suppressed).map(([reason, count]) => (
              <div key={reason} className="flex justify-between gap-3 py-1.5 text-ink-700"><dt>Left out: {REASON[reason] ?? humanize(reason)}</dt><dd className="cep-num">{formatNumber(count)}</dd></div>
            ))}
          </dl>
        </Panel>
      )}

      <Panel title="Sample of the audience" description="As of today: up to ten people, the ones who can be reached first.">
        {data.sample.length === 0 ? <p className="text-sm text-ink-500">Nobody to show yet.</p> : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-surface-subtle"><tr>
                {['Customer', 'Name', data.channel === 'EMAIL' ? 'Email' : 'Mobile', 'Today'].map((header) => <th key={header} scope="col" className="h-10 px-3 text-left text-xs font-semibold text-ink-700">{header}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.sample.map((person) => (
                  <tr key={person.party_id}>
                    <td className="px-3 py-2 text-ink-700">{person.party_id}</td>
                    <td className="px-3 py-2 text-ink-900">{[person.first_name, person.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-3 py-2 text-ink-700">{person.address ?? '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={person.status === 'MARKETABLE' ? 'ACTIVE' : 'PAUSED'} label={person.status_label} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
