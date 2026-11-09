/**
 * WhatsApp template editor (option B of docs/mockups/whatsapp.html): Meta's parts (category, language, header, body, footer,
 * buttons) written with the workspace's tags, a sample for each tag for Meta's review, a fallback for when a tag is empty,
 * then Submit to Meta. A template with Meta (in review or approved) is read-only: Meta sends exactly what it reviewed.
 * One made in WhatsApp Manager keeps Meta's words; the editor only says which tag fills each of its numbers.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { ArrowLeft, Lock, Plus, Trash2, X } from 'lucide-react'
import { buttonPrimary, buttonSecondary, Field, Select, TextArea, TextInput } from '@/components/Form'
import { Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { buttonClass, iconButtonClass } from '@/components/buttonStyles'
import { asToken, extractTags, groupTags, unknownTags } from '@/apps/cep/features/designer/tags'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { MediaAsset, PersonalizationTag, WhatsAppButton, WhatsAppTemplate } from '@/lib/types'

import { PageHelp } from '@/apps/cep/help/HelpPanel'

import { WhatsAppPreview } from './WhatsAppPreview'
import { META_STATUS } from './whatsappStatus'

export interface WhatsAppSaveInput {
  engine: string | null
  meta_name: string
  language: string
  category: 'MARKETING' | 'UTILITY'
  header_type: WhatsAppTemplate['header_type']
  header_text: string
  header_media: string | null
  body: string
  footer_text: string
  buttons: WhatsAppButton[]
  samples: Record<string, string>
  fallbacks: Record<string, string>
  variable_tags?: string[]
  base_version: number
}

export interface WhatsAppBackend {
  save: (input: WhatsAppSaveInput) => Promise<WhatsAppTemplate>
  submit: () => Promise<WhatsAppTemplate>
  activate: () => Promise<void>
  /** a draft copy to change and review again; resolves to the copy's id */
  copy: () => Promise<string>
  uploadMedia: (file: File) => Promise<MediaAsset>
}

/** a WhatsApp number of the workspace: the engine it sends through, as its sender shows it */
export interface WhatsAppNumber { engine: string; label: string; name: string }

interface WorkspaceProps {
  templateName: string
  status: string
  template: WhatsAppTemplate
  tags: PersonalizationTag[]
  numbers: WhatsAppNumber[]
  backend: WhatsAppBackend
  backTo: string
  readOnly?: boolean
  lockNote?: string | null
  onCopied?: (id: string) => void
}

type Notice = { tone: 'ok' | 'warn' | 'error'; title: string; items?: string[] } | null

const LANGUAGES: [string, string][] = [
  ['en', 'English'], ['en_US', 'English (US)'], ['en_GB', 'English (UK)'], ['ms', 'Malay'], ['id', 'Indonesian'], ['fil', 'Filipino'], ['th', 'Thai'],
  ['vi', 'Vietnamese'], ['zh_CN', 'Chinese (Simplified)'], ['zh_HK', 'Chinese (Hong Kong)'], ['zh_TW', 'Chinese (Traditional)'], ['ta', 'Tamil'], ['hi', 'Hindi'],
  ['ja', 'Japanese'], ['ko', 'Korean'],
]
const HEADERS: [WhatsAppTemplate['header_type'], string][] = [['NONE', 'None'], ['TEXT', 'Text'], ['IMAGE', 'Picture'], ['DOCUMENT', 'Document']]
const MEDIA_ACCEPT: Partial<Record<WhatsAppTemplate['header_type'], string>> = { IMAGE: 'image/jpeg,image/png', DOCUMENT: 'application/pdf' }
const BUTTON_KINDS: [WhatsAppButton['type'], string][] = [['URL', 'Link'], ['QUICK_REPLY', 'Quick Reply'], ['PHONE_NUMBER', 'Phone Number']]
const MAX_BODY = 1024
const NOTICE_TONE = { ok: 'border-success bg-surface-subtle text-success-text', warn: 'border-warning bg-warning-bg text-warning-text', error: 'border-danger bg-danger-bg text-danger-text' }
const TAG_ANY = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}|\$\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}/g
const NUMBER = /\{\{\s*(\d+)\s*\}\}/g

function Segmented<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: [T, string][]; disabled?: boolean; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-sm border border-line-control">
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} disabled={disabled} onClick={() => onChange(key)}
          className={`h-9 border-r border-line-control px-3 text-sm last:border-r-0 disabled:opacity-60 ${value === key ? 'bg-brand-100 font-medium text-brand-800' : 'bg-surface text-ink-900 hover:bg-surface-hover'}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

/** the body with each tag (or each of Meta's numbers) shown as its sample */
function withSamples(body: string, samples: (key: string) => string): string {
  return body.replace(TAG_ANY, (whole, modern?: string, legacy?: string) => samples((modern ?? legacy?.toLowerCase()) || '') || whole)
}

export function WhatsAppWorkspace({ templateName, status, template, tags, numbers, backend, backTo, readOnly: readOnlyProp = false, lockNote = null, onCopied }: WorkspaceProps) {
  const synced = template.origin === 'META'
  const [current, setCurrent] = useState(template)
  const [currentStatus, setCurrentStatus] = useState(status)
  const locked = readOnlyProp || lockNote !== null
  const wordsFixed = locked || synced || !current.editable
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const initial = useMemo(() => formOf(template, numbers), [template, numbers])
  const [form, setForm] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState<'save' | 'submit' | 'activate' | 'copy' | 'upload' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => { setForm((before) => ({ ...before, [key]: value })); setErrors((before) => ({ ...before, [key]: '' })) }

  const catalogue = useMemo(() => new Map(tags.map((tag) => [tag.tag_key, tag])), [tags])
  const tagGroups = useMemo(() => groupTags(tags.filter((tag) => tag.applies_to_channels.length === 0 || tag.applies_to_channels.some((code) => code === 'SMS' || code === 'WHATSAPP')), 'SMS'), [tags])
  const used = useMemo(() => (synced ? [] : extractTags(form.body)), [form.body, synced])
  const unknown = useMemo(() => unknownTags(used, tags), [used, tags])
  const sampleOf = (key: string) => form.samples[key] || catalogue.get(key)?.sample_value || ''
  const previewBody = synced
    ? current.meta_body.replace(NUMBER, (whole, n: string) => current.variables[Number(n) - 1]?.sample || whole)
    : withSamples(form.body, sampleOf)
  const metaLength = form.body.replace(TAG_ANY, '{{1}}').length
  const trimmed = form.body.trim()
  const edgeTag = !synced && trimmed !== '' && (/^(\{\{[^}]*\}\}|\$\{[^}]*\})/.test(trimmed) || /(\{\{[^}]*\}\}|\$\{[^}]*\})[.!?]?$/.test(trimmed))
  const sideBySide = !synced && /\}\}\s*(\{\{|\$\{)/.test(trimmed)
  const sender = numbers.find((item) => item.engine === form.engine)?.name ?? numbers[0]?.name ?? 'Your business'

  const problems: string[] = []
  if (edgeTag) problems.push('Meta refuses a message that starts or ends with a tag: put words before the first and after the last.')
  if (sideBySide) problems.push('Meta refuses two tags side by side: put a word between them.')
  if (unknown.length) problems.push(`Unknown tags: ${unknown.map(asToken).join(', ')}`)
  if (metaLength > MAX_BODY) problems.push(`At most ${MAX_BODY} characters.`)
  const warnings: string[] = []
  if (!synced && form.category === 'MARKETING' && trimmed && !/\bstop\b/i.test(`${form.body} ${form.footer} ${form.buttons.map((button) => button.text).join(' ')}`))
    warnings.push('No way to stop marketing messages. Add “Reply STOP to opt out” to the footer, or a Stop Offers quick reply.')
  if (current.findings.too_many_tags && !dirty) warnings.push('Meta often refuses a short message with many tags: add words around them.')

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function insertAtCaret(text: string) {
    const element = textarea.current
    const start = element?.selectionStart ?? form.body.length
    const end = element?.selectionEnd ?? form.body.length
    set('body', form.body.slice(0, start) + text + form.body.slice(end))
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  function refused(error: unknown, title: string) {
    if (error instanceof ApiError && error.status === 400) {
      setErrors(error.fieldErrors)
      setNotice({ tone: 'error', title, items: Object.values(error.fieldErrors) })
    } else {
      setNotice({ tone: 'error', title: error instanceof Error ? error.message : title })
    }
  }

  async function save() {
    setBusy('save')
    setNotice(null)
    try {
      const result = await backend.save({
        engine: form.engine || null, meta_name: form.metaName.trim(), language: form.language, category: form.category, header_type: form.headerType,
        header_text: form.headerText, header_media: form.headerMedia?.id ?? null, body: form.body, footer_text: form.footer, buttons: form.buttons,
        samples: Object.fromEntries(used.map((key) => [key, sampleOf(key)])), fallbacks: synced ? form.numberFallbacks : form.fallbacks,
        ...(synced ? { variable_tags: form.variableTags } : {}), base_version: current.version_number,
      })
      const next = formOf(result, numbers)
      setCurrent(result)
      setForm(next)
      setSaved(next)
      setNotice({ tone: 'ok', title: synced ? 'Saved. Each of Meta’s numbers now has its tag.' : `Saved as version ${result.version_number}. Submit it to Meta when it is ready.` })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setNotice({ tone: 'error', title: error.message })
      else refused(error, 'This template cannot be saved yet')
    } finally {
      setBusy(null)
    }
  }

  async function submit() {
    setBusy('submit')
    setNotice(null)
    try {
      const result = await backend.submit()
      setCurrent(result)
      if (result.meta_status === 'APPROVED') setCurrentStatus('ACTIVE')
      setNotice({ tone: 'ok', title: result.meta_status === 'APPROVED' ? 'Meta approved it. Campaigns can now send it.' : 'Sent to Meta for review. Meta usually decides within minutes, at most 24 hours; the status here updates by itself.' })
    } catch (error) {
      refused(error, 'Meta did not take it')
    } finally {
      setBusy(null)
    }
  }

  async function activate() {
    setBusy('activate')
    setNotice(null)
    try {
      await backend.activate()
      setCurrentStatus('ACTIVE')
      setNotice({ tone: 'ok', title: 'Template activated. Campaigns can now be published with it.' })
    } catch (error) {
      refused(error, 'Not ready to activate')
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    setBusy('copy')
    try {
      onCopied?.(await backend.copy())
    } catch (error) {
      refused(error, 'The copy was not made')
      setBusy(null)
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy('upload')
    try {
      const asset = await backend.uploadMedia(file)
      set('headerMedia', { id: asset.id, url: asset.url, file_name: asset.file_name, mime_type: asset.mime_type, byte_size: asset.byte_size })
    } catch (error) {
      refused(error, 'Upload failed')
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const meta = META_STATUS[current.meta_status]
  const review = reviewLine(current)

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={backTo} className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline" onClick={(event) => {
            if (dirty && !window.confirm('Leave without saving your changes?')) event.preventDefault()
          }}>
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates
          </Link>
          <span className="flex min-w-0 items-center gap-1.5"><h1 className="min-w-0 truncate text-base font-semibold text-ink-900">{templateName}</h1><PageHelp chapter="whatsapp" /></span>
          <Tag>WhatsApp</Tag>
          <StatusBadge status={currentStatus} />
          <Tag tone={meta.tone}>{meta.label}</Tag>
          {dirty && <span className="text-xs text-ink-800">Unsaved changes</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!locked && !synced && !current.editable && (
              <button type="button" className={buttonSecondary} disabled={busy !== null} onClick={() => void copy()}>{busy === 'copy' && <Spinner size="sm" />} Copy to Change</button>
            )}
            {!locked && current.meta_status === 'APPROVED' && currentStatus === 'DRAFT' && (
              <button type="button" className={buttonSecondary} disabled={dirty || busy !== null} onClick={() => void activate()}>{busy === 'activate' && <Spinner size="sm" />} Activate</button>
            )}
            {!locked && (!wordsFixed || synced) && (
              <button type="button" className={synced ? buttonPrimary : buttonSecondary} disabled={!dirty || problems.length > 0 || busy !== null} onClick={() => void save()}>
                {busy === 'save' && <Spinner size="sm" tone={synced ? 'onBrand' : undefined} />} Save
              </button>
            )}
            {!locked && !synced && current.editable && (
              <button type="button" className={buttonPrimary} disabled={dirty || current.version_number === 0 || busy !== null} title={dirty ? 'Save first' : undefined} onClick={() => void submit()}>
                {busy === 'submit' && <Spinner size="sm" tone="onBrand" />} Submit to Meta
              </button>
            )}
          </div>
        </div>
        {lockNote && (
          <p role="status" className="mt-2.5 flex items-start gap-2 rounded-lg border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-800">
            <Lock size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />{lockNote}
          </p>
        )}
        {notice && (
          <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-2.5 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${NOTICE_TONE[notice.tone]}`}>
            <div>
              <p className="font-medium">{notice.title}</p>
              {notice.items && notice.items.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5">{notice.items.map((item) => <li key={item}>{item}</li>)}</ul>}
            </div>
            <button type="button" aria-label="Dismiss" className={`${iconButtonClass()} shrink-0`} onClick={() => setNotice(null)}><X size={16} strokeWidth={1.5} aria-hidden /></button>
          </div>
        )}
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-5">
          <p data-testid="whatsapp-review" className={`rounded-lg border px-4 py-3 text-sm ${review.tone === 'error' ? 'border-danger bg-danger-bg text-danger-text' : review.tone === 'warn' ? 'border-warning bg-warning-bg text-warning-text' : 'border-line bg-surface-subtle text-ink-800'}`}>
            <span className="font-medium">{review.title}</span> {review.text}
          </p>

          <div className="rounded-lg border border-line bg-surface p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="WhatsApp Number" required error={errors.engine} hint={numbers.length === 0 ? 'Connect a WhatsApp number under Settings → Delivery first.' : 'The Meta business account that reviews and sends it.'}>
                {(ids) => <Select {...ids} value={form.engine} disabled={wordsFixed} onChange={(event) => set('engine', event.target.value)}>
                  <option value="">Choose a number</option>
                  {numbers.map((item) => <option key={item.engine} value={item.engine}>{item.label}</option>)}
                </Select>}
              </Field>
              <Field label="Name at Meta" required error={errors.meta_name} hint="Lower-case letters, digits and underscores, e.g. back_in_stock. Fixed once Meta has it.">
                {(ids) => <TextInput {...ids} value={form.metaName} disabled={wordsFixed} autoComplete="off" placeholder="back_in_stock"
                  onChange={(event) => set('metaName', event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'))} />}
              </Field>
              <Field label="Category" required error={errors.category} hint="Utility is only for an update the person expects, such as a receipt or an order. Meta moves anything promotional to Marketing.">
                {() => <Segmented label="Category" value={form.category} disabled={wordsFixed} options={[['MARKETING', 'Marketing'], ['UTILITY', 'Utility']]} onChange={(value) => set('category', value)} />}
              </Field>
              <Field label="Language" required error={errors.language}>
                {(ids) => <Select {...ids} value={form.language} disabled={wordsFixed} onChange={(event) => set('language', event.target.value)}>
                  {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </Select>}
              </Field>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
            <Field label="Header" error={errors.header_type ?? errors.header_text ?? errors.header_media}>
              {() => <Segmented label="Header" value={form.headerType} disabled={wordsFixed} options={HEADERS} onChange={(value) => set('headerType', value)} />}
            </Field>
            {form.headerType === 'TEXT' && (
              <Field label="Header Text" required limit={{ used: form.headerText.length, max: 60 }} hint="The same for everyone: tags go in the body.">
                {(ids) => <TextInput {...ids} value={form.headerText} maxLength={60} disabled={wordsFixed} onChange={(event) => set('headerText', event.target.value)} />}
              </Field>
            )}
            {(form.headerType === 'IMAGE' || form.headerType === 'DOCUMENT') && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink-900">{form.headerMedia?.file_name ?? (form.headerType === 'IMAGE' ? 'No picture chosen' : 'No document chosen')}</span>
                {!locked && (!wordsFixed || synced) && (
                  <>
                    <button type="button" className={buttonSecondary} disabled={busy === 'upload'} onClick={() => fileInput.current?.click()}>{busy === 'upload' && <Spinner size="sm" />} Upload</button>
                    <input ref={fileInput} type="file" accept={MEDIA_ACCEPT[form.headerType]} className="sr-only" aria-label="Upload the Header File" onChange={(event) => void upload(event.target.files?.[0])} />
                  </>
                )}
                <p className="w-full text-xs text-ink-800">{form.headerType === 'IMAGE' ? 'JPEG or PNG, up to 5 MB.' : 'PDF, up to 100 MB.'} Meta reviews it with this file and sends it with every message.</p>
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="wa-body" className="text-sm font-medium text-ink-800">Body <span className="text-danger-text">*</span></label>
                {!wordsFixed && tagGroups.length > 0 && (
                  <select aria-label="Insert Personalization Tag" value="" onChange={(event) => event.target.value && insertAtCaret(event.target.value)}
                    className="h-8 rounded-control-md border border-line-control bg-surface px-2 text-sm text-ink-900">
                    <option value="">{'{{ }}'} Insert Tag</option>
                    {tagGroups.map((group) => (
                      <optgroup key={group.kind} label={group.label}>
                        {group.tags.map((tag) => <option key={tag.id} value={asToken(tag.tag_key)}>{tag.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
              <TextArea id="wa-body" ref={textarea} rows={6} value={synced ? current.meta_body : form.body} disabled={wordsFixed} invalid={Boolean(errors.body) || problems.length > 0}
                placeholder="Good news, {{first_name}}: the item you asked about is back. We'll hold one for you until Sunday."
                onChange={(event) => set('body', event.target.value)} className="mt-2 leading-6" />
              <p aria-live="polite" className={`mt-1.5 text-xs tabular-nums ${metaLength > MAX_BODY ? 'text-danger-text' : 'text-ink-800'}`}>
                {(synced ? current.meta_body.length : metaLength).toLocaleString()} of {MAX_BODY.toLocaleString()} characters{used.length > 0 ? ` · ${used.length} tag${used.length === 1 ? '' : 's'}` : ''} · it may not start or end with a tag
              </p>
              {errors.body && <p className="mt-1 text-xs font-medium text-danger-text">{errors.body}</p>}
            </div>
          </div>

          {(synced ? current.variables.length > 0 : used.length > 0) && (
            <div className="rounded-lg border border-line bg-surface p-5">
              <h2 className="text-sm font-medium text-ink-800">{synced ? 'What Fills Each Number' : 'Samples for Meta’s Review'}</h2>
              <p className="mt-1 text-xs text-ink-800">{synced ? 'Meta’s words stay as they are; choose the tag each of its numbers is filled with.' : 'Meta reviews the message with a sample of each tag. If Empty is sent when a person has no value for the tag.'}</p>
              {(errors.samples || errors.variable_tags) && <p className="mt-2 text-xs font-medium text-danger-text">{errors.samples ?? errors.variable_tags}</p>}
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-xs text-ink-800"><th className="pb-1.5 font-medium">{synced ? 'Number' : 'Tag'}</th><th className="pb-1.5 font-medium">{synced ? 'Filled With' : 'Sample'}</th><th className="pb-1.5 font-medium">If Empty</th></tr></thead>
                <tbody>
                  {synced ? current.variables.map((variable, index) => (
                    <tr key={index}>
                      <td className="py-1 pr-2 font-mono text-xs text-ink-800">{`{{${index + 1}}}`}<span className="ml-1 font-sans text-ink-700">e.g. {variable.sample}</span></td>
                      <td className="py-1 pr-2">
                        <Select aria-label={`Tag for {{${index + 1}}}`} value={form.variableTags[index] ?? ''} disabled={locked} onChange={(event) => set('variableTags', form.variableTags.map((value, i) => (i === index ? event.target.value : value)))}>
                          <option value="">Choose a tag</option>
                          {tagGroups.flatMap((group) => group.tags).map((tag) => <option key={tag.id} value={tag.tag_key}>{tag.label}</option>)}
                        </Select>
                      </td>
                      <td className="py-1"><TextInput aria-label={`If {{${index + 1}}} is empty`} value={form.numberFallbacks[String(index + 1)] ?? ''} disabled={locked}
                        onChange={(event) => set('numberFallbacks', { ...form.numberFallbacks, [String(index + 1)]: event.target.value })} /></td>
                    </tr>
                  )) : used.map((key) => (
                    <tr key={key}>
                      <td className="py-1 pr-2"><span className="rounded-sm bg-brand-100 px-1.5 py-0.5 font-mono text-xs text-brand-800">{asToken(key)}</span></td>
                      <td className="py-1 pr-2"><TextInput aria-label={`Sample for ${key}`} value={sampleOf(key)} disabled={wordsFixed} onChange={(event) => set('samples', { ...form.samples, [key]: event.target.value })} /></td>
                      <td className="py-1"><TextInput aria-label={`If ${key} is empty`} value={form.fallbacks[key] ?? ''} disabled={wordsFixed} placeholder={catalogue.get(key)?.default_value ?? ''}
                        onChange={(event) => set('fallbacks', { ...form.fallbacks, [key]: event.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!(synced && !form.footer && form.buttons.length === 0) && <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
            <Field label="Footer" limit={{ used: form.footer.length, max: 60 }} error={errors.footer_text} hint="Small grey line under the message, e.g. Reply STOP to opt out.">
              {(ids) => <TextInput {...ids} value={form.footer} maxLength={60} disabled={wordsFixed} onChange={(event) => set('footer', event.target.value)} />}
            </Field>
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-ink-800">Buttons</h2>
                {!wordsFixed && form.buttons.length < 10 && (
                  <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => set('buttons', [...form.buttons, { type: 'QUICK_REPLY', text: '' }])}>
                    <Plus size={14} strokeWidth={1.5} aria-hidden /> Add Button
                  </button>
                )}
              </div>
              {errors.buttons && <p className="mt-1 text-xs font-medium text-danger-text">{errors.buttons}</p>}
              {form.buttons.length === 0 ? <p className="mt-2 text-xs text-ink-800">No buttons. Up to 10: at most 2 links and 1 phone number.</p> : (
                <ul className="mt-2 space-y-2">
                  {form.buttons.map((button, index) => {
                    const change = (patch: Partial<WhatsAppButton>) => set('buttons', form.buttons.map((item, i) => (i === index ? { ...item, ...patch } : item)))
                    return (
                      <li key={index} className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <Select aria-label={`Button ${index + 1} Kind`} value={button.type} disabled={wordsFixed} onChange={(event) => change({ type: event.target.value as WhatsAppButton['type'] })}>
                          {BUTTON_KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                        </Select>
                        <TextInput aria-label={`Button ${index + 1} Label`} value={button.text} maxLength={25} disabled={wordsFixed} placeholder="Label" onChange={(event) => change({ text: event.target.value })} />
                        {button.type === 'URL' ? <TextInput aria-label={`Button ${index + 1} Link`} value={button.url ?? ''} disabled={wordsFixed} placeholder="https://" onChange={(event) => change({ url: event.target.value })} />
                          : button.type === 'PHONE_NUMBER' ? <TextInput aria-label={`Button ${index + 1} Number`} value={button.phone ?? ''} disabled={wordsFixed} placeholder="+6568124400" onChange={(event) => change({ phone: event.target.value })} />
                          : <span className="self-center text-xs text-ink-800">{/^stop/i.test(button.text) ? 'Tapping it opts the person out of WhatsApp.' : 'Comes back as a reply.'}</span>}
                        {!wordsFixed && <button type="button" aria-label={`Remove Button ${index + 1}`} className={iconButtonClass()} onClick={() => set('buttons', form.buttons.filter((_, i) => i !== index))}><Trash2 size={16} strokeWidth={1.5} aria-hidden /></button>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>}

          {(problems.length > 0 || warnings.length > 0) && (
            <div className={`rounded-lg border px-5 py-4 text-sm ${problems.length ? 'border-danger bg-danger-bg text-danger-text' : 'border-warning bg-warning-bg text-warning-text'}`}>
              <p className="font-medium">{problems.length ? 'Meta Would Refuse This' : 'Before Submitting'}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{[...problems, ...warnings].map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </section>

        <aside aria-label="Preview" className="lg:sticky lg:top-6 lg:self-start">
          <WhatsAppPreview sender={sender} headerType={form.headerType} headerText={form.headerText} headerMedia={form.headerMedia} body={previewBody} footer={form.footer} buttons={form.buttons} />
          <p className="mx-auto mt-2 max-w-[320px] text-center text-xs text-ink-800">Tags show their samples.</p>
        </aside>
      </div>
    </div>
  )
}

function formOf(template: WhatsAppTemplate, numbers: WhatsAppNumber[]) {
  const samples = Object.fromEntries(template.variables.filter((v) => v.tag).map((v) => [v.tag, v.sample]))
  const fallbacks = Object.fromEntries(template.variables.filter((v) => v.tag).map((v) => [v.tag, v.fallback]))
  return {
    engine: template.engine ?? (numbers.length === 1 ? numbers[0].engine : ''),
    metaName: template.meta_name || slug(template.name),
    language: template.language || 'en',
    category: (template.category === 'UTILITY' ? 'UTILITY' : 'MARKETING') as 'MARKETING' | 'UTILITY',
    headerType: template.header_type,
    headerText: template.header_text,
    headerMedia: template.header_media,
    body: template.body,
    footer: template.footer_text,
    buttons: template.buttons,
    samples,
    fallbacks,
    variableTags: template.variables.map((v) => v.tag),
    numberFallbacks: Object.fromEntries(template.variables.map((v, i) => [String(i + 1), v.fallback])),
  }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 512)

function reviewLine(template: WhatsAppTemplate): { tone: 'plain' | 'warn' | 'error'; title: string; text: string } {
  if (template.origin === 'META') {
    return { tone: template.meta_status === 'APPROVED' ? 'plain' : 'warn', title: 'Made in WhatsApp Manager.', text: `Meta owns its words${template.synced_at ? ` (synced ${formatDateTime(template.synced_at)})` : ''}. Say which tag fills each number; change the words in WhatsApp Manager.` }
  }
  switch (template.meta_status) {
    case 'PENDING': return { tone: 'warn', title: 'With Meta for review.', text: `Submitted ${template.submitted_at ? formatDateTime(template.submitted_at) : ''}. Meta usually decides within minutes, at most 24 hours; the status updates by itself.` }
    case 'APPROVED': return { tone: 'plain', title: 'Approved by Meta.', text: 'Meta sends exactly these words, so they cannot change here. Copy it to make a changed version, which Meta reviews again.' }
    case 'REJECTED': return { tone: 'error', title: 'Meta rejected it.', text: `${template.meta_reason ? `Meta’s reason: ${template.meta_reason}. ` : ''}Change it and submit it again.` }
    case 'PAUSED': return { tone: 'warn', title: 'Paused by Meta.', text: `${template.meta_reason ?? 'Many people blocked or reported it.'} Campaigns cannot send it until Meta lifts the pause.` }
    case 'DISABLED': return { tone: 'error', title: 'Disabled by Meta.', text: `${template.meta_reason ?? ''} Copy it to make a new version.` }
    default: return { tone: 'plain', title: 'Not with Meta yet.', text: 'WhatsApp sends only templates Meta has approved. Save, then Submit to Meta.' }
  }
}
