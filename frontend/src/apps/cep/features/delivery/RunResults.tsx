import { useQuery } from '@tanstack/react-query'

import { DataTable, type Column } from '@/components/DataTable'
import { SkeletonLine, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { CardError, CardSubheading, DetailCard, Fact } from '@/apps/cep/features/campaigns/parts'
import { dateTimeInZone } from '@/apps/cep/features/campaigns/zone'

import { exclusionReason } from './exclusionReasons'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { CampaignRun, RunResults as Results, SmsReply } from '@/lib/types'

const LIVE = new Set(['SCHEDULED', 'PREPARING', 'SENDING'])


function Stat({ label, value }: { label: string; value: number }) {
  return <Fact label={label}><span className="font-semibold">{formatNumber(value)}</span></Fact>
}

const reasonColumns = (channel: string): Column<[string, number]>[] => [
  { key: 'reason', header: 'Reason', render: ([reason]) => <span className="text-ink-900">{exclusionReason(reason, channel)}</span> },
  { key: 'count', header: 'People', align: 'right', render: ([, count]) => formatNumber(count) },
]

/**
 * What happened to one run: who was left out and why, and how the messages fared. Refreshes itself while the run is live.
 * Drawn to sit inside a card (the Runs table's opened row): facts and a table, no border of its own.
 */
/** `channel`: the campaign's, so a text run's consent reads "No Text Consent" (the results only know email or text) */
export function RunResults({ run, zone, channel }: { run: CampaignRun; zone: string; channel?: string }) {
  const results = useQuery({
    queryKey: ['campaign-runs', run.id, 'results'],
    queryFn: ({ signal }) => api.get<Results>(`/campaign-runs/${run.id}/results/`, undefined, signal),
    refetchInterval: (query) => (LIVE.has(query.state.data?.status ?? run.status) ? 5000 : false),
  })
  if (results.isError) return <CardError what={`the results of run #${run.run_number}`} error={results.error} onRetry={() => void results.refetch()} />
  if (results.isPending) return <div aria-busy className="flex flex-col gap-2"><SkeletonLine width="30%" /><SkeletonLine width="80%" /><SkeletonLine width="60%" /></div>

  const { audience, messages, status } = results.data
  const texts = results.data.family === 'SMS'
  const suppressed = Object.entries(audience.suppressed).sort((a, b) => b[1] - a[1])
  const at = (iso: string) => dateTimeInZone(iso, zone)
  return (
    <section aria-label={`Results of run ${run.run_number}`} className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-2 text-helper text-ink-800">
        {LIVE.has(status) && <Spinner className="h-3.5 w-3.5" />}
        <StatusBadge status={status} /> {results.data.completed_at ? `finished ${at(results.data.completed_at)}` : results.data.started_at ? `started ${at(results.data.started_at)}` : 'waiting to start'}
      </p>
      {audience.members === 0 && status === 'SCHEDULED' ? <p className="text-sm text-ink-800">The audience is built when the run starts.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4 xl:grid-cols-7">
            <Stat label="On the Lists" value={audience.members} />
            <Stat label="Eligible" value={audience.eligible} />
            <Stat label="Sent" value={messages.sent} />
            <Stat label="Delivered" value={messages.delivered} />
            {texts ? <Stat label="Replied" value={messages.replied ?? 0} /> : <Stat label="Opened" value={messages.opened} />}
            {texts ? <Stat label="Opted Out" value={messages.opted_out ?? 0} /> : <Stat label="Bounced" value={messages.bounced + messages.complained} />}
            <Stat label="Failed" value={messages.failed} />
          </dl>
          {messages.queued > 0 && <p className="text-helper text-ink-800">{formatNumber(messages.queued)} still waiting to be sent.</p>}
          {texts && messages.sent > 0 && <p className="text-helper text-ink-800">{formatNumber(messages.parts ?? 0)} message parts: a long text, or one with an emoji or accent, is billed as several.</p>}
          {suppressed.length > 0 && (
            <div className="flex flex-col gap-3">
              <CardSubheading>Left Out of This Run</CardSubheading>
              <DataTable columns={reasonColumns(channel ?? (texts ? 'SMS' : 'EMAIL'))} rows={suppressed} rowKey={([reason]) => reason} caption={`Left out of run ${run.run_number}`} framed={false} phone="table" />
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Sends the campaign's current content to a few addresses, with the sample values of the personalization tags. */
/** E-receipts are not published to an audience: the point of sale or the web shop asks for each one. The body of the campaign page's "Sending receipts" card. */
export function ReceiptApiDetails({ campaignRef, published }: { campaignRef: string; published: boolean }) {
  const example = JSON.stringify({
    campaign: campaignRef, to: 'customer@example.com', name: 'Pat Lee',
    receipt: { number: 'R-104-88213', transaction_at: '2026-09-18T16:12:00', currency: 'USD', subtotal: 84, discount_total: -16.8, tax_total: 5.38, grand_total: 72.58,
               tender_summary: 'Visa ending 4242', items: [{ description: 'Merino crew sweater', sku: 'NW-1042', quantity: 1, unit_price: 64 }] },
    store: { name: 'Lenox Square', address: '3393 Peachtree Rd NE, Atlanta' },
  }, null, 2)
  return (
    <>
      <p className="text-sm text-ink-800">
        {published ? 'This campaign is live.' : 'Publish the campaign first.'} Your point of sale or web shop then asks for one receipt at a time with an API key that has the scope <code className="rounded bg-fill-subtle px-1 text-xs text-ink-900">receipts:send</code> (Settings → API keys).
        The receipt number makes retries safe: asking twice sends once. Attach a PDF copy with <code className="rounded bg-fill-subtle px-1 text-xs text-ink-900">attachments</code> (name, content_type, base64 data).
      </p>
      <p className="mt-3 cep-num text-xs font-semibold text-ink-900">POST /api/v1/receipts/send/ · Authorization: Bearer cep_… · X-Tenant: your workspace code</p>
      <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-surface-subtle p-3 text-xs leading-5 text-ink-900">{example}</pre>
      <p className="mt-2 text-xs text-ink-800">201 sent · 200 already sent (duplicate) · 422 refused (blocked address, or the email engine rejected it) · 424 the email engine is failing temporarily: call again with the same number.</p>
    </>
  )
}

const REPLY: Record<SmsReply['action'], { label: string; status: string }> = {
  OPT_OUT: { label: 'Opted Out', status: 'FAILED' }, OPT_IN: { label: 'Opted In Again', status: 'ACTIVE' }, HELP: { label: 'Asked for Help', status: 'PAUSED' }, NONE: { label: 'Reply', status: 'DRAFT' },
}

/** What people texted back to this campaign: STOP and START are already applied, the rest is for a person to read. A card of its own, shown once someone has replied. */
export function TextReplies({ campaignId, zone }: { campaignId: string; zone: string }) {
  const replies = useQuery({ queryKey: ['sms-inbound', campaignId], queryFn: ({ signal }) => api.get<SmsReply[]>('/sms-inbound/', { campaign: campaignId }, signal), refetchInterval: 30_000 })
  if (replies.isError || replies.isPending || replies.data.length === 0) return null
  const at = (iso: string) => dateTimeInZone(iso, zone)
  return (
    <DetailCard title="Replies" description="STOP and START are applied the moment they arrive: the person is opted out (or back in) and the number is blocked for every campaign.">
      <ul aria-label="Replies" className="-my-3 divide-y divide-line-subtle">
        {replies.data.map((reply) => (
          <li key={reply.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-ink-900">{reply.name ?? reply.from_number}</span>
                {reply.name && <span className="cep-num text-helper text-ink-800">{reply.from_number}</span>}
              </span>
              <span className="text-sm break-words text-ink-800">{reply.body}</span>
            </div>
            <span className="flex shrink-0 items-center gap-2 text-helper text-ink-800">
              <StatusBadge status={REPLY[reply.action].status} label={REPLY[reply.action].label} />
              <span className="cep-num whitespace-nowrap">{at(reply.received_at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </DetailCard>
  )
}
