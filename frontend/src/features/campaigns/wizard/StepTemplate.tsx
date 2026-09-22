/** Step 3: the message and who it comes from. Templates are picked on cards (the prototype's "Use an existing template"), with a preview beside them. */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Field, Select } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { Campaign, Page, SenderProfile, Template } from '@/lib/types'

import { MessagePreview } from '../MessagePreview'
import { Panel } from '../parts'
import type { CampaignFormValues } from '../schema'
import { SENDER_FIT, TEMPLATE_FIT } from '../vocabulary'

const DESIGNER_CHANNELS = ['EMAIL', 'E_RECEIPT']

export function StepTemplate({ campaign }: { campaign: Campaign | null }) {
  const { can } = useAuth()
  const { register, watch, setValue, formState: { errors } } = useFormContext<CampaignFormValues>()
  const channel = watch('channel')
  const isReceipt = watch('campaign_type') === 'E_RECEIPT'
  const marketing = watch('solicitation_type') === 'MARKETING'
  const chosen = watch('template')
  const sender = watch('sender_profile')
  const [search, setSearch] = useState('')

  const templates = useQuery({
    queryKey: ['templates', 'options'],
    queryFn: ({ signal }) => api.get<Page<Template>>('/templates/', { page_size: 200 }, signal),
  })
  const senders = useQuery({
    queryKey: ['sender-profiles', 'options'],
    queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal),
  })

  const fit = isReceipt ? ['E_RECEIPT'] : (TEMPLATE_FIT[channel] ?? [])
  const usable = (templates.data?.results ?? []).filter((item) => item.status !== 'ARCHIVED' && fit.includes(item.channel))
  const shown = usable.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
  const picked = (templates.data?.results ?? []).find((item) => item.id === chosen)
  const wrongChannel = picked && !fit.includes(picked.channel)
  const senderOptions = (senders.data ?? []).filter((item) => (SENDER_FIT[channel] ?? []).includes(item.channel))
  const pickedSender = (senders.data ?? []).find((item) => item.id === sender)
  const channelName = isReceipt ? 'e-receipt' : channel

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Panel
          title="Use an existing template"
          description="Both the template and the sender are needed to publish, not to save a draft."
          actions={can('template.edit') && <Link to="/templates/new" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">New template <ExternalLink size={14} strokeWidth={1.5} aria-hidden /></Link>}
        >
          {errors.template?.message && <p role="alert" className="mb-3 text-xs font-medium text-danger-text">{errors.template.message}</p>}
          {wrongChannel && (
            <p role="alert" className="mb-3 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
              “{picked.name}” is a {picked.channel} template and this is a {channelName} campaign. Choose another template.
            </p>
          )}
          {templates.isPending ? (
            <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading templates</p>
          ) : templates.isError ? (
            <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
          ) : usable.length === 0 ? (
            <p className="text-sm text-ink-500">No {channelName} templates yet.</p>
          ) : (
            <>
              {usable.length > 6 && (
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" aria-label="Search templates"
                  className="mb-3 h-10 w-full rounded-sm border border-line bg-surface px-3 text-sm sm:w-64" />
              )}
              <div role="radiogroup" aria-label="Template" className="grid max-h-[26rem] gap-3 overflow-y-auto sm:grid-cols-2">
                {shown.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={chosen === item.id} onClick={() => setValue('template', chosen === item.id ? '' : item.id, { shouldDirty: true, shouldValidate: true })}
                    className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors ${chosen === item.id ? 'border-brand-600 bg-callout-bg' : 'border-line bg-surface hover:bg-surface-subtle'}`}>
                    <span className="w-full truncate text-sm font-semibold text-ink-900">{item.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5"><Tag>{item.channel}</Tag><StatusBadge status={item.status} /></span>
                    <span className="text-xs text-ink-500">Edited {formatDate(item.updated_at)}{item.latest_version ? ` · version ${item.latest_version}` : ''}</span>
                  </button>
                ))}
                {shown.length === 0 && <p className="text-sm text-ink-500">No template matches that search.</p>}
              </div>
              {picked?.status === 'DRAFT' && !wrongChannel && (
                <p className="mt-3 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
                  “{picked.name}” is still a draft. It can be tested from here; a production publish needs the template to be published first.
                </p>
              )}
            </>
          )}
        </Panel>

        <Panel title="Sender">
          <Field label="Send from" error={errors.sender_profile?.message}
            hint={senders.isPending ? 'Loading senders' : senderOptions.length === 0 ? `No ${channel} sender is set up yet. An administrator adds one under Settings, Delivery.` : undefined}>
            {(ids) => (
              <Select key={senders.data ? 'ready' : 'loading'} {...ids} {...register('sender_profile')}>
                <option value="">Choose later</option>
                {senderOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name} · {item.from_address ?? item.sender_id ?? item.channel}{item.provider_type === 'SMTP' ? ' · your mail server' : ''}{item.verification_status === 'VERIFIED' ? '' : ' (not verified)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {pickedSender && pickedSender.verification_status !== 'VERIFIED' && (
            <p className="mt-3 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">This sender is not verified yet. Publishing needs a verified sender.</p>
          )}
          {marketing && <p className="mt-3 text-xs text-ink-500">Marketing messages must let people opt out: an unsubscribe link in email, “Reply STOP” in a text. The pre-publish check looks for it.</p>}
        </Panel>
      </div>

      <Panel title="Preview" className="self-start">
        {!chosen ? (
          <p className="text-sm text-ink-500">Choose a template to see it here.</p>
        ) : !campaign ? (
          <p className="text-sm text-ink-500">The preview appears once the draft is saved.</p>
        ) : (
          <>
            <MessagePreview campaignId={campaign.id} templateId={chosen} />
            {picked && can('template.edit') && (
              <Link to={`/templates/${picked.id}/${DESIGNER_CHANNELS.includes(picked.channel) ? 'design' : 'message'}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">
                Open in the {DESIGNER_CHANNELS.includes(picked.channel) ? 'designer' : 'message editor'} <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
              </Link>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
