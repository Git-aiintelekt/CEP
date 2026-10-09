/**
 * What a campaign's message looks like, small: the scaled email, or the text on a phone. The quick view and the
 * campaign page's Content card both show it; useCampaignMessage (useCampaignPreview.ts) fetches what it needs once for either.
 */
import { FileText, Info } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Spinner } from '@/components/States'
import { BUBBLE, PhoneFrame } from '@/features/messaging/PhoneFrame'
import { resolvedText, type PreviewContent } from '@/features/templates/preview/usePreviewContent'
import { ApiError } from '@/lib/api'
import type { Campaign, PersonalizationTag } from '@/lib/types'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

import { MessagePreview, MmsImage } from './MessagePreview'
import type { CampaignMessage } from './useCampaignPreview'

/** the quick view's "No content yet" box; the Content tab uses it too, with its own words and a way on */
export function NoContent({ title = 'No content yet', text = 'Choose a template to build this campaign’s message', action }: { title?: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-60 w-full flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface px-5 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-sunken text-ink-800"><FileText size={24} strokeWidth={1.5} aria-hidden /></span>
      <span className="text-card-title font-semibold text-ink-900">{title}</span>
      <span className="max-w-[320px] text-sm text-ink-800">{text}</span>
      {action}
    </div>
  )
}

function Loading() {
  return <p className="flex min-h-60 items-center justify-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading the preview</p>
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="flex min-h-60 flex-wrap items-center justify-center gap-2 text-sm text-ink-800">
      Couldn’t load the preview
      <button type="button" onClick={onRetry} className="font-semibold text-link hover:underline">Retry</button>
    </p>
  )
}

const PHONE_WIDTH = 320
/** the bubble's 14px text never drops below 12px */
const SMALLEST_PHONE_SCALE = 12 / 14

/** shrinks the phone to the column's width when the column is narrower (desktop only; the sheet has the full width) */
function FitWidth({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [natural, setNatural] = useState<number | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const room = box.current?.clientWidth ?? 0
      setNatural(inner.current?.offsetHeight || null)
      setScale(room > 0 && room < PHONE_WIDTH ? Math.max(SMALLEST_PHONE_SCALE, room / PHONE_WIDTH) : 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (box.current) observer.observe(box.current)
    if (inner.current) observer.observe(inner.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={box} className="w-full" style={natural && scale < 1 ? { height: natural * scale } : undefined}>
      <div ref={inner} style={{ width: PHONE_WIDTH, ...(scale < 1 ? { transform: `scale(${scale})`, transformOrigin: 'top left' } : {}) }} className="mx-auto">{children}</div>
    </div>
  )
}

export function TextThumbnail({ channel, data, tags, sender }: { channel: string; data: Extract<PreviewContent, { kind: 'message' }>; tags: PersonalizationTag[]; sender: string }) {
  const wide = useMinWidth(BREAKPOINT.md)
  const text = resolvedText(data.body, tags)
  const phone = (
    <PhoneFrame sender={sender}>
      {channel === 'MMS' && <MmsImage url={data.media?.url ?? null} />}
      {text.trim() ? <p data-testid="preview-bubble" className={BUBBLE}>{text}</p> : <p className="px-2 pt-10 text-center text-xs text-ink-800">This message has no text yet.</p>}
    </PhoneFrame>
  )
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <p className="flex items-center gap-2 text-helper text-ink-800"><Info size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />Shown with sample values</p>
      <div className="w-full max-w-[320px]">{wide ? <FitWidth>{phone}</FitWidth> : phone}</div>
    </div>
  )
}

export function CampaignThumbnail({ campaign, message }: { campaign: Campaign; message: CampaignMessage }) {
  const { channel, preview, content } = message
  const sender = campaign.sender_profile_name ?? 'Your brand'
  const noPreview = preview.error instanceof ApiError && preview.error.status === 409

  if (!campaign.template) return <NoContent />
  if (!channel) return noPreview ? <NoContent /> : preview.isError ? <Failed onRetry={() => void preview.refetch()} /> : <Loading />
  if (channel === 'SMS' || channel === 'MMS') {
    return content.isError ? <Failed onRetry={() => void content.refetch()} />
      : content.data?.kind === 'message' && content.tagsReady ? <TextThumbnail channel={channel} data={content.data} tags={content.tags} sender={sender} />
      : <Loading />
  }
  return noPreview ? <NoContent text={channel === 'E_RECEIPT' ? 'No preview for this receipt yet' : undefined} />
    : preview.isError ? <Failed onRetry={() => void preview.refetch()} />
    : preview.isPending ? <Loading />
    : <div className="w-full"><MessagePreview campaignId={campaign.id} compact /></div>
}
