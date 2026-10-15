/**
 * A text message's words and picture, in the message drawer. They live in the message's own template copy, so they
 * save as the message composer saves them (POST /templates/{id}/message/, with its version lock), never on the step.
 * TextView is the drawer's resting state: the picture, the text and one Edit Text. TextComposer is Edit Text open.
 */
import { Image as ImageIcon, Info, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { TextArea } from '@/components/Form'
import { Spinner } from '@/components/States'
import { asToken, groupTags } from '@/apps/cep/features/designer/tags'
import { BUBBLE, PhoneFrame } from '@/apps/cep/features/messaging/PhoneFrame'
import { renderWithSamples } from '@/apps/cep/features/messaging/sms'
import { api, ApiError } from '@/lib/api'
import type { MediaAsset } from '@/lib/types'

import { useTextSave } from './useSequence'

import { counterText, usePersonalizationTags, useTemplateMessage } from './textContent'

const MMS_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const MMS_MAX_BYTES = 1024 * 1024
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`

const failure = (error: unknown) => (error instanceof ApiError ? Object.values(error.fieldErrors)[0] ?? error.message : error instanceof Error ? error.message : 'Not saved.')

export function TextView({ campaignId, templateId, mms, onEdit }: { campaignId: string; templateId: string | null; mms: boolean; onEdit: () => void }) {
  const message = useTemplateMessage(templateId)
  const tags = usePersonalizationTags()
  const save = useTextSave(campaignId, templateId ?? '')
  const file = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const body = message.data?.sms_body ?? ''
  const counter = counterText(body, tags.data?.results ?? [], mms)
  const media = message.data?.media_asset ?? null

  async function setPicture(next: MediaAsset | null) {
    if (!message.data) return
    setProblem(null)
    try {
      await save.mutateAsync({ sms_body: message.data.sms_body, subject_line: message.data.subject_line, media_asset: next?.id ?? null, base_version: message.data.latest_version })
    } catch (error) {
      setProblem(failure(error))
    }
  }

  async function upload(chosen: File | undefined) {
    if (!chosen) return
    if (!MMS_TYPES.includes(chosen.type)) return setProblem('Choose a JPEG, PNG or GIF picture.')
    if (chosen.size > MMS_MAX_BYTES) return setProblem(`The picture is ${kb(chosen.size)}. Pictures can be up to 1 MB.`)
    setUploading(true)
    try {
      await setPicture(await api.upload<MediaAsset>('/media-assets/', chosen))
    } catch (error) {
      setProblem(failure(error))
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ''
    }
  }

  if (!templateId) return null
  return (
    <>
      {mms && (
        <div className="flex flex-col gap-2" data-mms-image>
          <span className="text-sm font-semibold text-ink-800">Image</span>
          {media ? (
            <div className="flex items-center gap-3 rounded-lg border border-line p-3">
              <img src={media.url} alt="" className="h-16 w-16 shrink-0 rounded-sm object-cover" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-ink-900">{media.file_name}</span>
                <span className="cep-num text-helper text-ink-800">{media.width_px ? `${media.width_px} × ${media.height_px} · ` : ''}{kb(media.byte_size)}</span>
              </span>
              <Button size="sm" variant="secondary" loading={uploading} onClick={() => file.current?.click()}>Replace</Button>
              <button type="button" onClick={() => void setPicture(null)} className="h-8 rounded-control-md px-2.5 text-sm font-semibold text-danger-text hover:bg-danger-bg">Remove</button>
            </div>
          ) : (
            <button type="button" onClick={() => file.current?.click()} disabled={uploading || !message.data}
              className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 bg-surface text-sm font-semibold text-link hover:bg-brand-100 disabled:cursor-not-allowed disabled:text-ink-300">
              {uploading ? <Spinner size="sm" /> : <Plus size={16} strokeWidth={1.5} aria-hidden />}Add Image
            </button>
          )}
          <input ref={file} type="file" accept={MMS_TYPES.join(',')} className="sr-only" aria-label="Upload an Image" onChange={(event) => void upload(event.target.files?.[0])} />
          <span className="text-helper text-ink-800">JPEG, PNG or GIF, up to 1 MB. Under 600 KB is delivered reliably by every carrier.</span>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink-800">Message Text</span>
          <button type="button" onClick={onEdit} disabled={!message.data} className="text-sm font-semibold text-link hover:underline disabled:text-ink-300">Edit Text</button>
        </div>
        <div data-message-text className={`rounded-lg border border-line-subtle bg-surface-subtle px-3.5 py-3 text-sm break-words whitespace-pre-wrap ${body ? 'text-ink-900' : 'text-ink-800'}`}>
          {message.isPending ? 'Loading the text' : body || 'No message text yet.'}
        </div>
        <span className="cep-num self-end text-xs font-medium text-ink-800" data-sms-counter>{counter.text}</span>
      </div>
      {problem && <p role="alert" className="text-helper font-medium text-danger-text">{problem}</p>}
      <p className="flex items-center gap-1.5 text-helper text-ink-800"><Info size={16} strokeWidth={1.5} aria-hidden />A/B testing is available for email only.</p>
    </>
  )
}

/** Edit Text open: the text, the personalisation chips, the counter, and the phone as one recipient sees it */
export function TextComposer({ draft, onDraft, mms, sender, imageUrl, when }: { draft: string; onDraft: (text: string) => void; mms: boolean; sender: string; imageUrl: string | null; when: string }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const tags = usePersonalizationTags()
  const catalogue = useMemo(() => tags.data?.results ?? [], [tags.data])
  const chips = useMemo(() => groupTags(catalogue, mms ? 'MMS' : 'SMS').flatMap((group) => group.tags), [catalogue, mms])
  const counter = counterText(draft, catalogue, mms)
  const sample = renderWithSamples(draft, catalogue)

  function insert(token: string) {
    const element = area.current
    const start = element?.selectionStart ?? draft.length
    const end = element?.selectionEnd ?? draft.length
    const before = draft.slice(0, start)
    const glue = before && !/\s$/.test(before) ? ' ' : ''
    onDraft(before + glue + token + draft.slice(end))
    requestAnimationFrame(() => {
      const caret = start + glue.length + token.length
      element?.focus()
      element?.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="drip-text" className="text-sm font-semibold text-ink-800">Message Text</label>
        <TextArea ref={area} id="drip-text" data-autofocus rows={5} value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="e.g. Your first reward is unlocked. Reply STOP to opt out." />
        <div className="flex items-start justify-between gap-3">
          <span className="text-helper text-ink-800">Personalised fields are counted with their sample values.</span>
          <span className={`cep-num shrink-0 text-xs font-semibold ${counter.over ? 'text-warning-text' : 'text-ink-800'}`} data-sms-counter>{counter.text}</span>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-ink-800">Insert Personalisation</span>
          <div className="flex flex-wrap gap-2">
            {chips.map((tag) => (
              <button key={tag.id} type="button" onClick={() => insert(asToken(tag.tag_key))}
                className="flex h-8 items-center gap-1.5 rounded-control-md border border-line-control bg-surface pr-3 pl-2.5 text-sm font-medium text-ink-900 hover:border-link hover:bg-surface-hover">
                <Plus size={14} strokeWidth={1.5} aria-hidden className="text-ink-800" />{tag.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col items-center gap-2">
        <span className="self-start text-sm font-semibold text-ink-800">Preview</span>
        <PhoneFrame sender={sender}>
          <p className="text-center text-xs text-ink-800">{when}</p>
          {mms && (imageUrl ? <img src={imageUrl} alt="Attached picture" className="max-h-40 w-auto max-w-[85%] rounded-lg rounded-bl-md object-cover" />
            : <span className="flex h-24 w-36 items-center justify-center rounded-lg bg-fill-muted text-ink-800"><ImageIcon size={20} strokeWidth={1.5} aria-hidden /></span>)}
          <p data-testid="drip-sms-preview" className={BUBBLE}>{sample.trim() ? sample : 'Your text appears here.'}</p>
        </PhoneFrame>
        <span className="text-xs text-ink-800">Tags show their sample values.</span>
      </div>
    </div>
  )
}
