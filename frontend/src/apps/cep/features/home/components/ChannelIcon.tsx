import { Image, Mail, MessageSquare, type LucideIcon } from 'lucide-react'

const CHANNEL: Record<string, { icon: LucideIcon; label: string }> = {
  EMAIL: { icon: Mail, label: 'Email' },
  SMS: { icon: MessageSquare, label: 'SMS' },
  MMS: { icon: Image, label: 'MMS' },
}

/** the channel as a 16px icon with its name for screen readers: Mail, MessageSquare, Image */
export function ChannelIcon({ channel, className = 'text-ink-800' }: { channel: string; className?: string }) {
  const { icon: Icon, label } = CHANNEL[channel] ?? CHANNEL.EMAIL
  return <Icon size={16} strokeWidth={1.5} role="img" aria-label={label} className={`shrink-0 ${className}`} />
}
