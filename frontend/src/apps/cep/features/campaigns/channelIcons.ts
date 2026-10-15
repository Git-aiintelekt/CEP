import { Image, Mail, MessageSquare, Send, type LucideIcon } from 'lucide-react'

const CHANNEL_ICON: Record<string, LucideIcon> = { EMAIL: Mail, SMS: MessageSquare, MMS: Image, MULTI: Send }

/** Mail, MessageSquare or Image for one channel; Send for a campaign on more than one */
export const channelIconOf = (channel: string): LucideIcon => CHANNEL_ICON[channel] ?? Send
