import { Image, Mail, MessageSquare, Receipt, Route, type LucideIcon } from 'lucide-react'

import { formatNumber, formatPercent } from '@/lib/format'

import type { EReceipts, FunnelChannel, MessageChannel, Schedule } from './data/types'

const CHANNEL: Record<MessageChannel, { icon: LucideIcon; label: string }> = {
  EMAIL: { icon: Mail, label: 'Email' },
  SMS: { icon: MessageSquare, label: 'SMS' },
  MMS: { icon: Image, label: 'MMS' },
}

export interface SnapshotRow {
  key: string
  icon: LucideIcon
  label: string
  detail: string
  /** the figure at the right: a rate, a count, or "—" */
  value: string
}

const engagement = (channel: FunnelChannel) =>
  channel.opened === null ? `${formatNumber(channel.clicked)} clicks` : `${formatNumber(channel.opened)} opens · ${formatNumber(channel.clicked)} clicks`
const rate = (channel: FunnelChannel) =>
  channel.delivered === 0 ? '—' : formatPercent(((channel.opened ?? channel.clicked) / channel.delivered) * 100)

/**
 * One row per channel the workspace sends on, the period's e-receipts, and the week's journey touchpoints. A channel
 * with nothing delivered says so; its figure is the open rate, or the click rate where opens aren't tracked.
 */
export function snapshotRows(channels: FunnelChannel[], workspace: MessageChannel[], receipts: EReceipts | null, schedule: Schedule | null): SnapshotRow[] {
  const rows: SnapshotRow[] = workspace.map((key) => {
    const channel = channels.find((item) => item.channel === key)
    const { icon, label } = CHANNEL[key]
    return channel && channel.delivered > 0
      ? { key, icon, label, detail: engagement(channel), value: rate(channel) }
      : { key, icon, label, detail: 'No sends in period', value: '—' }
  })
  if (receipts) rows.push({ key: 'E_RECEIPT', icon: Receipt, label: 'E-Receipt', detail: `${formatNumber(receipts.sent)} receipt${receipts.sent === 1 ? '' : 's'} sent`, value: formatPercent(receipts.openRate) })
  if (schedule) {
    const touchpoints = schedule.days.reduce((total, day) => total + day.journeyRuns, 0)
    rows.push({ key: 'JOURNEY', icon: Route, label: 'Journey', detail: `${formatNumber(touchpoints)} upcoming touchpoint${touchpoints === 1 ? '' : 's'}`, value: formatNumber(touchpoints) })
  }
  return rows
}
