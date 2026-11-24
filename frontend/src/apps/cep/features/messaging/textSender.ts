/**
 * The name at the top of a text's preview: the campaign's own sender when there is a campaign, else the workspace's default sender
 * for the channel (an MMS template looks for an MMS sender first, then an SMS one). Null when the workspace has none, so the phone
 * can say so instead of showing a made-up name; undefined while the senders load or when this user cannot list them.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { SenderProfile } from '@/lib/types'

export type TextChannel = 'SMS' | 'MMS'

export function pickTextSender(senders: SenderProfile[], channel: TextChannel): SenderProfile | undefined {
  const pick = (wanted: TextChannel) => {
    const own = senders.filter((item) => item.channel === wanted)
    return own.find((item) => item.is_default) ?? own[0]
  }
  return (channel === 'MMS' ? pick('MMS') : undefined) ?? pick('SMS')
}

export function useSenderProfiles(enabled = true) {
  return useQuery({ queryKey: ['sender-profiles', 'options'], queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal), retry: false, enabled })
}

export function textSenderName(senders: SenderProfile[] | undefined, channel: TextChannel): string | null | undefined {
  return senders ? pickTextSender(senders, channel)?.display_name ?? null : undefined
}
