/** The Content step: the template (chosen in a drawer), who it is sent from and its topic, the subject line and preheader if the campaign has its own, and a preview beside them. */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Monitor, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Field, buttonSecondary } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { SelectMenu } from '@/components/SelectMenu'
import { ErrorState } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { META_STATUS } from '@/apps/cep/features/messaging/whatsappStatus'
import { api } from '@/lib/api'
import { campaignEditorLink, editorRouteFor } from '@/lib/editorRoute'
import type { Campaign, Page, SenderProfile, SubscriptionTopicList, Template } from '@/lib/types'

import { MessagePreview, type PreviewDevice } from '../MessagePreview'
import type { CampaignFormValues } from '../schema'
import { setupHref } from '../setupFlow'
import { SENDER_FIT, TEMPLATE_FIT } from '../vocabulary'

import { ChooseTemplateDrawer } from './ChooseTemplateDrawer'
import { LinkTrackingRow } from './LinkTrackingRow'
import { SubjectPreheaderCard } from './SubjectPreheaderCard'


const LINK = 'text-sm font-medium text-brand-800 hover:underline'
const EDITOR_NAME: Record<ReturnType<typeof editorRouteFor>, string> = { design: 'Designer', receipt: 'Receipt Editor', message: 'Message Editor', whatsapp: 'WhatsApp Editor' }

export function StepTemplate({ campaign }: { campaign: Campaign | null }) {
  const { can } = useAuth()
  const { watch, setValue, clearErrors, formState: { errors } } = useFormContext<CampaignFormValues>()
  const channel = watch('channel')
  const isReceipt = watch('campaign_type') === 'E_RECEIPT'
  const marketing = watch('solicitation_type') === 'MARKETING'
  const chosen = watch('template')
  const sender = watch('sender_profile')
  const [choosing, setChoosing] = useState(false)
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const hasOwnHeader = watch('subject_line').trim() !== '' || watch('preheader').trim() !== ''
  const [overriding, setOverriding] = useState(hasOwnHeader)

  const templates = useQuery({
    queryKey: ['templates', 'options'],
    queryFn: ({ signal }) => api.get<Page<Template>>('/templates/', { page_size: 200 }, signal),
  })
  const topics = useQuery({
    queryKey: ['subscription-topics'],
    queryFn: ({ signal }) => api.get<SubscriptionTopicList>('/subscription-topics/', undefined, signal),
    enabled: marketing && !isReceipt,
  })
  const senders = useQuery({
    queryKey: ['sender-profiles', 'options'],
    queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal),
    refetchOnWindowFocus: true,                         // a sender added in the other tab (New Sender) is here on return
  })

  const fit = isReceipt ? (channel === 'SMS' || channel === 'MMS' ? [channel] : ['E_RECEIPT']) : (TEMPLATE_FIT[channel] ?? [])     // a text receipt uses a message template
  const usable = (templates.data?.results ?? []).filter((item) => item.status !== 'ARCHIVED' && fit.includes(item.channel))
  const picked = (templates.data?.results ?? []).find((item) => item.id === chosen)
  const wrongChannel = picked && !fit.includes(picked.channel)
  const senderOptions = (senders.data ?? []).filter((item) => (SENDER_FIT[channel] ?? []).includes(item.channel))
  const pickedSender = (senders.data ?? []).find((item) => item.id === sender)
  const senderChannel = channel === 'EMAIL' ? 'EMAIL' : channel === 'SMS' || channel === 'MMS' ? 'SMS' : channel === 'WHATSAPP' ? 'WHATSAPP' : null
  const channelName = isReceipt ? 'e-receipt' : channel
  const topicChannel = channel === 'EMAIL' ? 'EMAIL' : 'SMS'
  const topicOptions = (topics.data?.enabled ? topics.data.results : []).filter((item) => item.channels.includes(topicChannel))
  const askTopic = marketing && !isReceipt && topicOptions.length > 0

  const hasEmailHeader = Boolean(picked && !wrongChannel && (picked.channel === 'EMAIL' || picked.channel === 'E_RECEIPT'))
  const newSender = can('provider.edit') && (
    <Link to={`/settings/delivery?add=sender${senderChannel ? `&channel=${senderChannel}` : ''}`} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 ${LINK}`}>
      New Sender <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
    </Link>
  )

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div>
            <p id="content-template" className="text-sm font-semibold text-ink-900">Template</p>
            <div aria-labelledby="content-template" role="group" data-template-row className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
              {picked ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-card-title font-semibold text-ink-900" title={picked.name}>{picked.name}</span>
                  <StatusBadge status={picked.status} />
                  {picked.whatsapp && <Tag tone={META_STATUS[picked.whatsapp.meta_status].tone}>{META_STATUS[picked.whatsapp.meta_status].label}</Tag>}
                </span>
              ) : (
                <span className="text-sm text-ink-800">{templates.isPending ? 'Loading templates' : `No template chosen yet.`}</span>
              )}
              <button type="button" className={buttonSecondary} disabled={templates.isPending || templates.isError} onClick={() => setChoosing(true)}>{picked ? 'Change' : 'Choose a Template'}</button>
            </div>
            {errors.template?.message && <p role="alert" className="mt-1.5 text-helper font-medium text-danger-text">{errors.template.message}</p>}
            {templates.isError && <div className="mt-2"><ErrorState error={templates.error} onRetry={() => void templates.refetch()} /></div>}
            {wrongChannel && (
              <p role="alert" className="mt-2 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
                “{picked.name}” is a {picked.channel} template and this is a {channelName} campaign. Choose another template.
              </p>
            )}
            {picked?.status === 'DRAFT' && !wrongChannel && (
              <p className="mt-2 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
                “{picked.name}” is still a draft. It can be tested from here; a production publish needs the template to be published first.
              </p>
            )}
          </div>

          <Field label="Send From" strong labelEnd={newSender || undefined} error={errors.sender_profile?.message}
            hint={senders.isPending ? 'Loading senders'
              : senderOptions.length === 0 ? `No ${channel} sender is set up yet. ${can('provider.edit') ? 'Add one with New Sender; it appears here when you come back.' : 'An administrator adds one under Settings, Sending Engines.'}`
              : undefined}>
            {(ids) => (
              <SelectMenu id={ids.id} describedBy={ids.describedBy} invalid={ids.invalid} label="Send From" placeholder="Choose a Sender" value={sender}
                options={[{ value: '', label: 'Choose a Sender' }, ...senderOptions.map((item) => ({
                  value: item.id,
                  label: `${item.display_name} · ${item.from_address ?? item.sender_id ?? item.channel}${item.provider_type === 'SMTP' ? ' · your mail server' : ''}${item.verification_status === 'VERIFIED' ? '' : ' (not verified)'}`,
                }))]}
                onChange={(next) => { setValue('sender_profile', next, { shouldDirty: true }); clearErrors('sender_profile') }} />
            )}
          </Field>
          {pickedSender && pickedSender.verification_status !== 'VERIFIED' && (
            <p className="-mt-3 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">This sender is not verified yet. Publishing needs a verified sender.</p>
          )}

          {askTopic && (
            <Field label="Topic" strong error={errors.topic?.message}
              hint="The preference-centre topic this campaign is filed under. People who unticked it on the preference page are left out, counted as Topic Opted Out. Needed to publish; topics are managed under Settings, Preference Centre.">
              {(ids) => (
                <SelectMenu id={ids.id} describedBy={ids.describedBy} invalid={ids.invalid} label="Topic" placeholder="Choose a Topic" value={watch('topic')}
                  options={[{ value: '', label: 'Choose a Topic' }, ...topicOptions.map((item) => ({ value: item.id, label: item.name }))]}
                  onChange={(next) => setValue('topic', next, { shouldDirty: true, shouldValidate: true })} />
              )}
            </Field>
          )}

          {picked && !wrongChannel && (
            <section aria-label="Message Details" className="overflow-hidden rounded-lg border border-line bg-surface">
              {hasEmailHeader && (
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-card-title font-semibold text-ink-900">Subject and Preheader</h2>
                    {overriding ? (
                      <button type="button" className={LINK} onClick={() => {
                        setValue('subject_line', '', { shouldDirty: true, shouldValidate: true })
                        setValue('preheader', '', { shouldDirty: true, shouldValidate: true })
                        setOverriding(false)
                      }}>Use Template’s</button>
                    ) : (
                      <button type="button" className={LINK} aria-expanded={false} onClick={() => setOverriding(true)}>Override</button>
                    )}
                  </div>
                  {overriding && (
                    <div className="mt-4">
                      <SubjectPreheaderCard key={picked.id} template={picked} />
                    </div>
                  )}
                </div>
              )}
              <div className={hasEmailHeader ? 'border-t border-line' : ''}><LinkTrackingRow /></div>
            </section>
          )}
        </div>

        <section aria-labelledby="content-preview" className="self-start overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id="content-preview" className="text-card-title font-semibold text-ink-900">Preview</h2>
            {hasEmailHeader && (
              <SegmentedControl label="Preview Size" iconOnly value={device} onChange={setDevice}
                options={[{ value: 'desktop', label: 'Desktop', icon: Monitor }, { value: 'mobile', label: 'Mobile', icon: Smartphone }]} />
            )}
          </div>
          <div className="bg-surface-subtle p-4">
            {!chosen ? (
              <p className="text-sm text-ink-800">Choose a template to see it here.</p>
            ) : !campaign ? (
              <p className="text-sm text-ink-800">The preview appears once the draft is saved.</p>
            ) : hasEmailHeader ? (
              <MessagePreview campaignId={campaign.id} templateId={chosen} controls={{ party: '', device, sender: pickedSender?.display_name ?? '' }} />
            ) : (
              <MessagePreview campaignId={campaign.id} templateId={chosen} />
            )}
            {chosen && campaign && picked && can('template.edit') && (
              <Link to={campaignEditorLink(picked, campaign.id, setupHref(campaign.id, { step: 'content' }))} target="_blank" rel="noreferrer" className={`mt-3 inline-flex items-center gap-1 ${LINK}`}>
                Open in the {EDITOR_NAME[editorRouteFor(picked.channel)]} <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
              </Link>
            )}
          </div>
        </section>
      </div>

      {choosing && (
        <ChooseTemplateDrawer templates={usable} current={chosen} channelName={channelName} canCreate={can('template.edit')}
          onUse={(id) => setValue('template', id, { shouldDirty: true, shouldValidate: true })} onClose={() => setChoosing(false)} />
      )}
    </div>
  )
}
