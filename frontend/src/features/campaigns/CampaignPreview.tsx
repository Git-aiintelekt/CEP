/**
 * The campaign quick view: a peek at what a campaign is and what its message looks like, never what its row already
 * says. Floats over the list from md up (details left, the message's thumbnail right, each scrolling on its own);
 * a bottom sheet on phones (thumbnail first). Previous / next and ↑ / ↓ walk the table without closing it.
 */
import { ArrowRight, ChevronDown, ChevronUp, Copy, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'

import { IconButton } from '@/components/Button'
import { FloatingDialog } from '@/components/FloatingDialog'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { StatusBadge } from '@/components/StatusBadge'
import type { Campaign } from '@/lib/types'

import { CampaignPreviewDetails } from './CampaignPreviewDetails'
import { CampaignThumbnail } from './CampaignThumbnail'
import { ChannelIcon } from './ChannelIcon'
import { CopyId } from './CopyId'
import type { StatusAction } from './useCampaignAction'
import { useCampaignMessage } from './useCampaignPreview'
import { campaignHome, channelLabel, hasAction } from './vocabulary'

export interface PreviewNavigation {
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  /** "{name}, {n} of {total}", set after a move */
  announcement: string
}

interface CampaignPreviewProps {
  campaign: Campaign
  canEdit: boolean
  onClose: () => void
  /** clone: the page closes the pop-up and runs it as from the row */
  onAction: (action: StatusAction) => void
  nav: PreviewNavigation
  returnFocus?: () => HTMLElement | null
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function CampaignPreview({ campaign, canEdit, onClose, onAction, nav, returnFocus }: CampaignPreviewProps) {
  const titleId = useId()
  const thumbnailColumn = useRef<HTMLDivElement>(null)

  const message = useCampaignMessage(campaign)
  const { channel, content } = message

  const navRef = useRef(nav)
  useEffect(() => {
    navRef.current = nav
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.defaultPrevented || isTyping(event.target)) return
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (!dialogs[dialogs.length - 1]?.querySelector(`[id="${titleId}"]`)) return
      if (thumbnailColumn.current?.contains(event.target as Node)) return
      const { hasPrevious, hasNext, onPrevious, onNext } = navRef.current
      if (event.key === 'ArrowUp' && hasPrevious) onPrevious()
      if (event.key === 'ArrowDown' && hasNext) onNext()
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [titleId])

  const iconChannel = channel === 'E_RECEIPT' ? 'EMAIL' : channel ?? campaign.channel
  const home = campaignHome(campaign, canEdit)
  const unfinished = home !== `/campaigns/${campaign.id}`
  const canClone = canEdit && hasAction(campaign, 'clone') && !campaign.is_journey_generated

  const header = (
    <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
        <h2 id={titleId} className="w-full font-display text-[22px] leading-tight font-semibold tracking-[-0.02em] break-words text-ink-900 md:w-auto">{campaign.name}</h2>
        <StatusBadge status={campaign.display_status} label={campaign.display_status_label} />
        <span role="img" aria-label={channelLabel(iconChannel)} title={channelLabel(iconChannel)} className="flex text-ink-800">
          <ChannelIcon channel={iconChannel} aria-hidden />
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        <IconButton label="Previous Campaign" icon={ChevronUp} softDisabled={!nav.hasPrevious} onClick={nav.onPrevious} />
        <IconButton label="Next Campaign" icon={ChevronDown} softDisabled={!nav.hasNext} onClick={nav.onNext} />
        <span aria-hidden className="mx-1 h-5 w-px bg-fill-muted" />
        <IconButton label="Close" icon={X} onClick={onClose} />
      </div>
      <span aria-live="polite" className="sr-only">{nav.announcement}</span>
    </div>
  )

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={home} className={buttonPrimary}>
          {unfinished ? 'Continue Setup' : 'View Details'}
          <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
        </Link>
        {canClone && (
          <button type="button" className={buttonSecondary} onClick={() => onAction('clone')}>
            <Copy size={16} strokeWidth={1.5} aria-hidden />
            Clone
          </button>
        )}
      </div>
      {campaign.code && <div className="basis-full md:basis-auto"><CopyId key={campaign.id} code={campaign.code} /></div>}
    </div>
  )

  return (
    <FloatingDialog labelledBy={titleId} onClose={onClose} header={header} footer={footer} returnFocus={returnFocus} width={760} maxHeight="min(640px, 100dvh - 96px)" bodyScroll="columns">
      <div className="flex flex-col md:contents">
        <div className="order-2 border-line-subtle p-5 md:order-1 md:w-[52%] md:shrink-0 md:overflow-y-auto md:overscroll-contain md:border-r">
          <CampaignPreviewDetails key={campaign.id} campaign={campaign} channel={channel} content={content} tags={content.tags} />
        </div>
        <div ref={thumbnailColumn} tabIndex={0} role="region" aria-label="Message preview"
          className="order-1 flex min-w-0 flex-1 justify-center bg-surface-sunken p-5 md:order-2 md:w-[48%] md:items-start md:overflow-y-auto md:overscroll-contain">
          <CampaignThumbnail campaign={campaign} message={message} />
        </div>
      </div>
    </FloatingDialog>
  )
}
