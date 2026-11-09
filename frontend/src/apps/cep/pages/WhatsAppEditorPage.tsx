/** /templates/:id/whatsapp : the WhatsApp template editor wired to the API. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorState, FullPageSpinner } from '@/components/States'
import { WhatsAppWorkspace, type WhatsAppBackend, type WhatsAppNumber } from '@/apps/cep/features/messaging/WhatsAppWorkspace'
import { api } from '@/lib/api'
import type { MediaAsset, Page, PersonalizationTag, SenderProfile, Template, WhatsAppTemplate } from '@/lib/types'
import { dripLockNote } from '@/apps/cep/features/templates/lastUsed'

export function WhatsAppEditorPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const template = useQuery({ queryKey: ['templates', 'detail', id], queryFn: ({ signal }) => api.get<Template>(`/templates/${id}/`, undefined, signal) })
  const isWhatsApp = template.data?.channel === 'WHATSAPP'
  // gcTime 0: always open on what is stored now, never on a cached copy of an older version
  const parts = useQuery({ queryKey: ['templates', 'whatsapp', id], queryFn: ({ signal }) => api.get<WhatsAppTemplate>(`/templates/${id}/whatsapp/`, undefined, signal), enabled: isWhatsApp, gcTime: 0, staleTime: Infinity })
  const tags = useQuery({ queryKey: ['personalization-tags', 'all'], queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal) })
  const senders = useQuery({ queryKey: ['sender-profiles', 'options'], queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal), retry: false })

  const numbers = useMemo<WhatsAppNumber[]>(() => {
    const found = new Map<string, WhatsAppNumber>()
    for (const sender of senders.data ?? []) {
      if (sender.channel !== 'WHATSAPP' || !sender.delivery_provider || found.has(sender.delivery_provider)) continue
      found.set(sender.delivery_provider, { engine: sender.delivery_provider, label: `${sender.sender_id ?? ''} · ${sender.display_name}`, name: sender.display_name })
    }
    return [...found.values()]
  }, [senders.data])

  const backend = useMemo<WhatsAppBackend>(() => ({
    save: async (input) => {
      const saved = await api.post<WhatsAppTemplate>(`/templates/${id}/whatsapp/`, input)
      void queryClient.invalidateQueries({ queryKey: ['templates'], refetchType: 'none' })
      return saved
    },
    submit: async () => {
      const sent = await api.post<WhatsAppTemplate>(`/templates/${id}/whatsapp/submit/`)
      void queryClient.invalidateQueries({ queryKey: ['templates'], refetchType: 'none' })
      return sent
    },
    activate: async () => {
      await api.post<Template>(`/templates/${id}/activate/`)
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
    copy: async () => (await api.post<Template>(`/templates/${id}/clone/`, {})).id,
    uploadMedia: (file) => api.upload<MediaAsset>('/media-assets/', file),
  }), [id, queryClient])

  const back = <Link to="/templates" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates</Link>
  const failed = [template, parts, tags].find((query) => query.isError)
  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
        {back}
      </div>
    )
  }
  if (template.data && !isWhatsApp) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState title="This is not a WhatsApp template" detail={`"${template.data.name}" is ${template.data.channel}.`} />
        {back}
      </div>
    )
  }
  if (!template.data || !parts.data || !tags.data) return <FullPageSpinner label="Opening the WhatsApp editor" />

  return (
    <WhatsAppWorkspace
      key={`${id}:${parts.data.version_number}`}
      templateName={template.data.name}
      status={template.data.status}
      template={parts.data}
      tags={tags.data.results}
      numbers={numbers}
      backend={backend}
      backTo="/templates"
      readOnly={!can('template.edit') || template.data.status === 'ARCHIVED'}
      lockNote={dripLockNote(template.data)}
      onCopied={(copy) => {
        void queryClient.invalidateQueries({ queryKey: ['templates'] })
        navigate(`/templates/${copy}/whatsapp`)
      }}
    />
  )
}
