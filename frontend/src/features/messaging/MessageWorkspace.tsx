/**
 * SMS / MMS editor: text with personalization tags, live segment maths, phone preview, MMS picture, versioned saves.
 * Talks to a `MessageBackend`, so the template page passes the API and the dev playground an in-memory one.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { ArrowLeft, X } from 'lucide-react'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { buttonClass, iconButtonClass } from '@/components/buttonStyles'
import { asToken, extractTags, groupTags, unknownTags } from '@/features/designer/tags'
import { EmojiPickerButton } from '@/features/emoji/EmojiPickerButton'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { DesignVersion, MediaAsset, Message, MessageSaveInput, PersonalizationTag } from '@/lib/types'

import { BUBBLE, PhoneFrame } from './PhoneFrame'
import { canBePlain, describeCharacter, OPT_OUT_PATTERN, plainPunctuation, renderWithSamples, smsMetrics } from './sms'

export interface MessageBackend {
  save: (input: MessageSaveInput) => Promise<Message>
  loadVersion: (version: number) => Promise<Message>
  listVersions: () => Promise<DesignVersion[]>
  uploadMedia: (file: File) => Promise<MediaAsset>
  activate?: () => Promise<void>
}

interface WorkspaceProps {
  templateName: string
  channel: 'SMS' | 'MMS'
  status: string
  message: Message
  tags: PersonalizationTag[]
  library: MediaAsset[]
  senderName?: string
  backend: MessageBackend
  backTo: string
  readOnly?: boolean
}

type Notice = { tone: 'ok' | 'warn' | 'error'; title: string; items?: string[] } | null
type Media = Message['media_asset']

const MAX_CHARS = 1600
const MMS_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const MMS_WARN_BYTES = 600 * 1024
const MMS_MAX_BYTES = 1024 * 1024
const NOTICE_TONE = { ok: 'border-success bg-surface-subtle text-success-text', warn: 'border-warning bg-warning-bg text-warning-text', error: 'border-danger bg-danger-bg text-danger-text' }

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`
const asMedia = (asset: MediaAsset): NonNullable<Media> => ({
  id: asset.id, url: asset.url, file_name: asset.file_name, mime_type: asset.mime_type, byte_size: asset.byte_size, width_px: asset.width_px, height_px: asset.height_px,
})

export function MessageWorkspace({ templateName, channel, status, message, tags, library, senderName = 'Your brand', backend, backTo, readOnly = false }: WorkspaceProps) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [body, setBody] = useState(message.sms_body)
  const [subject, setSubject] = useState(message.subject_line)
  const [media, setMedia] = useState<Media>(message.media_asset)
  const [saved, setSaved] = useState({ body: message.sms_body, subject: message.subject_line, mediaId: message.media_asset?.id ?? null, version: message.latest_version, shown: message.version_number })
  const [restored, setRestored] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(status)
  const [busy, setBusy] = useState<'save' | 'activate' | 'load' | 'upload' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showHistory, setShowHistory] = useState(false)
  const [versions, setVersions] = useState<DesignVersion[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [assets, setAssets] = useState(library)

  const isMms = channel === 'MMS'
  const dirty = restored || body !== saved.body || subject !== saved.subject || (media?.id ?? null) !== saved.mediaId
  const tagGroups = useMemo(() => groupTags(tags, channel), [tags, channel])
  const used = useMemo(() => extractTags(body), [body])
  const unknown = useMemo(() => unknownTags(used, tags), [used, tags])
  const sample = useMemo(() => renderWithSamples(body, tags), [body, tags])
  const metrics = useMemo(() => smsMetrics(sample), [sample])
  const tooLong = body.trim().length > MAX_CHARS
  const usableImages = assets.filter((asset) => MMS_TYPES.includes(asset.mime_type) && asset.byte_size <= MMS_MAX_BYTES)

  const warnings: string[] = []
  if (metrics.encoding === 'UCS-2') warnings.push(`${metrics.nonGsmCharacters.map(describeCharacter).join(', ')} ${metrics.nonGsmCharacters.length === 1 ? 'is' : 'are'} outside the standard SMS alphabet, so each part holds 70 characters instead of 160.`)
  if (metrics.segments > 3) warnings.push(`${metrics.segments} parts per recipient. Each part is billed as one message.`)
  if (unknown.length > 0) warnings.push(`Unknown tags (they would be sent as typed): ${unknown.map(asToken).join(', ')}`)
  if (body.trim() && !OPT_OUT_PATTERN.test(body)) warnings.push('No opt-out wording. Marketing messages must say how to stop them, for example: Reply STOP to opt out.')
  if (isMms && !media) warnings.push('No picture yet. An MMS template needs one before it can be activated.')
  if (media && media.byte_size > MMS_WARN_BYTES) warnings.push(`The picture is ${kb(media.byte_size)}. Some carriers shrink or drop attachments over 600 KB.`)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function insertAtCaret(text: string) {
    const element = textarea.current
    const start = element?.selectionStart ?? body.length
    const end = element?.selectionEnd ?? body.length
    setBody(body.slice(0, start) + text + body.slice(end))
    setFieldErrors((current) => ({ ...current, sms_body: '' }))
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  async function save() {
    setBusy('save')
    setNotice(null)
    setFieldErrors({})
    try {
      const result = await backend.save({ sms_body: body, subject_line: isMms ? subject : '', media_asset: media?.id ?? null, base_version: saved.version })
      setBody(result.sms_body)
      setRestored(false)
      setSaved({ body: result.sms_body, subject: result.subject_line, mediaId: result.media_asset?.id ?? null, version: result.version_number, shown: result.version_number })
      setVersions(null)
      const parts = result.findings.segments
      setNotice({ tone: 'ok', title: `Saved as version ${result.version_number}: ${parts} part${parts === 1 ? '' : 's'} per recipient${result.findings.estimated ? ' (estimated with sample values)' : ''}` })
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setFieldErrors(error.fieldErrors)
        setNotice({ tone: 'error', title: 'This message cannot be saved yet', items: Object.values(error.fieldErrors) })
      } else if (error instanceof ApiError && error.status === 409) {
        setNotice({ tone: 'error', title: error.message, items: ['Open History to load the newest version. Your text stays here until you do.'] })
      } else {
        setNotice({ tone: 'error', title: error instanceof Error ? error.message : 'Could not save the message' })
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

  async function toggleHistory() {
    setShowHistory(!showHistory)
    if (versions === null) {
      try {
        setVersions(await backend.listVersions())
      } catch {
        setVersions([])
      }
    }
  }

  async function loadVersion(number: number) {
    if (dirty && !window.confirm('Load this version? Your unsaved text will be replaced.')) return
    setBusy('load')
    try {
      const older = await backend.loadVersion(number)
      const isLatest = number === older.latest_version
      setBody(older.sms_body)
      setSubject(older.subject_line)
      setMedia(older.media_asset)
      setSaved((current) => ({ ...current, version: older.latest_version, shown: number, ...(isLatest ? { body: older.sms_body, subject: older.subject_line, mediaId: older.media_asset?.id ?? null } : {}) }))
      setRestored(!isLatest)
      setNotice(isLatest ? null : { tone: 'warn', title: `Version ${number} is loaded. Save to make it the newest version (${older.latest_version + 1}).` })
    } catch (error) {
      setNotice({ tone: 'error', title: error instanceof Error ? error.message : 'Could not load that version' })
    } finally {
      setBusy(null)
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return
    if (!MMS_TYPES.includes(file.type)) return setNotice({ tone: 'error', title: 'MMS pictures must be JPEG, PNG or GIF.' })
    if (file.size > MMS_MAX_BYTES) return setNotice({ tone: 'error', title: `That picture is ${kb(file.size)}. MMS pictures can be at most 1 MB.` })
    setBusy('upload')
    setNotice(null)
    try {
      const asset = await backend.uploadMedia(file)
      setAssets((current) => (current.some((item) => item.id === asset.id) ? current : [asset, ...current]))
      setMedia(asMedia(asset))
      setPickerOpen(false)
    } catch (error) {
      const detail = error instanceof ApiError ? Object.values(error.fieldErrors)[0] : undefined
      setNotice({ tone: 'error', title: detail ?? (error instanceof Error ? error.message : 'Upload failed') })
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const counterTone = tooLong ? 'text-danger-text' : metrics.segments > 3 ? 'text-warning-text' : 'text-ink-700'

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={backTo} className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline" onClick={(event) => {
            if (dirty && !window.confirm('Leave without saving your changes?')) event.preventDefault()
          }}>
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates
          </Link>
          <h1 className="min-w-0 truncate text-base font-semibold text-ink-900">{templateName}</h1>
          <span className="rounded-md bg-line-subtle px-1.5 py-0.5 text-xs font-medium text-ink-700">{channel}</span>
          <StatusBadge status={currentStatus} />
          <span className="text-xs text-ink-500">
            {saved.shown === 0 ? 'Not saved yet' : `Version ${saved.shown}${saved.shown !== saved.version ? ` of ${saved.version}` : ''}`}
            {dirty ? ' · unsaved changes' : ''}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className={buttonSecondary} aria-pressed={showHistory} onClick={() => void toggleHistory()}>History</button>
            {backend.activate && currentStatus === 'DRAFT' && !readOnly && (
              <button type="button" className={buttonSecondary} disabled={dirty || saved.version === 0 || busy !== null} title={dirty ? 'Save first' : undefined} onClick={() => void activate()}>
                {busy === 'activate' && <Spinner size="sm" />} Activate
              </button>
            )}
            {!readOnly && (
              <button type="button" className={buttonPrimary} disabled={!dirty || tooLong || !body.trim() || busy !== null} onClick={() => void save()}>
                {busy === 'save' && <Spinner size="sm" tone="onBrand" />} Save
              </button>
            )}
          </div>
        </div>
        {notice && (
          <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-2.5 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${NOTICE_TONE[notice.tone]}`}>
            <div>
              <p className="font-medium">{notice.title}</p>
              {notice.items && notice.items.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{notice.items.map((item) => <li key={item}>{item}</li>)}</ul>
              )}
            </div>
            <button type="button" aria-label="Dismiss" className={`${iconButtonClass()} shrink-0`} onClick={() => setNotice(null)}><X size={16} strokeWidth={1.5} aria-hidden /></button>
          </div>
        )}
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-5">
          {isMms && (
            <div className="rounded-lg border border-line bg-surface p-5">
              <label htmlFor="mms-subject" className="block text-sm font-medium text-ink-700">Subject <span className="font-normal text-ink-500">(optional, shown by some phones)</span></label>
              <input id="mms-subject" value={subject} maxLength={80} disabled={readOnly} onChange={(event) => setSubject(event.target.value)}
                className={`mt-1 h-10 w-full rounded-sm border bg-surface px-3 text-sm ${fieldErrors.subject_line ? 'border-danger' : 'border-line'}`} />
            </div>
          )}

          <div className="rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="sms-body" className="text-sm font-medium text-ink-700">Message</label>
              {!readOnly && (
                <span className="flex items-center gap-2">
                  {tagGroups.length > 0 && (
                    <select aria-label="Insert Personalization Tag" value="" onChange={(event) => event.target.value && insertAtCaret(event.target.value)}
                      className="h-8 rounded-control-md border border-line bg-surface px-2 text-sm text-ink-900">
                      <option value="">{'{{ }}'} Insert Tag</option>
                      {tagGroups.map((group) => (
                        <optgroup key={group.kind} label={group.label}>
                          {group.tags.map((tag) => <option key={tag.id} value={asToken(tag.tag_key)}>{tag.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  )}
                  <EmojiPickerButton onPick={insertAtCaret} />
                </span>
              )}
            </div>
            <textarea id="sms-body" ref={textarea} rows={7} value={body} disabled={readOnly} spellCheck
              aria-invalid={Boolean(fieldErrors.sms_body) || tooLong || undefined} aria-describedby="sms-counter"
              onChange={(event) => { setBody(event.target.value); setFieldErrors((current) => ({ ...current, sms_body: '' })) }}
              placeholder="Northwind: Hi {{first_name}}, ... Reply STOP to opt out."
              className={`mt-2 w-full rounded-sm border bg-surface px-3 py-2.5 text-sm leading-6 text-ink-900 ${fieldErrors.sms_body || tooLong ? 'border-danger' : 'border-line'}`} />
            <div id="sms-counter" aria-live="polite" className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${counterTone}`}>
              <span className="font-medium tabular-nums">{metrics.units} characters</span>
              <span className="tabular-nums">{metrics.segments} part{metrics.segments === 1 ? '' : 's'} · {metrics.perSegment} per part</span>
              <span className="tabular-nums text-ink-500">{metrics.remaining} left in this part</span>
              <span className="rounded-md bg-line-subtle px-1.5 py-0.5 text-xs font-medium text-ink-700">{metrics.encoding}</span>
              {used.length > 0 && <span className="text-xs text-ink-500">estimated with sample values; real lengths vary per recipient</span>}
            </div>
            {tooLong && <p className="mt-1 text-xs font-medium text-danger-text">A message can be at most {MAX_CHARS} characters (10 parts).</p>}
            {fieldErrors.sms_body && <p className="mt-1 text-xs font-medium text-danger-text">{fieldErrors.sms_body}</p>}
            {metrics.encoding === 'UCS-2' && canBePlain(metrics.nonGsmCharacters) && !readOnly && (
              <div className="mt-3 flex flex-col items-start gap-0.5">
                <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setBody(plainPunctuation(body))}>
                  Use Plain Punctuation
                </button>
                <p className="text-helper text-ink-500">Swaps curly quotes, long dashes and ellipses for plain ones, so the text stays in the standard SMS alphabet.</p>
              </div>
            )}
          </div>

          {isMms && (
            <div className="rounded-lg border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-ink-700">Picture</h2>
                {!readOnly && (
                  <div className="flex gap-2">
                    <button type="button" className={buttonSecondary} onClick={() => setPickerOpen(!pickerOpen)} aria-expanded={pickerOpen}>Choose from Library</button>
                    <button type="button" className={buttonSecondary} disabled={busy === 'upload'} onClick={() => fileInput.current?.click()}>
                      {busy === 'upload' && <Spinner size="sm" />} Upload
                    </button>
                    <input ref={fileInput} type="file" accept={MMS_TYPES.join(',')} className="sr-only" aria-label="Upload a Picture" onChange={(event) => void upload(event.target.files?.[0])} />
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-500">JPEG, PNG or GIF, up to 1 MB. Under 600 KB is delivered reliably by every carrier.</p>
              {fieldErrors.media_asset && <p className="mt-2 text-xs font-medium text-danger-text">{fieldErrors.media_asset}</p>}
              {media ? (
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-line p-2.5">
                  <img src={media.url} alt="" className="h-16 w-16 rounded-md object-cover" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium text-ink-900">{media.file_name}</p>
                    <p className="text-xs text-ink-500">{kb(media.byte_size)}{media.width_px ? ` · ${media.width_px} × ${media.height_px}` : ''}</p>
                  </div>
                  {!readOnly && <button type="button" className={buttonClass({ variant: 'danger', size: 'sm' })} onClick={() => setMedia(null)}>Remove</button>}
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-ink-300 px-4 py-6 text-center text-sm text-ink-500">No picture attached.</p>
              )}
              {pickerOpen && (
                <div className="mt-3">
                  {usableImages.length === 0 ? (
                    <p className="text-sm text-ink-500">No suitable pictures in the library yet. Upload one.</p>
                  ) : (
                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {usableImages.map((asset) => (
                        <li key={asset.id}>
                          <button type="button" aria-label={`Use ${asset.file_name}`} aria-pressed={media?.id === asset.id}
                            onClick={() => { setMedia(asMedia(asset)); setPickerOpen(false) }}
                            className={`block w-full overflow-hidden rounded-lg border-2 ${media?.id === asset.id ? 'border-brand-600' : 'border-transparent hover:border-brand-600'}`}>
                            <img src={asset.url} alt="" className="aspect-square w-full object-cover" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-lg border border-warning bg-warning-bg px-5 py-4 text-sm text-warning-text">
              <p className="font-medium">Before Sending</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{warnings.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          {showHistory && (
            <div className="rounded-lg border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold text-ink-900">Version History</h2>
              <p className="mt-1 text-xs text-ink-500">Every save is a new version. Loading an old one never deletes anything: saving it creates the next version.</p>
              {versions === null ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
              ) : versions.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">Nothing saved yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {versions.map((version) => (
                    <li key={version.version_number} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span><span className="font-medium text-ink-900">Version {version.version_number}</span>
                        <span className="ml-2 text-xs text-ink-500">{formatDateTime(version.saved_at)}{version.saved_by ? ` · ${version.saved_by}` : ''}</span></span>
                      <button type="button" disabled={busy !== null || version.version_number === saved.shown} onClick={() => void loadVersion(version.version_number)}
                        className={buttonClass({ variant: 'link', size: 'sm' })}>
                        {version.version_number === saved.shown ? 'Open' : 'Load'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <aside aria-label="Preview" className="lg:sticky lg:top-6 lg:self-start">
          <PhoneFrame sender={senderName}>
            {isMms && media && <img src={media.url} alt="Attached picture" className="max-h-56 w-auto max-w-[85%] rounded-lg rounded-bl-md object-cover" />}
            {isMms && subject.trim() && <p className="max-w-[85%] text-xs font-semibold text-ink-700">{subject}</p>}
            {sample.trim() ? (
              <p data-testid="sms-preview" className={BUBBLE}>{sample}</p>
            ) : (
              <p className="px-2 pt-10 text-center text-xs text-ink-500">Your message appears here as one recipient would see it.</p>
            )}
          </PhoneFrame>
          <p className="mx-auto mt-2 max-w-[320px] text-center text-xs text-ink-500">Tags show their sample values.</p>
        </aside>
      </div>
    </div>
  )
}
