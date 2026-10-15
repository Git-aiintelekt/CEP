import type { Feature } from '@/lib/types'

import type { CampaignOption, HomeChannel, HomePeriod } from './data/types'

/** each channel shows only when the workspace has its feature */
export const CHANNEL_OPTIONS: { value: HomeChannel; label: string; feature: Feature }[] = [
  { value: 'ALL', label: 'All Channels', feature: 'email' },
  { value: 'EMAIL', label: 'Email', feature: 'email' },
  { value: 'SMS', label: 'SMS', feature: 'sms' },
  { value: 'MMS', label: 'MMS', feature: 'mms' },
]

export const PERIOD_OPTIONS: { value: HomePeriod; label: string }[] = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
]

/** none → "All Campaigns"; one → its name (the chip cuts it); several → "N Campaigns" */
export function campaignChipLabel(ids: string[], options: CampaignOption[]): string {
  if (ids.length === 0) return 'All Campaigns'
  if (ids.length === 1) return options.find((option) => option.id === ids[0])?.name ?? '1 Campaign'
  return `${ids.length} Campaigns`
}
