/**
 * A campaign's audience in numbers, worked out once for every place that shows them (Overview's Audience card, the
 * Audience tab, the setup's estimate), so they can never disagree. Before a send it is today's estimate; after one,
 * the recipients of the last production send.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { exclusionReason, isKnownReason } from '@/features/delivery/exclusionReasons'
import { api } from '@/lib/api'
import { titleize } from '@/lib/format'
import type { Campaign, CampaignAudience } from '@/lib/types'

import { hasAction } from './vocabulary'

export function useCampaignAudience(campaign: Campaign) {
  return useQuery({
    queryKey: ['campaigns', 'audience', campaign.id, campaign.row_version],
    queryFn: ({ signal }) => api.get<CampaignAudience>(`/campaigns/${campaign.id}/audience/`, undefined, signal),
    enabled: campaign.campaign_type !== 'E_RECEIPT',
  })
}

/** today's estimate for lists picked in the setup, saved or not (the Audience step's summary, the Targets step's shares) */
export function useAudienceEstimate(included: string[], excluded: string[], channel: string, purpose: string) {
  return useQuery({
    queryKey: ['campaigns', 'audience-estimate', [...included].sort().join(','), [...excluded].sort().join(','), channel, purpose],
    queryFn: ({ signal }) =>
      api.get<CampaignAudience>('/campaigns/audience-estimate/', { include: included.join(','), exclude: excluded.join(','), channel: channel === 'MMS' ? 'SMS' : channel === 'MULTI' ? 'EMAIL' : channel, solicitation_type: purpose }, signal),
    enabled: included.length > 0,
    placeholderData: keepPreviousData,
  })
}

export interface AudienceSummaryNumbers {
  /** true once there is a production send: the numbers are that send's */
  sent: boolean
  eligible: number
  excluded: number
  total: number
  /** eligible as a percentage of total, one decimal */
  share: number
}

export function audienceSummary(campaign: Campaign, audience: CampaignAudience): AudienceSummaryNumbers {
  // once sent, the number is the Metrics card's Audience; eligible + excluded always make up the total
  const sent = hasAction(campaign, 'results') && campaign.audience_size !== null
  const eligible = sent ? campaign.audience_size! : audience.estimated_recipients
  const total = Math.max(sent ? audience.frozen?.members ?? audience.gross : audience.gross, eligible)
  return { sent, eligible, excluded: total - eligible, total, share: total > 0 ? Math.round((eligible / total) * 1000) / 10 : 0 }
}

/** today's estimate for lists picked in the setup, saved or not: eligible of everyone in the lists */
export function estimateSummary(audience: CampaignAudience): AudienceSummaryNumbers {
  const eligible = audience.estimated_recipients
  const total = Math.max(audience.gross, eligible)
  return { sent: false, eligible, excluded: total - eligible, total, share: total > 0 ? Math.round((eligible / total) * 1000) / 10 : 0 }
}

export const percentOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

export interface FunnelLine { label: string; value: number; strong?: boolean; minus?: boolean }

/** today's estimate, step by step */
export function audienceFunnel(audience: CampaignAudience): FunnelLine[] {
  return [
    { label: 'In the Attached Lists', value: audience.gross },
    { label: exclusionReason('DUPLICATES'), value: audience.duplicates_removed, minus: true },
    { label: 'Removed by Excluded Lists', value: audience.excluded_by_list, minus: true },
    { label: 'Unique People', value: audience.after_exclusions, strong: true },
    { label: audience.marketing ? 'Left Out by Governance Today' : 'Cannot Be Reached Today', value: audience.excluded_by_governance, minus: true },
    { label: 'Estimated Recipients', value: audience.estimated_recipients, strong: true },
  ]
}


/** the frozen Campaign List of the last send, as funnel lines */
export function frozenFunnel(frozen: NonNullable<CampaignAudience['frozen']>, channel: string): FunnelLine[] {
  return [
    { label: 'People in the List', value: frozen.members, strong: true },
    ...Object.entries(frozen.suppressed).map(([code, count]) => ({ label: `Left Out: ${exclusionReason(code, channel)}`, value: count, minus: true })),
    { label: 'Sent To', value: frozen.eligible, strong: true },
  ]
}

/** exclusions the platform applies to every campaign, whatever its settings */
export const SYSTEM_EXCLUSIONS = [
  { code: 'HARD_BOUNCE', label: exclusionReason('HARD_BOUNCE'), text: 'Undeliverable addresses' },
  { code: 'SOFT_BOUNCE', label: exclusionReason('SOFT_BOUNCE'), text: 'Bounced repeatedly' },
  { code: 'UNSUBSCRIBED', label: exclusionReason('UNSUBSCRIBED'), text: 'Opted out of this channel' },
  { code: 'COMPLAINT', label: exclusionReason('COMPLAINT'), text: 'Reported one of your messages as spam' },
  { code: 'BLOCKED', label: exclusionReason('BLOCKED'), text: 'The address or number is blocked for every campaign' },
  { code: 'SUPPRESSED', label: exclusionReason('SUPPRESSED'), text: 'On the workspace suppression list' },
] as const
const SYSTEM_CODES = new Set<string>(SYSTEM_EXCLUSIONS.map((item) => item.code))

/** how many people each reason left out: the last send's frozen list once sent, today's statuses before */
export function exclusionCounts(summary: AudienceSummaryNumbers, audience: CampaignAudience): Record<string, number> {
  if (summary.sent && audience.frozen) return audience.frozen.suppressed
  return Object.fromEntries(audience.statuses.filter((line) => !line.sendable).map((line) => [line.code, line.count]))
}

/** a status line's reason in the shared words (consent by channel), or the API's own label for a code the app doesn't know */
export const statusReason = (code: string, apiLabel: string | undefined, channel: string) => (isKnownReason(code) ? exclusionReason(code, channel) : apiLabel ?? titleize(code))

export interface ReasonRow { key: string; label: string; text: string; count: number }

function explain(code: string, channel: string): string {
  const texts = channel === 'SMS' || channel === 'MMS'
  const EXPLAIN: Record<string, string> = {
    NO_CONSENT: `Opted out of marketing ${texts ? 'texts' : 'email'} in the preference centre, or never opted in`,
    NO_EMAIL: 'The customer record has no email address',
    NO_PHONE: 'The customer record has no mobile number',
    UNKNOWN_PARTY: 'The list entry matches no customer record',
    INVALID_ADDRESS: `The ${texts ? 'number' : 'address'} is not in a valid format`,
    FREQUENCY_CAP: 'Already had as many marketing messages as the corporate limits allow for now',
    TOPIC_OPTED_OUT: "Unticked this campaign's topic on the preference page",
    EXCLUDED_LIST: 'Also in a list this campaign excludes',
    LIST_NOT_APPROVED: 'Only in a list that waits for approval under the consent policy',
  }
  return EXPLAIN[code] ?? 'Left out by the send rules'
}

/** the reasons a person was left out that the campaign's own set-up decides; the system ones have a card of their own */
export function reasonRows(summary: AudienceSummaryNumbers, audience: CampaignAudience): ReasonRow[] {
  const counts = exclusionCounts(summary, audience)
  const fromLists: ReasonRow[] = summary.sent && audience.frozen ? [] : [
    { key: 'EXCLUDED_LIST', label: exclusionReason('EXCLUDED_LIST'), text: explain('EXCLUDED_LIST', audience.channel), count: audience.excluded_by_list },
    { key: 'DUPLICATES', label: exclusionReason('DUPLICATES'), text: 'Gets one message, however many lists they are in', count: audience.duplicates_removed },
  ]
  const byStatus = Object.entries(counts).filter(([code]) => !SYSTEM_CODES.has(code))
    .map(([code, count]) => ({ key: code, label: statusReason(code, audience.statuses.find((line) => line.code === code)?.label, audience.channel), text: explain(code, audience.channel), count }))
  return [...fromLists, ...byStatus].filter((row) => row.count > 0)
}

export function systemRows(summary: AudienceSummaryNumbers, audience: CampaignAudience): ReasonRow[] {
  const counts = exclusionCounts(summary, audience)
  return SYSTEM_EXCLUSIONS.map((item) => ({ key: item.code, label: item.label, text: item.text, count: counts[item.code] ?? 0 })).filter((row) => row.count > 0)
}

const sum = (counts: Record<string, number>, codes: string[]) => codes.reduce((total, code) => total + (counts[code] ?? 0), 0)

/** the three health tiles: counts only, there are no thresholds to judge them by */
export function healthCounts(summary: AudienceSummaryNumbers, audience: CampaignAudience) {
  const counts = exclusionCounts(summary, audience)
  return {
    bounced: sum(counts, ['HARD_BOUNCE', 'SOFT_BOUNCE']),
    unsubscribed: sum(counts, ['UNSUBSCRIBED', 'SUPPRESSED', 'COMPLAINT', 'BLOCKED']),
    frequency: sum(counts, ['FREQUENCY_CAP']),
  }
}
