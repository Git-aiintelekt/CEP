/**
 * Read-only preview of a template or preset: nothing here saves or activates. A template's footer offers Edit, which
 * opens its editor; a preset's offers Copy This Template, the same copy-and-open as the Templates page always used. A
 * live drip's message template says so in grey and opens read-only (Open, not Edit).
 */
import { Lock, Monitor, Smartphone } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { DEFAULT_PROFILE, fillForPreview } from '@/features/designer/preview/previewProfiles'
import { BUBBLE, DeviceFrame, PhoneFrame } from '@/features/messaging/PhoneFrame'
import { OPT_OUT_PATTERN, smsMetrics } from '@/features/messaging/sms'
import { editorPathFor } from '@/lib/editorRoute'
import { formatNumber, formatRelative } from '@/lib/format'
import type { PersonalizationTag } from '@/lib/types'

import { lookOf } from '../channels'
import { dripLockNote } from '../lastUsed'
import { StatusTag } from '../StatusTag'
import { useCreateFromPreset } from '../useCreateFromPreset'
import { channelOf, resolvedText, usePreviewContent, type PreviewContent, type PreviewItem } from './usePreviewContent'

type Device = 'desktop' | 'mobile'
const DEVICE_OPTIONS = [
  { value: 'desktop' as const, label: 'Desktop', icon: Monitor },
  { value: 'mobile' as const, label: 'Mobile', icon: Smartphone },
]
const WIDTH: Record<Device, number> = { desktop: 600, mobile: 375 }
const SENDER = 'Your brand'

interface TemplatePreviewModalProps {
  item: PreviewItem
  /** Edit opens the editor (without template.edit it opens read-only, so the button says Open); presets get no copy button without it */
  canEdit: boolean
  onClose: () => void
  /** replaces the footer's action: a picker uses the template or preset instead of opening or copying it (the drip's gallery) */
  action?: { label: string; onClick: () => Promise<void> }
}

export function TemplatePreviewModal({ item, canEdit, onClose, action }: TemplatePreviewModalProps) {
  const navigate = useNavigate()
  const [device, setDevice] = useState<Device>('desktop')
  const preview = usePreviewContent(item)
  const createFromPreset = useCreateFromPreset()
  // the hook's loading overlay covers the page, but focus stays on this button, so Enter could fire it twice
  const copying = useRef(false)
  const [busy, setBusy] = useState(false)
  const copy = async () => {
    if (item.kind !== 'preset' || copying.current) return
    copying.current = true
    setBusy(true)
    await createFromPreset(item.preset)
    onClose()
  }
  const use = async () => {
    if (!action || copying.current) return
    copying.current = true
    setBusy(true)
    try {
      await action.onClick()
    } finally {
      copying.current = false
      setBusy(false)
    }
  }
  const channel = channelOf(item)
  const isEmail = channel === 'EMAIL'
  const name = item.kind === 'preset' ? item.preset.name : item.template.name
  const lock = item.kind === 'template' ? dripLockNote(item.template) : null

  // the tags, the note and the device switch share the header's second row, so the preview gets the height
  const tags = (
    <>
      <Tag>{lookOf(channel).label}</Tag>
      {item.kind === 'preset' ? <><Tag>{item.preset.category}</Tag><Tag>CEP Preset</Tag></> : <StatusTag status={item.template.status} />}
      {lock && <Tag>Locked</Tag>}
      <span className="ml-1.5 text-xs text-ink-800">Tags show their sample values. Nothing here is saved or sent.</span>
    </>
  )
  const headerActions = isEmail ? <SegmentedControl label="Device" options={DEVICE_OPTIONS} value={device} onChange={setDevice} /> : undefined

  const footer =
    action ? (
      <Button variant="primary" loading={busy} onClick={() => void use()}>{action.label}</Button>
    ) : item.kind === 'template' ? (
      <div className="flex w-full items-center justify-between gap-3">
        {lock ? <span data-lock-note className="flex items-start gap-1.5 text-helper text-pretty text-ink-800"><Lock size={16} strokeWidth={1.5} aria-hidden className="mt-px shrink-0" />{lock}</span>
          : <span className="text-helper text-ink-800">Edited {formatRelative(item.template.updated_at)}</span>}
        <Button variant="primary" onClick={() => navigate(editorPathFor(item.template))}>{canEdit && !lock ? 'Edit' : 'Open'}</Button>
      </div>
    ) : canEdit ? (
      <Button variant="primary" loading={busy} onClick={() => void copy()}>Copy This Template</Button>
    ) : undefined

  return (
    <Modal title={name} onClose={onClose} size="screen" scrollBody headerExtra={tags} headerActions={headerActions} footer={footer}>
      {preview.isError ? (
        <ErrorState title="Could not load this preview" error={preview.error} onRetry={() => void preview.refetch()} />
      ) : !preview.data ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-ink-800"><Spinner size="sm" /> Building the preview</p>
      ) : preview.data.kind === 'email' ? (
        <EmailPreview content={preview.data} tags={preview.tags} device={device} />
      ) : (
        <MessagePreview content={preview.data} tags={preview.tags} />
      )}
    </Modal>
  )
}

function EmailPreview({ content, tags, device }: { content: Extract<PreviewContent, { kind: 'email' }>; tags: PersonalizationTag[]; device: Device }) {
  const html = useMemo(() => fillForPreview(content.html, tags, DEFAULT_PROFILE), [content.html, tags])
  // as tall as the window leaves once the dialog's margin, header, subject card and footer have taken their share
  const frame = <iframe title="Email preview" sandbox="" srcDoc={html} style={{ width: WIDTH[device] }} className="block h-[max(480px,calc(100dvh-20rem))] max-w-none border-0 bg-surface" />

  return (
    <div className="space-y-4">
      <dl className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
        <div className="flex gap-3">
          <dt className="w-20 shrink-0 text-ink-800">Subject</dt>
          <dd className="min-w-0 font-semibold text-ink-900">{resolvedText(content.subject, tags) || 'No subject line'}</dd>
        </div>
        <div className="mt-1 flex gap-3">
          <dt className="w-20 shrink-0 text-ink-800">Preheader</dt>
          <dd className="min-w-0 text-ink-800">{resolvedText(content.preheader, tags) || 'No preheader'}</dd>
        </div>
      </dl>
      <div className="overflow-x-auto rounded-lg bg-fill-subtle p-4">
        {device === 'desktop' ? (
          <div className="mx-auto w-fit border border-line">{frame}</div>
        ) : (
          <DeviceFrame className="w-fit overflow-hidden">{frame}</DeviceFrame>
        )}
      </div>
    </div>
  )
}

function MessagePreview({ content, tags }: { content: Extract<PreviewContent, { kind: 'message' }>; tags: PersonalizationTag[] }) {
  const text = resolvedText(content.body, tags)
  const isMms = content.channel === 'MMS'
  const counted = smsMetrics(text)
  const facts = content.findings
    ? { units: content.findings.units, segments: content.findings.segments, encoding: content.findings.encoding, perSegment: content.findings.per_segment, missingOptOut: content.findings.missing_opt_out }
    // the same test the server applies (OPT_OUT_RE in design.py), on the text as written
    : { units: counted.units, segments: counted.segments, encoding: counted.encoding, perSegment: counted.perSegment, missingOptOut: !OPT_OUT_PATTERN.test(content.body) }
  const media = content.media
  const size = media?.width_px && media.height_px ? ` · ${media.width_px} × ${media.height_px}` : ''

  const rows: [string, string][] = [
    ['Characters', formatNumber(facts.units)],
    ['Segments', formatNumber(facts.segments)],
    ['Encoding', facts.encoding],
    ['Segment Limit', `${facts.perSegment} characters`],
    ['Media', isMms ? (media ? `${media.file_name}${size}` : 'No image attached yet') : 'None'],
    ['Opt-Out', facts.missingOptOut ? 'Missing' : 'In message body'],
  ]

  return (
    <div className="grid gap-6 md:grid-cols-[320px_minmax(0,1fr)] md:items-start">
      <PhoneFrame sender={SENDER}>
        {isMms && (media ? (
          <figure className="max-w-[85%]">
            <img src={media.url} alt="Attached image" className="max-h-56 w-auto rounded-lg rounded-bl-md object-cover" />
            <figcaption className="mt-1 text-xs text-ink-800">Attached image{size}</figcaption>
          </figure>
        ) : (
          <p className="flex h-32 max-w-[85%] items-center justify-center rounded-lg rounded-bl-md border border-dashed border-ink-300 px-3 text-center text-xs text-ink-800">Attached image: add one in the editor before activating</p>
        ))}
        {isMms && content.subject.trim() && <p className="max-w-[85%] text-xs font-semibold text-ink-800">{resolvedText(content.subject, tags)}</p>}
        {text.trim() ? <p data-testid="preview-bubble" className={BUBBLE}>{text}</p> : <p className="px-2 pt-10 text-center text-xs text-ink-800">This message has no text yet.</p>}
      </PhoneFrame>

      <div className="space-y-3">
        <dl aria-label="Message Facts" className="divide-y divide-line-subtle rounded-lg border border-line text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <dt className="text-ink-800">{label}</dt>
              <dd className={`cep-num text-right font-semibold ${label === 'Opt-Out' && facts.missingOptOut ? 'text-danger-text' : 'text-ink-900'}`}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-helper text-ink-800">
          Opt-out wording is part of the message body, so it counts toward the characters and segments above.
          {content.findings?.estimated || !content.findings ? ' Lengths are counted with sample values; real lengths vary per recipient.' : ''}
        </p>
      </div>
    </div>
  )
}
