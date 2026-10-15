/**
 * The picture at the top of a template or preset card. Email and e-receipt show the real email, scaled down; SMS and
 * MMS show the real first line of the message in a bubble. Nothing is compiled until the card is scrolled into view.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { DEFAULT_PROFILE, fillForPreview } from '@/apps/cep/features/designer/preview/previewProfiles'
import { useInView } from '@/lib/useInView'

import { lookOf } from '../channels'
import { channelOf, resolvedText, usePreviewContent, type PreviewItem } from './usePreviewContent'

const TILE = 'h-[120px] w-full'
const TILE_HEIGHT = 120
/** the email's own width, as the designer and the Preview modal lay it out */
const EMAIL_WIDTH = 600

/** Until the content is ready (or when there is none): the channel's tint and glyph. */
function ChannelPlaceholder({ channel }: { channel: string }) {
  const look = lookOf(channel)
  return (
    <span aria-hidden data-tile="placeholder" className={`absolute inset-0 flex items-center justify-center ${look.tint} ${look.iconColor}`}>
      <look.icon size={36} strokeWidth={1.5} />
    </span>
  )
}

/**
 * The email at its real 600px width, scaled to the card as the Preview tab scales it to its pane (PreviewPane.tsx):
 * a transform against the measured room, so the layout drawn is the desktop one. The frame is inert: sandboxed,
 * out of the tab order and deaf to the pointer, so a click lands on the card around it.
 */
function EmailThumb({ item, height = TILE_HEIGHT }: { item: PreviewItem; height?: number }) {
  const channel = channelOf(item)
  const box = useRef<HTMLSpanElement>(null)
  const inView = useInView(box)
  const { data, tags } = usePreviewContent(item, { enabled: inView })
  const html = useMemo(() => (data?.kind === 'email' && data.html ? fillForPreview(data.html, tags, DEFAULT_PROFILE) : null), [data, tags])
  // which html has painted: a newer save swaps the frame for a fresh one (a scaled frame reloaded in place can stay blank)
  const [painted, setPainted] = useState<string | null>(null)
  const loaded = html !== null && painted === html

  const [room, setRoom] = useState<number | null>(null)
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
  const scale = room ? room / EMAIL_WIDTH : height / 300

  return (
    <span ref={box} aria-hidden data-tile={html ? 'email' : 'placeholder'} style={{ height }} className="relative block w-full overflow-hidden border-b border-line-subtle bg-surface">
      {html && (
        <iframe
          key={html}
          title="Email thumbnail"
          sandbox=""
          srcDoc={html}
          tabIndex={-1}
          scrolling="no"
          onLoad={() => setPainted(html)}
          className="pointer-events-none absolute top-0 left-0 border-0 bg-surface"
          style={{ width: EMAIL_WIDTH, height: height / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      )}
      {/* stays over the frame until it has painted, so the card never flashes an empty white box */}
      {!loaded && <ChannelPlaceholder channel={channel} />}
    </span>
  )
}

function MessageTile({ item }: { item: PreviewItem }) {
  const channel = channelOf(item)
  const look = lookOf(channel)
  const { data, tags } = usePreviewContent(item)
  const text = data?.kind === 'message' ? resolvedText(data.body, tags).split('\n')[0].trim() : ''
  if (!text) {
    return (
      <span className={`relative block ${TILE}`}>
        <ChannelPlaceholder channel={channel} />
      </span>
    )
  }

  const media = data?.kind === 'message' ? data.media : null
  return (
    <span aria-hidden data-tile="message" className={`flex ${TILE} flex-col items-start justify-end gap-1.5 px-3.5 pb-3.5 ${look.tint}`}>
      {channel === 'MMS' && (media ? (
        <img src={media.url} alt="" className="h-10 w-14 rounded-md rounded-bl-sm object-cover" />
      ) : (
        <span className={`flex h-10 w-14 items-center justify-center rounded-md rounded-bl-sm bg-surface ${look.iconColor}`}>
          <look.icon size={16} strokeWidth={1.5} />
        </span>
      ))}
      {/* the clamp clips at its own padding box, so the padding sits on the bubble around it */}
      <span className="max-w-[88%] rounded-lg rounded-bl-md bg-surface px-2.5 py-1.5">
        <span className="line-clamp-2 text-xs leading-4 text-ink-900">{text}</span>
      </span>
    </span>
  )
}

/** `height`: an email's tile is this tall (px); the Sequence step's message cards show a small one */
export function ItemTile({ item, height }: { item: PreviewItem; height?: number }) {
  const channel = channelOf(item)
  return channel === 'SMS' || channel === 'MMS' ? <MessageTile item={item} /> : <EmailThumb item={item} height={height} />
}
