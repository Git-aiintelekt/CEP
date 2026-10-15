import type { LucideProps } from 'lucide-react'
import { createElement } from 'react'

import { channelIconOf } from './channelIcons'

export function ChannelIcon({ channel, ...props }: { channel: string } & LucideProps) {
  return createElement(channelIconOf(channel), { size: 16, strokeWidth: 1.5, ...props })
}
