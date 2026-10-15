/**
 * /reports/summary/ counts every email with its run, e-receipts included (they are mailer_execution rows under the
 * campaign's daily ERECEIPT_INSTANCE run), and its campaign rows carry campaign_type. Home keeps receipts out of the
 * marketing figures and reports them on their own.
 */
import type { ReportCampaignRow, ReportCounts, ReportSummary } from '@/lib/types'

import type { EReceipts } from './types'

const isReceipt = (row: ReportCampaignRow) => row.campaign_type === 'E_RECEIPT'
const COUNTS = ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'] as const
const sumOf = (rows: ReportCampaignRow[], key: keyof ReportCounts | 'conversions') => rows.reduce((total, row) => total + row[key], 0)

/** the summary without its e-receipt campaigns: their rows dropped, their counts taken off the totals and the email family */
export function marketingOnly(summary: ReportSummary): ReportSummary {
  const receipts = summary.campaigns.filter(isReceipt)
  if (receipts.length === 0) return summary
  const rows = summary.campaigns.filter((row) => !isReceipt(row))
  const less = (base: ReportCounts): ReportCounts => ({ ...base, ...Object.fromEntries(COUNTS.map((key) => [key, Math.max(0, base[key] - sumOf(receipts, key))])) })
  const revenues = rows.map((row) => row.revenue).filter((value): value is number => value !== null)
  return {
    ...summary,
    campaigns: rows,
    totals: { ...summary.totals, ...less(summary.totals), campaigns: rows.length, conversions: sumOf(rows, 'conversions'), revenue: revenues.length ? revenues.reduce((total, value) => total + value, 0) : null },
    by_channel: summary.by_channel.EMAIL ? { ...summary.by_channel, EMAIL: less(summary.by_channel.EMAIL) } : summary.by_channel,
  }
}

/** the e-receipt figures for the period; null when no receipt went out */
export function receiptFigures(summary: ReportSummary): EReceipts | null {
  const receipts = summary.campaigns.filter(isReceipt)
  if (receipts.length === 0) return null
  const delivered = sumOf(receipts, 'delivered')
  const revenues = receipts.map((row) => row.revenue).filter((value): value is number => value !== null)
  return {
    sent: sumOf(receipts, 'sent'),
    openRate: delivered ? Math.round((sumOf(receipts, 'opened') / delivered) * 1000) / 10 : 0,
    offerClicks: sumOf(receipts, 'clicked'),
    offerRevenue: revenues.length ? revenues.reduce((total, value) => total + value, 0) : null,
  }
}
