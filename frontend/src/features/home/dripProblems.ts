/** Needs Attention's Drip Problems group, from the overview's drip_problems: a message nobody received, or a drip paused 3+ days. */
import { whenInZone } from '@/features/campaigns/dripSequence'
import type { DripProblem } from '@/lib/types'

import type { AttentionGroup, AttentionItem } from './data/types'

const DAY = 86_400_000

/** "Message 3 of Loyalty Welcome Series failed. No one received it."; "Holiday Reminder Texts has been paused for 3 days. Message 2 was due Fri 16 Oct." */
export function dripProblemItem(problem: DripProblem, zone: string, now = Date.now()): AttentionItem {
  const href = `/campaigns/${problem.campaign_id}`
  if (problem.kind === 'MESSAGE_FAILED') {
    return { id: `failed-${problem.campaign_id}-${problem.position}`, text: `Message ${problem.position} of ${problem.campaign_name} failed. No one received it.`, actionLabel: 'Review', href }
  }
  const days = Math.max(1, Math.floor((now - new Date(problem.paused_at).getTime()) / DAY))
  const next = problem.next
  const due = next?.was_due ? whenInZone(next.was_due, zone) : null
  const past = next?.was_due ? new Date(next.was_due).getTime() <= now : false
  const waiting = next ? ` Message ${next.position} ${due ? `${past ? 'was' : 'is'} due ${due.day}` : 'is waiting'}.` : ''
  return { id: `paused-${problem.campaign_id}`, text: `${problem.campaign_name} has been paused for ${days} day${days === 1 ? '' : 's'}.${waiting}`, actionLabel: 'Open', href }
}

/** one group for every drip problem: critical while a message failed, else blocking; null with none */
export function dripProblemsGroup(problems: DripProblem[], zone: string, now = Date.now()): AttentionGroup | null {
  if (problems.length === 0) return null
  const items = problems.map((problem) => dripProblemItem(problem, zone, now))
  const failed = problems.some((problem) => problem.kind === 'MESSAGE_FAILED')
  return {
    id: 'drip-problems', severity: failed ? 'critical' : 'blocking', category: problems.length === 1 ? 'Drip Problem' : 'Drip Problems', count: problems.length,
    label: items[0].text, actionLabel: items[0].actionLabel, href: items[0].href, items,
  }
}
