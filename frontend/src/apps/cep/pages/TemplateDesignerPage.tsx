/**
 * /templates/:id/design : loads the template, its latest design, the tag catalogue and the image library.
 * ?drip={campaign}&step={message}: a drip message's template, opened from the Sequence step (drip mode, sequence/dripEditor).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'

import { ErrorState } from '@/components/States'
import { apiDeliverability } from '@/apps/cep/features/deliverability/backend'
import { DesignerWorkspace, type DesignerBackend } from '@/apps/cep/features/designer/DesignerWorkspace'
import { EditorFailure, EditorLoading } from '@/apps/cep/features/designer/EditorStates'
import { canEditTemplate } from '@/apps/cep/features/designer/editAccess'
import { dripLockNote } from '@/apps/cep/features/templates/lastUsed'
import { DripTestButton } from '@/apps/cep/features/campaigns/sequence/DripTestButton'
import { useDripMode } from '@/apps/cep/features/campaigns/sequence/dripEditor'
import { api } from '@/lib/api'
import type { CodeSample, Design, DesignVersion, MediaAsset, Page, PersonalizationTag, Template } from '@/lib/types'


export default function TemplateDesignerPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const dripMode = useDripMode(id, params.get('drip'), params.get('step'))
  const { can, has } = useAuth()
  const codes = has('dynamic_codes')
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
      // Barcodes and QR codes is switched on per workspace in tenant management
      sampleCode: codes ? (request) => api.post<CodeSample>('/codes/sample/', request) : undefined,
      deliverability: apiDeliverability(id as string),
    }),
    [id, queryClient, codes],
  )

  const failed = [template, design, tags].find((query) => query.isError)
  if (failed) {
    return (
      <EditorFailure
        title="Couldn’t load this template"
        detail={failed.error instanceof Error ? failed.error.message : 'The server did not answer. Your last saved version is safe.'}
        onRetry={() => void failed.refetch()}
        // this screen replaces the whole window, so it keeps the one way out the design's own chrome would have given
        footer={
          <Link to="/templates" className="mt-2 inline-flex items-center gap-1 text-helper font-medium text-brand-800 hover:underline">
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates
          </Link>
        }
      />
    )
  }
  if (!template.data || !design.data || !tags.data || dripMode === undefined) return <EditorLoading label="Opening the designer" />

  if (template.data.channel !== 'EMAIL') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState title="This is not an email template" detail={`The email designer is for EMAIL templates. "${template.data.name}" is ${template.data.channel}.`} />
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
      drip={dripMode ? { ...dripMode, test: (dirty) => <DripTestButton drip={dripMode} dirty={dirty} /> } : undefined}
      showNav
      readOnly={!canEditTemplate(can, template.data.status, Boolean(template.data.used_in_drip?.locked))}
      lockNote={dripLockNote(template.data)}
    />
  )
}
