/** /templates/:id/message : SMS / MMS editor wired to the API. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorState, FullPageSpinner } from '@/components/States'
import { MessageWorkspace, type MessageBackend } from '@/apps/cep/features/messaging/MessageWorkspace'
import { textSenderName, useSenderProfiles } from '@/apps/cep/features/messaging/textSender'
import { api } from '@/lib/api'
import { useCampaignReturn } from '@/lib/campaignReturn'
import { announceTemplateSaved } from '@/lib/templateSaved'
import type { Campaign, DesignVersion, MediaAsset, Message, Page, PersonalizationTag, Template } from '@/lib/types'
import { dripLockNote } from '@/apps/cep/features/templates/lastUsed'

export function MessageEditorPage() {
  const { id = '' } = useParams()
  const campaignReturn = useCampaignReturn()            // opened from a campaign: Back to Campaign, Save & Return to Campaign
  const { can } = useAuth()
  const queryClient = useQueryClient()

  const template = useQuery({ queryKey: ['templates', 'detail', id], queryFn: ({ signal }) => api.get<Template>(`/templates/${id}/`, undefined, signal) })
  const isMessage = template.data ? ['SMS', 'MMS'].includes(template.data.channel) : false
  // gcTime 0: always open the editor on what is stored now, never on a cached copy of an older version
  const message = useQuery({ queryKey: ['templates', 'message', id], queryFn: ({ signal }) => api.get<Message>(`/templates/${id}/message/`, undefined, signal), enabled: isMessage, gcTime: 0, staleTime: Infinity })
  const tags = useQuery({ queryKey: ['personalization-tags', 'all'], queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal) })
  const library = useQuery({ queryKey: ['media-assets', 'library'], queryFn: ({ signal }) => api.get<Page<MediaAsset>>('/media-assets/', { page_size: 100 }, signal), enabled: template.data?.channel === 'MMS' })
  const senders = useSenderProfiles()
  const [params] = useSearchParams()
  const campaignId = campaignReturn ? params.get('campaign') ?? '' : ''
  const campaign = useQuery({ queryKey: ['campaigns', 'detail', campaignId], queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${campaignId}/`, undefined, signal), enabled: Boolean(campaignId), retry: false })

  const backend = useMemo<MessageBackend>(
    () => ({
      save: async (input) => {
        const saved = await api.post<Message>(`/templates/${id}/message/`, input)
        announceTemplateSaved(id)
        void queryClient.invalidateQueries({ queryKey: ['templates'], refetchType: 'none' })
        return saved
      },
      loadVersion: (version) => api.get<Message>(`/templates/${id}/message/`, { version }),
      listVersions: () => api.get<DesignVersion[]>(`/templates/${id}/design/versions/`),
      uploadMedia: (file) => api.upload<MediaAsset>('/media-assets/', file),
      activate: async () => {
        await api.post<Template>(`/templates/${id}/activate/`)
        void queryClient.invalidateQueries({ queryKey: ['templates'] })
      },
    }),
    [id, queryClient],
  )

  const back = <Link to="/templates" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates</Link>
  const failed = [template, message, tags].find((query) => query.isError)
  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
        {back}
      </div>
    )
  }
  if (template.data && !isMessage) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState title="This is not a text message template" detail={`"${template.data.name}" is ${template.data.channel}. Open it in the email designer instead.`} />
        <Link to={`/templates/${id}/design`} className="mt-4 mr-4 inline-block text-sm font-medium text-brand-800 hover:underline">Open the Email Designer</Link>
        {back}
      </div>
    )
  }
  if (!template.data || !message.data || !tags.data) return <FullPageSpinner label="Opening the message editor" />

  const channel = template.data.channel as 'SMS' | 'MMS'
  // opened from a campaign: that campaign's sender; otherwise (or before it has one) the workspace's sender for the channel
  const senderName = campaign.data?.sender_profile_name || textSenderName(senders.data, channel)

  return (
    <MessageWorkspace
      key={id}
      templateName={template.data.name}
      channel={channel}
      status={template.data.status}
      message={message.data}
      tags={tags.data.results}
      library={library.data?.results ?? []}
      senderName={senderName}
      backend={backend}
      backTo={campaignReturn ?? '/templates'}
      campaignReturn={campaignReturn}
      readOnly={!can('template.edit') || template.data.status === 'ARCHIVED' || Boolean(template.data.used_in_drip?.locked)}
      lockNote={dripLockNote(template.data)}
    />
  )
}
