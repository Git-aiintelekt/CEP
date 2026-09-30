/**
 * The Preview tab: the email as one contact would receive it, at desktop or phone width, under its inbox row.
 * Knows nothing about GrapesJS: it is handed the compiled email (or why there is none) and the header fields.
 */
import { Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { SegmentedControl } from '@/components/SegmentedControl'
import { EmptyState, Spinner } from '@/components/States'
import { formatUtcClock } from '@/lib/format'
import type { PersonalizationTag } from '@/lib/types'

import { clientById, EMAIL_CLIENTS, type Appearance, type ClientId } from './clients'
import { decoratePreview } from './decoratePreview'
import { InboxRow } from './InboxRow'
import {
  APPEARANCE_LABEL, CLIENT_LABEL, DEVICE_LABEL, EMPTY_HINT, EMPTY_LINK_NOTE, EMPTY_TITLE, FAILED_NOTE, FOOTNOTE, HIDE_DETAILS, LOADING_LABEL, PREVIEW_AS_LABEL,
  PREVIEW_FRAME_TITLE, PREVIEW_FRAME_WIDTH, SHOW_DETAILS, type PreviewDevice,
} from './previewCopy'
import { PREVIEW_PROFILES, profileById, type PreviewProfileId } from './previewProfiles'
import type { PreviewState } from './previewState'

const DEVICE_OPTIONS = [
  { value: 'desktop' as const, label: 'Desktop', icon: Monitor },
  { value: 'mobile' as const, label: 'Mobile', icon: Smartphone },
]
const PROFILE_OPTIONS = PREVIEW_PROFILES.map((profile) => ({ value: profile.id, label: profile.label }))
const CLIENT_OPTIONS = EMAIL_CLIENTS.map((client) => ({ value: client.id, label: client.label }))
const APPEARANCE_OPTIONS = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
]

/** the pane's own padding either side of the email (p-4) */
const GUTTER = 32

interface PreviewPaneProps {
  state: PreviewState
  subject: string
  preheader: string
  tags: PersonalizationTag[]
}

export function PreviewPane({ state, subject, preheader, tags }: PreviewPaneProps) {
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [profileId, setProfileId] = useState<PreviewProfileId>('sample')
  const [clientId, setClientId] = useState<ClientId>('generic')
  const [appearance, setAppearance] = useState<Appearance>('light')
  const profile = profileById(profileId)
  const client = clientById(clientId)
  const asLabelId = useId()
  const width = PREVIEW_FRAME_WIDTH[device]

  const decorated = useMemo(
    () => (state.status === 'ready' ? decoratePreview(state.html, tags, profile, { phone: device === 'mobile', clientCss: client.quirksCss, dark: appearance === 'dark' ? client.dark : null }) : null),
    [state, tags, profile, device, client, appearance],
  )

  // Scaled like the canvas's Fit when the pane is narrower than the email. A transform leaves the iframe's own
  // width alone, so the phone layout — stacked columns, blocks hidden on phones — is still the one drawn.
  const area = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    const measure = () => setRoom(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // the box's own 1px hairline either side is outside the frame, so it is counted too
  const scale = room !== null && room > 0 ? Math.min(1, (room - GUTTER) / (width + 2)) : 1

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <span id={asLabelId} className="text-xs text-ink-800">
            {PREVIEW_AS_LABEL}
          </span>
          <SegmentedControl label={PREVIEW_AS_LABEL} labelledBy={asLabelId} options={PROFILE_OPTIONS} value={profileId} onChange={setProfileId} />
        </div>
        <SegmentedControl label={DEVICE_LABEL} options={DEVICE_OPTIONS} value={device} onChange={setDevice} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-800">{CLIENT_LABEL}</span>
          <SegmentedControl label={CLIENT_LABEL} options={CLIENT_OPTIONS} value={clientId} onChange={setClientId} />
        </div>
        <SegmentedControl label={APPEARANCE_LABEL} options={APPEARANCE_OPTIONS} value={appearance} onChange={setAppearance} />
      </div>
      <p className="shrink-0 border-b border-line-subtle bg-surface-subtle px-4 py-1.5 text-xs text-ink-800" data-client-note>{client.note}</p>

      {state.status === 'failed' ? <FailedNotice details={state.details} /> : null}
      {decorated && decorated.emptyLinks > 0 ?
        <Notice tone="warning">{EMPTY_LINK_NOTE}</Notice>
      : null}

      <div ref={area} className="min-h-0 flex-1 overflow-auto bg-fill-subtle p-4">
        {state.status === 'loading' ?
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-ink-800">
            <Spinner className="h-4 w-4" /> {LOADING_LABEL}
          </p>
        : state.status === 'empty' ?
          <EmptyState variant="plain" title={EMPTY_TITLE} hint={EMPTY_HINT} />
        : state.status === 'ready' && decorated ?
          <div
            data-preview-width={width}
            // content-box: the hairline sits outside the frame, so it never takes a pixel from the email
            className="mx-auto box-content flex h-full min-h-[480px] flex-col border border-line"
            style={{ width, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: 'top center' }}
          >
            {/* the moment this preview was built stands in for when the email arrives */}
            <InboxRow subject={subject} preheader={preheader} catalogue={tags} profile={profile} time={formatUtcClock(state.builtAt) ?? ''} client={client} dark={appearance === 'dark'} />
            {/* sandbox with no allowances: no scripts, no forms, no navigation, a unique origin */}
            <iframe
              title={PREVIEW_FRAME_TITLE}
              sandbox=""
              srcDoc={decorated.html}
              className="block min-h-0 w-full flex-1 bg-surface"
            />
          </div>
        : null}
      </div>
      <p className="shrink-0 border-t border-line px-4 py-2 text-xs text-ink-800">{FOOTNOTE}</p>
    </div>
  )
}

function FailedNotice({ details }: { details: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Notice
      tone="error"
      action={
        <Button variant="link" size="sm" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
          {open ? HIDE_DETAILS : SHOW_DETAILS}
        </Button>
      }
    >
      <p>{FAILED_NOTE}</p>
      {open ?
        <ul className="mt-1 list-disc pl-4">
          {details.slice(0, 5).map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      : null}
    </Notice>
  )
}
