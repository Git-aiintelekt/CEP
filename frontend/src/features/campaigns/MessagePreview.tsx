/**
 * The message as a recipient would get it. Email HTML is shown in a sandboxed frame (no scripts, no navigation),
 * a text message as a phone bubble. `party` previews as one customer of the audience; without it the
 * personalization tags show their catalogue sample values.
 */
import { useQuery } from '@tanstack/react-query'
import { Monitor, Smartphone } from 'lucide-react'
import { useState } from 'react'

import { Select } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import type { CampaignPreview } from '@/lib/types'

interface Person { party_id: string; name: string; address: string | null }

export function MessagePreview({ campaignId, templateId, withCustomers = false }: { campaignId: string; templateId?: string; withCustomers?: boolean }) {
  const [party, setParty] = useState('')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')

  const people = useQuery({
    queryKey: ['campaigns', 'sample-customers', campaignId],
    queryFn: ({ signal }) => api.get<Person[]>(`/campaigns/${campaignId}/sample-customers/`, undefined, signal),
    enabled: withCustomers,
  })
  const preview = useQuery({
    queryKey: ['campaigns', 'preview', campaignId, templateId ?? '', party],
    queryFn: ({ signal }) => api.get<CampaignPreview & { channel?: string }>(`/campaigns/${campaignId}/preview/`, { template: templateId, party_id: party }, signal),
    retry: false,
  })

  if (preview.isPending) {
    return <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading the preview</p>
  }
  if (preview.isError) {
    // 409: no template yet, or no saved content. That is a state of the campaign, not a failure.
    if (preview.error instanceof ApiError && preview.error.status === 409) return <p className="text-sm text-ink-500">{preview.error.message}</p>
    return <ErrorState title="The preview could not be built" error={preview.error} onRetry={() => void preview.refetch()} />
  }

  const data = preview.data
  const isEmail = Boolean(data.html)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{data.template} <span className="font-normal text-ink-500">· version {data.version}</span></p>
          {data.subject && isEmail && <p className="truncate text-sm text-ink-700">Subject: {data.subject}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {withCustomers && (people.data?.length ?? 0) > 0 && (
            <label className="text-xs font-medium text-ink-700">
              Preview as
              <Select value={party} onChange={(event) => setParty(event.target.value)} className="w-56">
                <option value="">Sample values</option>
                {people.data?.map((person) => <option key={person.party_id} value={person.party_id}>{person.name}</option>)}
              </Select>
            </label>
          )}
          {isEmail && (
            <div role="group" aria-label="Preview size" className="flex overflow-hidden rounded-sm border border-line">
              {([['desktop', Monitor, 'Desktop'], ['mobile', Smartphone, 'Mobile']] as const).map(([value, Icon, label]) => (
                <button key={value} type="button" aria-pressed={device === value} aria-label={label} onClick={() => setDevice(value)}
                  className={`flex h-10 w-10 items-center justify-center transition-colors ${device === value ? 'bg-callout-bg text-brand-600' : 'bg-surface text-ink-700 hover:bg-surface-subtle'}`}>
                  <Icon size={18} strokeWidth={1.5} aria-hidden />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isEmail ? (
        <div className="rounded-lg border border-line bg-surface-subtle p-3">
          <iframe title="Email preview" sandbox="" srcDoc={data.html ?? ''} className={`mx-auto block h-[560px] rounded-sm border border-line bg-surface ${device === 'mobile' ? 'w-[375px] max-w-full' : 'w-full'}`} />
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface-subtle p-5">
          <p aria-label="Text message preview" className="ml-auto max-w-sm whitespace-pre-wrap rounded-lg rounded-br-sm bg-line-subtle px-4 py-3 text-sm text-ink-900">{data.text}</p>
        </div>
      )}

      {data.tags_used.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          Personalization tags in this message: {data.tags_used.map((tag) => <Tag key={tag}>{`{{${tag}}}`}</Tag>)}
        </p>
      )}
    </div>
  )
}
