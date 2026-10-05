/** Reads CEP's starters (journey.edit on the server). */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { JourneyStarter } from '@/lib/types'

export const STARTERS_KEY = ['journey-starters'] as const

export function useStarters() {
  return useQuery({
    queryKey: STARTERS_KEY,
    queryFn: ({ signal }) => api.get<JourneyStarter[]>('/journey-starters/', undefined, signal),
    staleTime: Infinity,
  })
}
