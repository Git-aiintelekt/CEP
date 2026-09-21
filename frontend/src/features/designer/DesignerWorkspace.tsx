/**
 * Everything around the canvas: subject line, save with version lock, findings, preview, tag catalogue, history.
 * Talks to a `DesignerBackend`, so the template page passes the API and the dev playground passes an in-memory one.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { ArrowLeft, X } from 'lucide-react'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { Design, DesignFindings, DesignSaveInput, DesignVersion, PersonalizationTag } from '@/lib/types'

import { EmailDesigner, type DesignerAsset, type EmailDesignerHandle } from './EmailDesigner'
import { STARTER_MJML } from './starter'
import { applySampleValues, asToken, extractTags, groupTags, unknownTags } from './tags'

export interface DesignerBackend {
  save: (input: DesignSaveInput) => Promise<Design>
  loadVersion: (version: number) => Promise<Design>
  listVersions: () => Promise<DesignVersion[]>
  uploadAsset: (file: File) => Promise<DesignerAsset>
  activate?: () => Promise<void>
}

interface WorkspaceProps {
  templateName: string
  channel: string
  status: string
  design: Design
  tags: PersonalizationTag[]
  assets: DesignerAsset[]
  backend: DesignerBackend
  backTo: string
  readOnly?: boolean
}

type Panel = 'tags' | 'history' | null
type Notice = { tone: 'ok' | 'warn' | 'error'; title: string; items?: string[] } | null

function findingsNotice(findings: DesignFindings | undefined, version: number): Notice {
  const items: string[] = []
  if (findings?.unknown_tags.length) items.push(`Unknown tags (they would be sent as typed): ${findings.unknown_tags.map(asToken).join(', ')}`)
  if (findings?.missing_subject) items.push('No subject line yet.')
  if (findings?.missing_unsubscribe) items.push('No {{unsubscribe_url}} link: required before a marketing campaign can use this template.')
  if (findings?.may_be_clipped) items.push(`The HTML is ${Math.round((findings.html_bytes ?? 0) / 1024)} KB. Gmail clips messages over 102 KB.`)
  return items.length > 0 ? { tone: 'warn', title: `Saved as version ${version}, with things to fix before sending`, items } : { tone: 'ok', title: `Saved as version ${version}` }
}

const NOTICE_TONE = { ok: 'border-success bg-surface-subtle text-success-text', warn: 'border-warning bg-warning-bg text-warning-text', error: 'border-danger bg-danger-bg text-danger-text' }

export function DesignerWorkspace({ templateName, channel, status, design, tags, assets, backend, backTo, readOnly = false }: WorkspaceProps) {
  const editor = useRef<EmailDesignerHandle>(null)
  const [subject, setSubject] = useState(design.subject_line)
  const [preheader, setPreheader] = useState(design.preheader)
  const [saved, setSaved] = useState({ subject: design.subject_line, preheader: design.preheader, version: design.latest_version, shown: design.version_number })
  const [canvasDirty, setCanvasDirty] = useState(false)
  const [restored, setRestored] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(status)
  const [busy, setBusy] = useState<'save' | 'activate' | 'load' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [versions, setVersions] = useState<DesignVersion[] | null>(null)
  const [preview, setPreview] = useState<{ html: string; errors: string[] } | null>(null)
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [copied, setCopied] = useState<string | null>(null)

  const dirty = canvasDirty || restored || subject !== saved.subject || preheader !== saved.preheader
  const headerUnknown = useMemo(() => unknownTags(extractTags(subject, preheader), tags), [subject, preheader, tags])
  const tagGroups = useMemo(() => groupTags(tags, channel), [tags, channel])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    if (!editor.current) return
    setBusy('save')
    setNotice(null)
    try {
      const snapshot = editor.current.getDesign()
      const result = await backend.save({
        editor_state: snapshot.editor_state as Record<string, unknown>,
        mjml_source: snapshot.mjml_source,
        subject_line: subject,
        preheader,
        base_version: saved.version,
      })
      editor.current.markSaved()
      setRestored(false)
      setSaved({ subject, preheader, version: result.version_number, shown: result.version_number })
      setVersions(null)
      setNotice(findingsNotice(result.findings, result.version_number))
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNotice({ tone: 'error', title: error.message, items: ['Open History to load the newest version. Your unsaved changes stay in this window until you do.'] })
      } else if (error instanceof ApiError && error.status === 400) {
        setNotice({ tone: 'error', title: 'This design cannot be saved yet', items: Object.values(error.fieldErrors) })
      } else {
        setNotice({ tone: 'error', title: error instanceof Error ? error.message : 'Could not save the design' })
      }
    } finally {
      setBusy(null)
    }
  }

  async function activate() {
    if (!backend.activate) return
    setBusy('activate')
    setNotice(null)
    try {
      await backend.activate()
      setCurrentStatus('ACTIVE')
      setNotice({ tone: 'ok', title: 'Template activated. Campaigns can now be published with it.' })
    } catch (error) {
      const items = error instanceof ApiError ? Object.values(error.fieldErrors) : []
      setNotice({ tone: 'error', title: items.length ? 'Not ready to activate' : error instanceof Error ? error.message : 'Could not activate', items })
    } finally {
      setBusy(null)
    }
  }

  async function openHistory() {
    setPanel(panel === 'history' ? null : 'history')
    if (versions === null) {
      try {
        setVersions(await backend.listVersions())
      } catch {
        setVersions([])
      }
    }
  }

  async function loadVersion(number: number) {
    if (dirty && !window.confirm('Load this version? Your unsaved changes in the editor will be replaced.')) return
    setBusy('load')
    try {
      const older = await backend.loadVersion(number)
      editor.current?.load(older)
      setSubject(older.subject_line)
      setPreheader(older.preheader)
      const isLatest = number === older.latest_version
      setSaved((current) => ({ ...current, version: older.latest_version, shown: number, ...(isLatest ? { subject: older.subject_line, preheader: older.preheader } : {}) }))
      setRestored(!isLatest)
      if (isLatest) editor.current?.markSaved()
      setNotice(isLatest ? null : { tone: 'warn', title: `Version ${number} is loaded. Save to make it the newest version (${older.latest_version + 1}).` })
    } catch (error) {
      setNotice({ tone: 'error', title: error instanceof Error ? error.message : 'Could not load that version' })
    } finally {
      setBusy(null)
    }
  }

  async function applyTag(key: string) {
    const token = asToken(key)
    if (!editor.current?.insertText(token)) {
      try {
        await navigator.clipboard.writeText(token)
      } catch {
        /* clipboard blocked: the token is still shown in the list to type by hand */
      }
    }
    setCopied(key)
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500)
  }

  const input = 'h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-sm text-ink-900'

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={backTo} className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline" onClick={(event) => {
            if (dirty && !window.confirm('Leave without saving your changes?')) event.preventDefault()
          }}>
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates
          </Link>
          <h1 className="min-w-0 truncate text-base font-semibold text-ink-900">{templateName}</h1>
          <StatusBadge status={currentStatus} />
          <span className="text-xs text-ink-500">
            {saved.shown === 0 ? 'Not saved yet' : `Version ${saved.shown}${saved.shown !== saved.version ? ` of ${saved.version}` : ''}`}
            {dirty ? ' · unsaved changes' : ''}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className={buttonSecondary} aria-pressed={panel === 'tags'} onClick={() => setPanel(panel === 'tags' ? null : 'tags')}>
              Tags
            </button>
            <button type="button" className={buttonSecondary} aria-pressed={panel === 'history'} onClick={() => void openHistory()}>
              History
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setPreview(editor.current?.compileHtml() ?? null)}>
              Preview
            </button>
            {backend.activate && currentStatus === 'DRAFT' && !readOnly && (
              <button type="button" className={buttonSecondary} disabled={dirty || saved.version === 0 || busy !== null} title={dirty ? 'Save first' : undefined} onClick={() => void activate()}>
                {busy === 'activate' && <Spinner className="h-4 w-4" />} Activate
              </button>
            )}
            {!readOnly && (
              <button type="button" className={buttonPrimary} disabled={!dirty || busy !== null} onClick={() => void save()}>
                {busy === 'save' && <Spinner className="h-4 w-4 border-brand-800 border-t-white" />} Save
              </button>
            )}
          </div>
        </div>
        <div className="mt-2.5 grid gap-2 lg:grid-cols-2">
          <label className="flex items-center gap-2 text-xs font-medium text-ink-500">
            <span className="w-20 shrink-0">Subject</span>
            <input className={input} value={subject} maxLength={300} disabled={readOnly} onChange={(event) => setSubject(event.target.value)} placeholder="{{first_name}}, your offer is here" />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-ink-500">
            <span className="w-20 shrink-0">Preheader</span>
            <input className={input} value={preheader} maxLength={300} disabled={readOnly} onChange={(event) => setPreheader(event.target.value)} placeholder="Preview text shown after the subject in the inbox" />
          </label>
        </div>
        {headerUnknown.length > 0 && <p className="mt-1.5 text-xs font-medium text-warning-text">Unknown tag in subject or preheader: {headerUnknown.map(asToken).join(', ')}</p>}
        {notice && (
          <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-2.5 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${NOTICE_TONE[notice.tone]}`}>
            <div>
              <p className="font-medium">{notice.title}</p>
              {notice.items && notice.items.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {notice.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" aria-label="Dismiss" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-line-subtle" onClick={() => setNotice(null)}>
              <X size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <EmailDesigner
            ref={editor}
            initialState={design.editor_state}
            initialMjml={design.mjml_source ?? STARTER_MJML}
            tags={tags}
            channel={channel}
            assets={assets}
            onUploadAsset={backend.uploadAsset}
            onDirtyChange={setCanvasDirty}
            onError={(message) => setNotice({ tone: 'error', title: message })}
            readOnly={readOnly}
          />
        </div>

        {panel === 'tags' && (
          <aside aria-label="Personalization tags" className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink-900">Personalization tags</h2>
            <p className="mt-1 text-xs text-ink-500">While editing text, click a tag to insert it at the cursor. Otherwise it is copied to the clipboard.</p>
            {tagGroups.map((group) => (
              <section key={group.kind} className="mt-4">
                <h3 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{group.label}</h3>
                <ul className="mt-1.5 space-y-1">
                  {group.tags.map((tag) => (
                    <li key={tag.id}>
                      <button type="button" onClick={() => void applyTag(tag.tag_key)} className="w-full rounded-md border border-line px-2.5 py-1.5 text-left hover:border-brand-600 hover:bg-surface-subtle">
                        <span className="flex items-center justify-between gap-2 text-sm font-medium text-ink-900">
                          {tag.label}
                          {copied === tag.tag_key && <span className="text-xs font-normal text-success-text">Done</span>}
                        </span>
                        <span className="block cep-num text-xs text-brand-800">{asToken(tag.tag_key)}</span>
                        {tag.sample_value && <span className="block truncate text-xs text-ink-500">e.g. {tag.sample_value}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {tagGroups.length === 0 && <p className="mt-4 text-sm text-ink-500">No tags are defined for this channel yet.</p>}
          </aside>
        )}

        {panel === 'history' && (
          <aside aria-label="Version history" className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink-900">Version history</h2>
            <p className="mt-1 text-xs text-ink-500">Every save is a new version. Loading an old one never deletes anything: saving it creates the next version.</p>
            {versions === null ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading</p>
            ) : versions.length === 0 ? (
              <p className="mt-4 text-sm text-ink-500">Nothing saved yet.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {versions.map((version) => (
                  <li key={version.version_number} className={`rounded-md border px-2.5 py-2 ${version.version_number === saved.shown ? 'border-brand-600 bg-brand-100' : 'border-line'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-900">Version {version.version_number}</span>
                      <button type="button" disabled={busy !== null || version.version_number === saved.shown} onClick={() => void loadVersion(version.version_number)} className="text-xs font-medium text-brand-800 hover:underline disabled:text-ink-500 disabled:no-underline">
                        {version.version_number === saved.shown ? 'Open' : 'Load'}
                      </button>
                    </div>
                    <p className="text-xs text-ink-500">{formatDateTime(version.saved_at)}{version.saved_by ? ` · ${version.saved_by}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>

      {preview && (
        <div role="dialog" aria-modal="true" aria-label="Email preview" className="fixed inset-0 z-50 flex flex-col bg-scrim p-4 md:p-8">
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-lg bg-surface">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">{applySampleValuesText(subject, tags) || 'No subject line'}</p>
                <p className="truncate text-xs text-ink-500">{applySampleValuesText(preheader, tags) || 'No preheader'}</p>
              </div>
              <div className="flex rounded-lg border border-line p-0.5 text-sm">
                {(['desktop', 'mobile'] as const).map((size) => (
                  <button key={size} type="button" aria-pressed={previewWidth === size} onClick={() => setPreviewWidth(size)} className={`rounded-md px-3 py-1 font-medium capitalize ${previewWidth === size ? 'bg-brand-600 text-white' : 'text-ink-700'}`}>
                    {size}
                  </button>
                ))}
              </div>
              <button type="button" className={buttonSecondary} onClick={() => setPreview(null)}>Close</button>
            </div>
            {preview.errors.length > 0 && (
              <ul className="border-b border-warning bg-warning-bg px-5 py-2 text-xs text-warning-text">
                {preview.errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}
              </ul>
            )}
            <div className="min-h-0 flex-1 overflow-auto bg-line-subtle p-4">
              {/* sandbox with no allowances: no scripts, no forms, no navigation, a unique origin */}
              <iframe title="Email preview with sample values" sandbox="" srcDoc={applySampleValues(preview.html, tags)} className="mx-auto block h-full min-h-[480px] border border-line bg-surface" style={{ width: previewWidth === 'desktop' ? 680 : 375, maxWidth: '100%' }} />
            </div>
            <p className="border-t border-line px-4 py-2 text-xs text-ink-500">Tags are filled with their sample values. The HTML that is sent is rendered by the server when you save.</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Sample values in a plain-text context (subject line): undo the HTML escaping applySampleValues adds. */
function applySampleValuesText(text: string, tags: PersonalizationTag[]): string {
  return applySampleValues(text, tags).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}
