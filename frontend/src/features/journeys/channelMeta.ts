/** Channel icon + label for the List page's Channel column/filter and the preview popover's channel tags. */
import { Mail, MessageSquare, type LucideIcon } from 'lucide-react'

export const CHANNEL_META: Record<string, { label: string; icon: LucideIcon }> = {
  EMAIL: { label: 'Email', icon: Mail },
  SMS: { label: 'SMS', icon: MessageSquare },
  MMS: { label: 'MMS', icon: MessageSquare },
}
