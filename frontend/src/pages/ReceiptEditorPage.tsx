/** /templates/:id/receipt : loads the template, its outer design, its receipt layout, the tag catalogue and the image library. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'

import { ErrorState } from '@/components/States'
import { EditorFailure, EditorLoading } from '@/features/designer/EditorStates'
import { canEditTemplate } from '@/features/designer/editAccess'
import { ReceiptWorkspace, type ReceiptBackend } from '@/features/receipt/ReceiptWorkspace'
import { api } from '@/lib/api'
import type { CodeSample, Design, DesignVersion, MediaAsset, Page, PersonalizationTag, ReceiptLayout, Template } from '@/lib/types'

export default function ReceiptEditorPage() {
  const { id = '' } = useParams()
  const { can, has } = useAuth()
  const codes = has('dynamic_codes')
  const queryClient = useQueryClient()

  const template = useQuery({ queryKey: ['templates', 'detail', id], queryFn: ({ signal }) => api.get<Template>(`/templates/${id}/`, undefined, signal) })
  // gcTime 0: always open the editor on what is stored now, never on a cached copy of an older version
  const design = useQuery({ queryKey: ['templates', 'design', id], queryFn: ({ signal }) => api.get<Design>(`/templates/${id}/design/`, undefined, signal), gcTime: 0, staleTime: Infinity })
  const receipt = useQuery({ queryKey: ['templates', 'receipt', id], queryFn: ({ signal }) => api.get<ReceiptLayout>(`/templates/${id}/receipt/`, undefined, signal), gcTime: 0, staleTime: Infinity })
  const tags = useQuery({ queryKey: ['personalization-tags', 'all'], queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal) })
  const assets = useQuery({ queryKey: ['media-assets', 'library'], queryFn: ({ signal }) => api.get<Page<MediaAsset>>('/media-assets/', { page_size: 100 }, signal) })

  const backend = useMemo<ReceiptBackend>(
    () => ({
      saveDesign: async (input) => {
        const saved = await api.post<Design>(`/templates/${id}/design/`, input)
        void queryClient.invalidateQueries({ queryKey: ['templates'], refetchType: 'none' })
        return saved
      },
      loadDesignVersion: (version) => api.get<Design>(`/templates/${id}/design/`, { version }),
      listDesignVersions: () => api.get<DesignVersion[]>(`/templates/${id}/design/versions/`),
      saveReceiptLayout: async (input) => {
        const saved = await api.post<ReceiptLayout>(`/templates/${id}/receipt/`, input)
        void queryClient.invalidateQueries({ queryKey: ['templates'], refetchType: 'none' })
        return saved
      },
      loadReceiptLayoutVersion: (version) => api.get<ReceiptLayout>(`/templates/${id}/receipt/`, { version }),
      listReceiptLayoutVersions: () => api.get<DesignVersion[]>(`/templates/${id}/receipt/versions/`),
      uploadAsset: async (file) => {
        const asset = await api.upload<MediaAsset>('/media-assets/', file)
        return { url: asset.url, name: asset.file_name, width: asset.width_px, height: asset.height_px }
      },
      activate: async () => {
        await api.post<Template>(`/templates/${id}/activate/`)
        void queryClient.invalidateQueries({ queryKey: ['templates'] })
      },
      // Barcodes and QR codes is switched on per workspace in tenant management
      sampleCode: codes ? (request) => api.post<CodeSample>('/codes/sample/', request) : undefined,
    }),
    [id, queryClient, codes],
  )

  // as for the email designer, an image library that will not load leaves the editor usable, without pictures
  const failed = [template, design, receipt, tags].find((query) => query.isError)
  if (failed) {
    return (
      <EditorFailure
        title="Couldn’t load this template"
        detail={failed.error instanceof Error ? failed.error.message : 'The server did not answer. Your last saved version is safe.'}
        onRetry={() => void failed.refetch()}
        // this screen replaces the whole window, so it keeps the one way out the editor's own chrome would have given
        footer={
          <Link to="/templates" className="mt-2 inline-flex items-center gap-1 text-helper font-medium text-brand-800 hover:underline">
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates
          </Link>
        }
      />
    )
  }
  if (!template.data || !design.data || !receipt.data || !tags.data) return <EditorLoading label="Opening the receipt editor" />

  if (template.data.channel !== 'E_RECEIPT') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState title="This is not an e-receipt template" error={new Error(`The receipt editor is for E_RECEIPT templates. "${template.data.name}" is ${template.data.channel}.`)} />
        <Link to="/templates" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates</Link>
      </div>
    )
  }

  return (
    <ReceiptWorkspace
      key={id}
      templateName={template.data.name}
      status={template.data.status}
      design={design.data}
      receiptLayout={receipt.data}
      tags={tags.data.results}
      assets={(assets.data?.results ?? []).map((asset) => ({ url: asset.url, name: asset.file_name, width: asset.width_px, height: asset.height_px }))}
      backend={backend}
      backTo="/templates"
      showNav
      readOnly={!canEditTemplate(can, template.data.status)}
    />
  )
}
