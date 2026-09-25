/**
 * The message as a recipient would get it. Email HTML is shown in a sandboxed frame (no scripts, no navigation),
 * a text message as a phone bubble. `party` previews as one customer of the audience; without it the
 * personalization tags show their catalogue sample values. `compact` is the campaign preview pop-up's version: no
 * toolbar, the whole email at its own 600px layout shrunk to the column's width, texts as the phone bubble.
 * With `controls` the caller owns the customer and the device (the campaign page's Content tab puts them in its card
 * header): no toolbar, the email at the chosen width and its own height in a 1px frame, texts on the Templates phone.
 * With `enlarge` (the Test step) a click on the message, or the Enlarge button, opens it whole in a wide pop-up.
 */
import { Maximize2, Monitor, Smartphone } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { buttonClass } from '@/components/buttonStyles'
import { Select } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, SkeletonLine, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { SegmentedControl } from '@/components/SegmentedControl'
import { BUBBLE, PhoneFrame } from '@/features/messaging/PhoneFrame'
import { ApiError } from '@/lib/api'

import { CardError } from './parts'
import { useCampaignPreview, useSampleCustomers } from './useCampaignPreview'

export type PreviewDevice = 'desktop' | 'mobile'

const EMAIL_WIDTH = 600
const FIRST_GUESS_HEIGHT = 900

/**
 * The email at its own 600px layout, shrunk to the column's width, shown whole: the frame takes the email's full
 * height, so a long email makes the column scroll rather than the frame. allow-same-origin lets us read that height;
 * with no allow-scripts nothing in the email runs.
 */
function ScaledEmail({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | null>(null)
  const [height, setHeight] = useState(FIRST_GUESS_HEIGHT)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setRoom(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scale = room ? Math.min(1, room / EMAIL_WIDTH) : 0.55
  return (
    <div ref={box} className="relative overflow-hidden" style={{ height: height * scale }}>
      <iframe title="Email preview" sandbox="allow-same-origin" srcDoc={html} scrolling="no"
        onLoad={(event) => {
          // the body's own height: the document's is never less than the frame's, so it could not shrink to a short email
          const body = event.currentTarget.contentDocument?.body
          if (!body) return
          const style = body.ownerDocument.defaultView?.getComputedStyle(body)
          const margins = (parseFloat(style?.marginTop ?? '0') || 0) + (parseFloat(style?.marginBottom ?? '0') || 0)
          setHeight(Math.ceil(body.scrollHeight + margins) || FIRST_GUESS_HEIGHT)
        }}
        className="absolute top-0 left-0 border-0 bg-surface"
        style={{ width: EMAIL_WIDTH, height, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}

/**
 * The email at the chosen width, exactly as tall as it is: the frame is measured once the email has loaded, and again
 * whenever its width changes (the email reflows). allow-same-origin lets us read the height; nothing in the email runs.
 */
function FittedEmail({ html, device }: { html: string; device: PreviewDevice }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(FIRST_GUESS_HEIGHT)
  const measure = () => {
    const body = frame.current?.contentDocument?.body
    if (!body) return
    const style = body.ownerDocument.defaultView?.getComputedStyle(body)
    const margins = (parseFloat(style?.marginTop ?? '0') || 0) + (parseFloat(style?.marginBottom ?? '0') || 0)
    const measured = Math.ceil(body.scrollHeight + margins)
    if (measured > 0) setHeight(measured)
  }
  useLayoutEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <iframe ref={frame} title="Email preview" sandbox="allow-same-origin" srcDoc={html} scrolling="no" onLoad={measure} data-fitted-email
      className={`mx-auto block border border-line bg-surface ${device === 'mobile' ? 'w-[375px] max-w-full' : 'w-full max-w-[680px]'}`}
      style={{ height: height + 2 }} />
  )
}

/** an MMS's picture above its text, as the phone shows it; "No image yet" until the template has one */
export function MmsImage({ url }: { url: string | null }) {
  return url
    ? <img src={url} alt="Attached image" className="max-h-56 max-w-[85%] rounded-lg rounded-bl-md object-cover" />
    : <p className="flex h-32 w-32 items-center justify-center rounded-lg rounded-bl-md bg-surface-sunken px-3 text-center text-xs text-ink-500">No image yet</p>
}

interface MessagePreviewProps {
  campaignId: string
  templateId?: string
  withCustomers?: boolean
  compact?: boolean
  /** a click on the message opens it large in a pop-up */
  enlarge?: boolean
  /** `image`: an MMS's picture (null: none yet); left out for every other channel */
  controls?: { party: string; device: PreviewDevice; sender: string; image?: string | null }
}

export function MessagePreview({ campaignId, templateId, withCustomers = false, compact = false, enlarge = false, controls }: MessagePreviewProps) {
  const [ownParty, setParty] = useState('')
  const [ownDevice, setDevice] = useState<PreviewDevice>('desktop')
  const [large, setLarge] = useState(false)
  const party = controls?.party ?? ownParty
  const device = controls?.device ?? ownDevice

  const people = useSampleCustomers(campaignId, withCustomers && !controls)
  const preview = useCampaignPreview(campaignId, { templateId, party })

  if (preview.isPending) {
    // the Content tab's card: a grey block, as every card on the campaign page loads
    if (controls) return <div aria-busy><span className="sr-only">Loading the preview</span><SkeletonLine width="100%" height={480} /></div>
    return <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading the preview</p>
  }
  if (preview.isError) {
    // 409: no template yet, or no saved content. That is a state of the campaign, not a failure.
    if (preview.error instanceof ApiError && preview.error.status === 409) return <p className="text-sm text-ink-500">{preview.error.message}</p>
    if (controls) return <CardError what="the preview" error={preview.error} onRetry={() => void preview.refetch()} />
    return <ErrorState title="The preview could not be built" error={preview.error} onRetry={() => void preview.refetch()} />
  }

  const data = preview.data
  const isEmail = Boolean(data.html)
  if (compact) {
    return (
      <div className="overflow-hidden border border-line bg-surface">
        {isEmail ? <ScaledEmail html={data.html ?? ''} /> : (
          <div className="p-4">
            <p aria-label="Text message preview" className="max-w-[88%] whitespace-pre-wrap rounded-lg rounded-bl-sm bg-line-subtle px-3.5 py-3 text-helper text-ink-900">{data.text}</p>
          </div>
        )}
      </div>
    )
  }
  const tagsLine = data.tags_used.length > 0 && (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
      Personalization tags in this message: {data.tags_used.map((tag) => <Tag key={tag}>{`{{${tag}}}`}</Tag>)}
    </p>
  )
  if (controls) {
    return (
      <div>
        {isEmail ? <FittedEmail key={device} html={data.html ?? ''} device={device} /> : (
          <div className="rounded-lg bg-surface-sunken p-6">
            <div className="mx-auto w-full max-w-[320px]">
              <PhoneFrame sender={controls.sender}>
                {controls.image !== undefined && <MmsImage url={controls.image} />}
                <p aria-label="Text message preview" className={BUBBLE}>{data.text}</p>
              </PhoneFrame>
            </div>
          </div>
        )}
        {tagsLine}
      </div>
    )
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{data.template} <span className="font-normal text-ink-500">· version {data.version}</span></p>
          {data.subject && isEmail && <p className="truncate text-sm text-ink-700">Subject: {data.subject}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {withCustomers && (people.data?.length ?? 0) > 0 && (
            <label className="text-xs font-medium text-ink-700">
              Preview As
              <Select value={party} onChange={(event) => setParty(event.target.value)} className="w-56">
                <option value="">Sample Values</option>
                {people.data?.map((person) => <option key={person.party_id} value={person.party_id}>{person.name}</option>)}
              </Select>
            </label>
          )}
          {isEmail && (
            <SegmentedControl label="Preview Size" iconOnly value={device} onChange={setDevice}
              options={[{ value: 'desktop', label: 'Desktop', icon: Monitor }, { value: 'mobile', label: 'Mobile', icon: Smartphone }]} />
          )}
          {enlarge && (
            <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => setLarge(true)}>
              <Maximize2 size={14} strokeWidth={1.5} aria-hidden />Enlarge
            </button>
          )}
        </div>
      </div>

      <div className="group relative">
        {isEmail ? (
          <div className="rounded-lg border border-line bg-surface-subtle p-3">
            <iframe title="Email preview" sandbox="" srcDoc={data.html ?? ''} className={`mx-auto block h-[560px] rounded-sm border border-line bg-surface ${device === 'mobile' ? 'w-[375px] max-w-full' : 'w-full'}`} />
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface-subtle p-5">
            <p aria-label="Text message preview" className="ml-auto max-w-sm whitespace-pre-wrap rounded-lg rounded-br-sm bg-line-subtle px-4 py-3 text-sm text-ink-900">{data.text}</p>
          </div>
        )}
        {enlarge && (
          // over the message: a click anywhere on it opens the large view (the frame itself swallows clicks)
          <button type="button" aria-label="Open a Larger Preview" onClick={() => setLarge(true)}
            className="absolute inset-0 flex cursor-zoom-in items-end justify-center rounded-lg pb-4 transition-colors duration-fast ease-standard hover:bg-ink-900/5 focus-visible:bg-ink-900/5">
            <span aria-hidden className="rounded-sm bg-ink-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100">Click to see it large</span>
          </button>
        )}
      </div>

      {tagsLine}

      {large && (
        <Modal title={data.template} subtitle={isEmail && data.subject ? `Subject: ${data.subject}` : `Version ${data.version}`} size="xl" scrollBody onClose={() => setLarge(false)}
          toolbar={isEmail ? (
            <div className="flex min-h-8 items-center justify-end">
              <SegmentedControl label="Preview Size" value={device} onChange={setDevice}
                options={[{ value: 'desktop', label: 'Desktop', icon: Monitor }, { value: 'mobile', label: 'Mobile', icon: Smartphone }]} />
            </div>
          ) : undefined}>
          {isEmail ? (
            <div className="rounded-lg bg-line-subtle p-4"><FittedEmail key={device} html={data.html ?? ''} device={device} /></div>
          ) : (
            <div className="rounded-lg bg-surface-sunken p-6">
              <div className="mx-auto w-full max-w-[320px]">
                <PhoneFrame sender={data.template}><p aria-label="Text message preview" className={BUBBLE}>{data.text}</p></PhoneFrame>
              </div>
            </div>
          )}
          {tagsLine}
        </Modal>
      )}
    </div>
  )
}
