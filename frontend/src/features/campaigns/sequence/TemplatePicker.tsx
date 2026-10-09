/**
 * Choose from Template Gallery: the workspace's templates of the drip's channel, then the presets (the Templates
 * library's own tiles and preview). A click opens the read-only preview first; its button is what picks. Nothing is
 * created until then: a template is copied in by the API, a frontend preset is first made a Draft template
 * (templateFromPreset), a server starter is passed by its key when the caller can take one.
 */
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { InputGroup } from '@/components/InputGroup'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { usePresets } from '@/features/templates/presetSource'
import { ItemTile } from '@/features/templates/preview/ItemTile'
import { TemplatePreviewModal } from '@/features/templates/preview/TemplatePreviewModal'
import type { PreviewItem } from '@/features/templates/preview/usePreviewContent'
import { templateFromPreset } from '@/features/templates/useCreateFromPreset'
import { api } from '@/lib/api'
import type { Page, Template } from '@/lib/types'

/** what was picked: a template to copy in, or a server starter's key */
/** fromPreset: the template is a Draft made from a frontend preset just now, so the API may remove it once copied (consume_source) */
export type GalleryPick = { template: string; starter?: undefined; fromPreset?: boolean } | { starter: string; template?: undefined; fromPreset?: undefined }

interface TemplatePickerProps {
  channel: string
  /** the drip being set up: its own message copies are not offered */
  campaignId: string
  /** "Add Message" or "Use This Template" */
  onPick: (pick: GalleryPick) => Promise<void>
  /** the caller can start from a server starter's key (POST /steps/); otherwise every preset becomes a template first */
  takesStarter?: boolean
  onClose: () => void
}

const CARD = 'group flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left transition-colors duration-fast ease-standard hover:border-link'

export function TemplatePicker({ channel, campaignId, onPick, takesStarter = false, onClose }: TemplatePickerProps) {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [previewing, setPreviewing] = useState<PreviewItem | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const templates = useQuery({
    queryKey: ['templates', 'options'],
    queryFn: ({ signal }) => api.get<Page<Template>>('/templates/', { page_size: 200 }, signal),
  })
  const presets = usePresets([channel])
  const needle = search.trim().toLowerCase()
  const matches = (text: string) => needle === '' || text.toLowerCase().includes(needle)
  const own = (templates.data?.results ?? [])
    .filter((item) => item.channel === channel && item.status !== 'ARCHIVED' && item.used_in_drip?.campaign_id !== campaignId && matches(item.name))
  const offered = presets.presets.filter((preset) => matches(`${preset.name} ${preset.category}`))

  async function pick(item: PreviewItem) {
    setFailed(null)
    try {
      if (item.kind === 'template') await onPick({ template: item.template.id })
      else if (!item.preset.content && takesStarter) await onPick({ starter: item.preset.key })
      else {
        const { template } = await templateFromPreset(item.preset)
        await onPick({ template: template.id, fromPreset: true })
      }
      setPreviewing(null)
    } catch (error) {
      setPreviewing(null)
      setFailed(error instanceof Error ? error.message : 'The template was not added.')
    }
  }

  const tile = (item: PreviewItem, key: string, name: string, tag: string) => (
    <li key={key}>
      <button type="button" className={CARD} onClick={() => setPreviewing(item)} aria-label={`Preview ${name}`}>
        <ItemTile item={item} />
        <span className="flex flex-col gap-1.5 p-3">
          <span className="line-clamp-2 text-sm font-semibold text-ink-900">{name}</span>
          <span className="self-start"><Tag>{tag}</Tag></span>
        </span>
      </button>
    </li>
  )

  return (
    <>
      <Modal title="Choose a Template" subtitle="A copy is attached to this message. The original stays as it is." size="xl" scrollBody onClose={onClose} escapeClosesMenusFirst
        toolbar={
          <InputGroup aria-label="Search templates" placeholder="e.g. Welcome" value={search} onChange={(event) => setSearch(event.target.value)}
            start={<Search size={16} strokeWidth={1.5} aria-hidden />} className="sm:w-72" />
        }>
        {failed && <p role="alert" className="mb-4 text-sm font-medium text-danger-text">{failed}</p>}
        <h3 className="mb-3 text-sm font-semibold text-ink-900">Your Templates</h3>
        {templates.isPending ? (
          <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading templates</p>
        ) : templates.isError ? (
          <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
        ) : own.length === 0 ? (
          <p className="text-sm text-ink-800">{needle ? 'No template matches that search.' : 'No templates of this channel yet. Start from a preset below.'}</p>
        ) : (
          <ul aria-label="Your Templates" className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {own.map((item) => tile({ kind: 'template', template: item }, item.id, item.name, 'Your Template'))}
          </ul>
        )}
        <h3 className="mt-6 mb-3 text-sm font-semibold text-ink-900">Presets</h3>
        {presets.isPending ? (
          <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading presets</p>
        ) : offered.length === 0 ? (
          <p className="text-sm text-ink-800">{needle ? 'No preset matches that search.' : 'No presets for this channel.'}</p>
        ) : (
          <ul aria-label="Presets" className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {offered.map((preset) => tile({ kind: 'preset', preset }, preset.key, preset.name, preset.category))}
          </ul>
        )}
      </Modal>
      {previewing && (
        <TemplatePreviewModal item={previewing} canEdit={can('template.edit')} onClose={() => setPreviewing(null)}
          action={{ label: previewing.kind === 'preset' ? 'Copy This Template' : 'Use This Template', onClick: () => pick(previewing) }} />
      )}
    </>
  )
}
