/** /templates/:id/design : loads the template, its latest design, the tag catalogue and the image library. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorState, FullPageSpinner } from '@/components/States'
import { DesignerWorkspace, type DesignerBackend } from '@/features/designer/DesignerWorkspace'
import { api } from '@/lib/api'
import type { Design, DesignVersion, MediaAsset, Page, PersonalizationTag, Template } from '@/lib/types'

const DESIGNER_CHANNELS = ['EMAIL', 'E_RECEIPT']

export default function TemplateDesignerPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const queryClient = useQueryClient()

  const template = useQuery({ queryKey: ['templates', 'detail', id], queryFn: ({ signal }) => api.get<Template>(`/templates/${id}/`, undefined, signal) })
  // gcTime 0: always open the editor on what is stored now, never on a cached copy of an older version
  const design = useQuery({ queryKey: ['templates', 'design', id], queryFn: ({ signal }) => api.get<Design>(`/templates/${id}/design/`, undefined, signal), gcTime: 0, staleTime: Infinity })
  const tags = useQuery({ queryKey: ['personalization-tags', 'all'], queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal) })
  const assets = useQuery({ queryKey: ['media-assets', 'library'], queryFn: ({ signal }) => api.get<Page<MediaAsset>>('/media-assets/', { page_size: 100 }, signal) })

  const backend = useMemo<DesignerBackend>(
    () => ({
      save: async (input) => {
        const saved = await api.post<Design>(`/templates/${id}/design/`, input)
        void queryClient.invalidateQueries({ queryKey: ['templates'], refetchType: 'none' })
        return saved
      },
      loadVersion: (version) => api.get<Design>(`/templates/${id}/design/`, { version }),
      listVersions: () => api.get<DesignVersion[]>(`/templates/${id}/design/versions/`),
      uploadAsset: async (file) => {
        const asset = await api.upload<MediaAsset>('/media-assets/', file)
        return { url: asset.url, name: asset.file_name, width: asset.width_px, height: asset.height_px }
      },
      activate: async () => {
        await api.post<Template>(`/templates/${id}/activate/`)
        void queryClient.invalidateQueries({ queryKey: ['templates'] })
      },
    }),
    [id, queryClient],
  )

  const failed = [template, design, tags].find((query) => query.isError)
  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
        <Link to="/templates" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates</Link>
      </div>
    )
  }
  if (!template.data || !design.data || !tags.data) return <FullPageSpinner label="Opening the designer" />

  if (!DESIGNER_CHANNELS.includes(template.data.channel)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState title="This is not an email template" error={new Error(`The email designer is for EMAIL and E_RECEIPT templates. "${template.data.name}" is ${template.data.channel}.`)} />
        <Link to="/templates" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates</Link>
      </div>
    )
  }

  return (
    <DesignerWorkspace
      key={id}
      templateName={template.data.name}
      channel={template.data.channel}
      status={template.data.status}
      design={design.data}
      tags={tags.data.results}
      assets={(assets.data?.results ?? []).map((asset) => ({ url: asset.url, name: asset.file_name, width: asset.width_px, height: asset.height_px }))}
      backend={backend}
      backTo="/templates"
      readOnly={!can('template.edit') || template.data.status === 'ARCHIVED'}
    />
  )
}
