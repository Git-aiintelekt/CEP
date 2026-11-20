/**
 * /templates/receipt-layouts/:id : one layout of Templates → Receipt Layouts, in the Receipt Layout pane the E-Receipt
 * editor uses. A save reaches every template that picks the layout, so the templates are named before it is saved.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { NavBar } from '@/components/NavBar'
import { Notice } from '@/components/Notice'
import { TextInput } from '@/components/Form'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { EditorFailure, EditorLoading } from '@/apps/cep/features/designer/EditorStates'
import { EditorFrame } from '@/apps/cep/features/designer/EditorFrame'
import { FooterBar } from '@/apps/cep/features/designer/FooterBar'
import { ConflictStrip, ReadOnlyStrip } from '@/apps/cep/features/designer/NoticeStrips'
import { saveErrorDetail } from '@/apps/cep/features/designer/saveErrors'
import { useLeaveGuard } from '@/apps/cep/features/designer/useLeaveGuard'
import { ReceiptLayoutPane, type ReceiptLayoutConfig } from '@/apps/cep/features/receipt/ReceiptLayoutPane'
import { customHtmlChecks } from '@/apps/cep/features/receipt/customHtmlChecks'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { ApiError, api } from '@/lib/api'
import { formatUtcClock } from '@/lib/format'
import type { Page, PersonalizationTag, ReceiptLibraryLayout } from '@/lib/types'

const LIBRARY = '/templates?tab=receipt-layouts'

const configOf = (layout: ReceiptLibraryLayout): ReceiptLayoutConfig => ({
  layout_preset: layout.layout_preset, sections: layout.sections, custom_html: layout.custom_html, custom_css: layout.custom_css,
  item_row: layout.item_row, register: layout.register,
})

export default function ReceiptLayoutEditorPage() {
  const { id = '' } = useParams()
  // gcTime 0: always open on what is stored now
  const layout = useQuery({ queryKey: ['receipt-layouts', 'detail', id], queryFn: ({ signal }) => api.get<ReceiptLibraryLayout>(`/receipt-layouts/${id}/`, undefined, signal), gcTime: 0, staleTime: Infinity })
  const tags = useQuery({ queryKey: ['personalization-tags', 'all'], queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal) })

  if (layout.isError) {
    return (
      <EditorFailure
        title="Couldn’t load this receipt layout"
        detail={layout.error instanceof Error ? layout.error.message : 'The server did not answer.'}
        onRetry={() => void layout.refetch()}
        footer={<Link to={LIBRARY} className="mt-2 inline-flex items-center gap-1 text-helper font-medium text-brand-800 hover:underline"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Receipt Layouts</Link>}
      />
    )
  }
  if (!layout.data) return <EditorLoading label="Opening the receipt layout" />
  return <LayoutEditor key={`${id}-${layout.data.version_number}`} initial={layout.data} tags={tags.data?.results ?? []} />
}

function LayoutEditor({ initial, tags }: { initial: ReceiptLibraryLayout; tags: PersonalizationTag[] }) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const toast = useToast()
  const backTo = (location.state as { backTo?: string } | null)?.backTo ?? LIBRARY
  const readOnly = !can('template.edit') || initial.archived

  const [name, setName] = useState(initial.name)
  const [config, setConfig] = useState<ReceiptLayoutConfig>(() => configOf(initial))
  const [saved, setSaved] = useState({ name: initial.name, config: configOf(initial), version: initial.version_number, at: initial.updated_at })
  const [templates, setTemplates] = useState(initial.templates)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const dirty = name !== saved.name || JSON.stringify(config) !== JSON.stringify(saved.config)
  const guard = useLeaveGuard(dirty, () => navigate(backTo))
  const failing = config.layout_preset === 'CUSTOM_HTML' ? customHtmlChecks({ custom_html: config.custom_html, custom_css: config.custom_css, item_row: config.item_row ?? null }).filter((check) => !check.ok && !check.warning).length : 0

  async function save() {
    setBusy(true)
    try {
      const result = await api.put<ReceiptLibraryLayout>(`/receipt-layouts/${initial.id}/`, { name, ...config, base_version: saved.version })
      setSaved({ name: result.name, config, version: result.version_number, at: result.updated_at })
      setName(result.name)
      setTemplates(result.templates)
      setConflict(false)
      void queryClient.invalidateQueries({ queryKey: ['receipt-layouts'] })
      void queryClient.invalidateQueries({ queryKey: ['templates'], refetchType: 'none' })
      toast.success('Layout saved', result.used_by ? `Every template that uses it now sends this: ${result.used_by}.` : `Version ${result.version_number}.`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (/someone else/.test(error.message)) setConflict(true)
        toast.error('The layout was not saved', error.message)
      } else if (error instanceof ApiError && error.status === 400) toast.error('The layout cannot be saved yet', saveErrorDetail(error.fieldErrors))
      else toast.failure(error, 'The layout was not saved')
    } finally {
      setBusy(false)
    }
  }

  const clock = formatUtcClock(saved.at)
  const usedBy = templates.length
  const saveNote = `Version ${saved.version}${clock ? ` · Saved ${clock}` : ''}${dirty ? ' · unsaved changes' : ''}`

  return (
    <>
      {guard.dialog}
      <EditorFrame
        name={saved.name}
        status=""
        help={<PageHelp chapter="templates" />}
        nav={<NavBar onNavigate={(to, event) => { event.preventDefault(); guard.requestLeave(() => navigate(to)) }} />}
        saveNote={saveNote}
        saveNoteTone={dirty && !readOnly ? 'warning' : 'default'}
        backTo={backTo}
        backText={backTo === LIBRARY ? 'Receipt Layouts' : 'Back to Template'}
        onBack={(event) => { event.preventDefault(); guard.requestLeave(() => navigate(backTo)) }}
        tabs={[{ id: 'layout', label: 'Receipt Layout', Icon: ReceiptText }]}
        tab="layout"
        onTabChange={() => {}}
        notice={
          <>
            {readOnly && <ReadOnlyStrip />}
            {conflict && <ConflictStrip note="Someone else saved this layout. Load theirs to carry on; your changes here are not kept." busy={busy} onLoadLatest={() => void queryClient.invalidateQueries({ queryKey: ['receipt-layouts', 'detail', initial.id] })} />}
            {usedBy > 0 && !readOnly && (
              <Notice tone="info" title={`Used by ${usedBy} ${usedBy === 1 ? 'template' : 'templates'}`}>
                Saving changes the receipt of {templates.slice(0, 3).map((template) => template.name).join(', ')}{usedBy > 3 ? ` and ${usedBy - 3} more` : ''}. To change one receipt only, open its template and choose Make a Copy for This Template.
              </Notice>
            )}
          </>
        }
        footer={
          <FooterBar
            note={failing ? `${failing} ${failing === 1 ? 'check' : 'checks'} to fix before saving.` : usedBy ? `Used by ${usedBy} ${usedBy === 1 ? 'template' : 'templates'}.` : 'No template uses this layout yet.'}
            noteTone={failing ? 'danger' : 'default'}
            save={readOnly ? undefined : { onClick: () => void save(), busy }}
          />
        }
        panes={[{
          id: 'layout',
          content: (
            <ReceiptLayoutPane
              layout={config}
              onChange={setConfig}
              readOnly={readOnly}
              tags={tags}
              top={
                <div className="flex flex-col gap-1.5 border-b border-line px-3 pt-3 pb-3">
                  <label htmlFor="receipt-layout-name" className="text-xs font-semibold text-ink-800">Name</label>
                  <TextInput id="receipt-layout-name" controlSize="sm" value={name} maxLength={120} disabled={readOnly} onChange={(event) => setName(event.target.value)} />
                </div>
              }
            />
          ),
        }]}
      />
    </>
  )
}
