/**
 * Money for message costs, in the workspace's currency (set by the platform team): totals with 2 decimals, a part or a message
 * with 4 ("$0.0075"). Prices arrive from the API as strings.
 */
import { useQuery } from '@tanstack/react-query'

import { useOptionalAuth } from '@/auth/AuthContext'
import { api } from '@/lib/api'
import type { MessagePrices } from '@/lib/types'

export const COST_PERMISSION = 'cost.view'

function format(value: number, currency: string | null | undefined, digits: number): string {
  try {
    return value.toLocaleString(undefined, { style: 'currency', currency: currency || 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits })
  } catch {
    return `${currency ?? ''} ${value.toFixed(digits)}`.trim()       // a code the browser does not know
  }
}

/** a total: $137.76 */
export function costMoney(value: string | number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isNaN(amount) ? '—' : format(amount, currency, 2)
}

/** a part, an MMS, a delivered message: $0.0075 */
export function unitMoney(value: string | number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isNaN(amount) ? '—' : format(amount, currency, 4)
}

/** whether this person sees money (View Message Costs); nobody does outside a signed-in workspace (the /dev playgrounds) */
export function useSeesCosts(): boolean {
  const auth = useOptionalAuth()
  return Boolean(auth?.can(COST_PERMISSION))
}

/** the prices for the template line; nothing is asked for without the permission */
export function useMessagePrices() {
  const sees = useSeesCosts()
  return useQuery({
    queryKey: ['message-prices'],
    queryFn: ({ signal }) => api.get<MessagePrices>('/message-prices/', undefined, signal),
    enabled: sees,
    staleTime: 5 * 60_000,
    retry: false,
  })
}
