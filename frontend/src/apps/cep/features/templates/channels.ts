/** How each template channel looks on the Templates landing page: its name, icon and colours. */
import { Image, Mail, MessageSquare, Receipt, type LucideIcon } from 'lucide-react'

export type TemplateChannel = 'EMAIL' | 'SMS' | 'MMS' | 'E_RECEIPT'

interface ChannelLook {
  label: string
  icon: LucideIcon
  /** flat tint: card headers, thumbnails and small tiles */
  tint: string
  /** the solid circle behind a quick-create icon */
  halo: string
  iconColor: string
}

export const CHANNEL_LOOK: Record<TemplateChannel, ChannelLook> = {
  EMAIL: { label: 'Email', icon: Mail, tint: 'bg-channel-email-tint', halo: 'bg-channel-email-halo', iconColor: 'text-channel-email-icon' },
  SMS: { label: 'SMS', icon: MessageSquare, tint: 'bg-channel-sms-tint', halo: 'bg-channel-sms-halo', iconColor: 'text-channel-sms-icon' },
  MMS: { label: 'MMS', icon: Image, tint: 'bg-channel-mms-tint', halo: 'bg-channel-mms-halo', iconColor: 'text-channel-mms-icon' },
  E_RECEIPT: { label: 'E-Receipt', icon: Receipt, tint: 'bg-channel-receipt-tint', halo: 'bg-channel-receipt-halo', iconColor: 'text-channel-receipt-icon' },
}

export const TEMPLATE_CHANNELS = Object.keys(CHANNEL_LOOK) as TemplateChannel[]

export function lookOf(channel: string): ChannelLook {
  return CHANNEL_LOOK[channel as TemplateChannel] ?? CHANNEL_LOOK.EMAIL
}
