/** Shared by the Test Publish page's pieces: the test lists, the population line, and the approved outcome. */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ContactList, JourneyTestPopulation } from '@/lib/types'

/** Saved test lists (contact lists with list_environment TEST); the side panel and Run Test pop-up share the cache. */
export function useTestLists() {
  return useQuery({
    queryKey: ['contact-lists', 'test-environment'],
    queryFn: ({ signal }) => api.list<ContactList>('/contact-lists/', { list_environment: 'TEST', page_size: 100 }, signal),
  })
}

/** "50 customers", or the chosen test lists' members added up */
export function populationText(value: JourneyTestPopulation, lists: ContactList[] | undefined): string {
  if (value.mode === 'RANDOM') return `${formatNumber(value.sample_size ?? 50)} customers`
  const chosen = new Set(value.contact_list_ids ?? [])
  if (chosen.size === 0) return 'No list chosen'
  const total = (lists ?? []).filter((list) => chosen.has(list.id)).reduce((sum, list) => sum + list.member_count, 0)
  return `${formatNumber(total)} customers`
}

export type Outcome = { kind: 'ACTIVE' } | { kind: 'SCHEDULED'; when: string }

const dateText = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const timeText = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

/** "Dec 25, 2026 · 9:00 AM" in the browser's zone */
export function activationText(at: Date): string {
  return `${dateText.format(at)} · ${timeText.format(at)}`
}
