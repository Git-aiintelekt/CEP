/** The Sending Domains query, shared by its section and the Senders table (which flags a sender whose domain needs a change). */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { SendingDomains } from '@/lib/types'

export const DOMAINS = ['delivery', 'sending-domains']

export function domainOf(address: string | null | undefined): string {
  return (address ?? '').split('@')[1]?.toLowerCase() ?? ''
}

export function useSendingDomains(enabled = true) {
  return useQuery({ queryKey: DOMAINS, queryFn: ({ signal }) => api.get<SendingDomains>('/sending-domains/', undefined, signal), enabled })
}
