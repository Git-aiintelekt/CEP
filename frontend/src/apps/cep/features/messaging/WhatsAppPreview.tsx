/** A WhatsApp template as the phone shows it: the business's name on top, one white message with its header, body, footer and buttons. */
import { CornerUpLeft, ExternalLink, FileText, Phone } from 'lucide-react'

import type { WhatsAppButton } from '@/lib/types'

import { DeviceFrame } from './PhoneFrame'

const BUTTON_ICON = { URL: ExternalLink, QUICK_REPLY: CornerUpLeft, PHONE_NUMBER: Phone }

export interface WhatsAppPreviewProps {
  sender: string
  headerType: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO'
  headerText?: string
  /** the picture of an image header, the name of a document */
  headerMedia?: { url: string | null; file_name: string } | null
  body: string
  footer?: string
  buttons?: WhatsAppButton[]
}

export function WhatsAppPreview({ sender, headerType, headerText = '', headerMedia = null, body, footer = '', buttons = [] }: WhatsAppPreviewProps) {
  const initials = sender.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'WA'
  return (
    <DeviceFrame className="w-full max-w-[320px] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-fill-subtle text-xs font-semibold text-ink-800">{initials}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink-900">{sender}</span>
          <span className="block text-xs text-ink-800">WhatsApp Business</span>
        </span>
      </div>
      <div className="min-h-[300px] bg-fill-subtle px-3 pt-4 pb-5">
        {body.trim() ? (
          <div data-testid="whatsapp-preview" className="max-w-[260px] overflow-hidden rounded-lg border border-line-subtle bg-surface text-sm leading-5 text-ink-900">
            {headerType === 'IMAGE' && (headerMedia?.url
              ? <img src={headerMedia.url} alt="Header picture" className="block max-h-40 w-full object-cover" />
              : <div className="flex h-28 items-center justify-center bg-line-subtle text-xs text-ink-800">Header picture</div>)}
            {headerType === 'VIDEO' && <div className="flex h-28 items-center justify-center bg-line-subtle text-xs text-ink-800">Header video</div>}
            {headerType === 'DOCUMENT' && (
              <div className="m-1.5 flex items-center gap-2 rounded-md bg-surface-subtle p-2 text-xs text-ink-800">
                <FileText size={16} strokeWidth={1.5} aria-hidden />
                <span className="truncate font-medium text-ink-900">{headerMedia?.file_name || 'Document'}</span>
              </div>
            )}
            {headerType === 'TEXT' && headerText.trim() && <p className="px-2.5 pt-2 font-semibold">{headerText}</p>}
            <p className="px-2.5 pt-2 pb-1 break-words whitespace-pre-wrap">{body}</p>
            <p className="flex gap-2 px-2.5 pb-1.5 text-xs text-ink-800">
              {footer.trim() && <span className="min-w-0 truncate">{footer}</span>}
              <span className="ml-auto shrink-0">10:00</span>
            </p>
            {buttons.map((button, index) => {
              const Icon = BUTTON_ICON[button.type] ?? ExternalLink
              return (
                <p key={`${button.type}-${index}`} className="flex items-center justify-center gap-1.5 border-t border-line-subtle px-2 py-2 text-sm font-medium text-link">
                  <Icon size={14} strokeWidth={1.5} aria-hidden />{button.text || 'Button'}
                </p>
              )
            })}
          </div>
        ) : (
          <p className="px-2 pt-10 text-center text-xs text-ink-800">Your message appears here as one recipient would see it.</p>
        )}
      </div>
    </DeviceFrame>
  )
}
