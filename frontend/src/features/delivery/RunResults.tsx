import { useQuery } from '@tanstack/react-query'

import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber, humanize } from '@/lib/format'
import type { CampaignRun, RunResults as Results, SmsReply } from '@/lib/types'

const LIVE = new Set(['SCHEDULED', 'PREPARING', 'SENDING'])

const REASONS: Record<string, string> = {
  NO_CONSENT: 'No email consent', UNSUBSCRIBED: 'Unsubscribed', SUPPRESSED: 'On the suppression list', NO_EMAIL: 'No valid email address',
  BLOCKED_ADDRESS: 'Address blocked (bounce or complaint)', INVALID_ADDRESS: 'Invalid address', FREQUENCY_CAP: 'Frequency cap reached',
  DUPLICATE_ADDRESS: 'Same address as someone else in the run', UNKNOWN_PARTY: 'Not in the customer master',
  NO_PHONE: 'No phone number', INVALID_NUMBER: 'No mobile number in international format', BLOCKED_NUMBER: 'Number blocked (STOP reply, registry or undeliverable)',
  DUPLICATE_NUMBER: 'Same number as someone else in the run',
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' | 'good' }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === 'bad' && value > 0 ? 'text-danger-text' : tone === 'good' ? 'text-success-text' : 'text-ink-900'}`}>{formatNumber(value)}</dd>
    </div>
  )
}

/** What happened to one run: who was left out and why, and how the messages fared. Refreshes itself while the run is live. */
export function RunResults({ run }: { run: CampaignRun }) {
  const results = useQuery({
    queryKey: ['campaign-runs', run.id, 'results'],
    queryFn: ({ signal }) => api.get<Results>(`/campaign-runs/${run.id}/results/`, undefined, signal),
    refetchInterval: (query) => (LIVE.has(query.state.data?.status ?? run.status) ? 5000 : false),
  })
  if (results.isError) return <ErrorState title={`Could not load the results of run #${run.run_number}`} error={results.error} />
  if (results.isPending) return <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading results</p>

  const { audience, messages, status } = results.data
  const texts = results.data.family === 'SMS'
  const suppressed = Object.entries(audience.suppressed).sort((a, b) => b[1] - a[1])
  return (
    <section aria-label={`Results of run ${run.run_number}`} className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-card-title font-semibold text-ink-900">Run #{run.run_number}</h3>
        <span className="flex items-center gap-2 text-xs text-ink-500">
          {LIVE.has(status) && <Spinner className="h-3.5 w-3.5" />}
          <StatusBadge status={status} /> {results.data.completed_at ? `finished ${formatDateTime(results.data.completed_at)}` : results.data.started_at ? `started ${formatDateTime(results.data.started_at)}` : 'waiting to start'}
        </span>
      </div>
      {audience.members === 0 && status === 'SCHEDULED' ? <p className="mt-3 text-sm text-ink-500">The audience is built when the run starts.</p> : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-4 lg:grid-cols-7">
            <Stat label="On the lists" value={audience.members} />
            <Stat label="Eligible" value={audience.eligible} />
            <Stat label="Sent" value={messages.sent} tone="good" />
            <Stat label="Delivered" value={messages.delivered} />
            {texts ? <Stat label="Replied" value={messages.replied ?? 0} /> : <Stat label="Opened" value={messages.opened} />}
            {texts ? <Stat label="Opted out" value={messages.opted_out ?? 0} tone="bad" /> : <Stat label="Bounced" value={messages.bounced + messages.complained} tone="bad" />}
            <Stat label="Failed" value={messages.failed} tone="bad" />
          </dl>
          {messages.queued > 0 && <p className="mt-3 text-xs text-ink-500">{formatNumber(messages.queued)} still waiting to be sent.</p>}
          {texts && messages.sent > 0 && <p className="mt-3 text-xs text-ink-500">{formatNumber(messages.parts ?? 0)} message parts: a long text, or one with an emoji or accent, is billed as several.</p>}
          {suppressed.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Left out of this run</p>
              <ul className="mt-2 grid gap-x-8 gap-y-1 text-sm text-ink-700 lg:grid-cols-2">
                {suppressed.map(([reason, count]) => (
                  <li key={reason} className="flex justify-between gap-3"><span>{REASONS[reason] ?? humanize(reason)}</span><span className="tabular-nums">{formatNumber(count)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Sends the campaign's current content to a few addresses, with the sample values of the personalization tags. */
/** E-receipts are not published to an audience: the point of sale or the web shop asks for each one. */
export function ReceiptApiPanel({ campaignRef, published }: { campaignRef: string; published: boolean }) {
  const example = JSON.stringify({
    campaign: campaignRef, to: 'customer@example.com', name: 'Pat Lee',
    receipt: { number: 'R-104-88213', transaction_at: '2026-09-18T16:12:00', currency: 'USD', subtotal: 84, discount_total: -16.8, tax_total: 5.38, grand_total: 72.58,
               tender_summary: 'Visa ending 4242', items: [{ description: 'Merino crew sweater', sku: 'NW-1042', quantity: 1, unit_price: 64 }] },
    store: { name: 'Lenox Square', address: '3393 Peachtree Rd NE, Atlanta' },
  }, null, 2)
  return (
    <section aria-label="Sending receipts" className="rounded-lg border border-line bg-surface p-5">
      <h3 className="text-card-title font-semibold text-ink-900">Sending receipts</h3>
      <p className="mt-1 text-sm text-ink-500">
        {published ? 'This campaign is live.' : 'Publish the campaign first.'} Your point of sale or web shop then asks for one receipt at a time with an API key that has the scope <code className="rounded bg-line-subtle px-1 text-xs text-ink-900">receipts:send</code> (Settings → API keys).
        The receipt number makes retries safe: asking twice sends once. Attach a PDF copy with <code className="rounded bg-line-subtle px-1 text-xs text-ink-900">attachments</code> (name, content_type, base64 data).
      </p>
      <p className="mt-3 cep-num text-xs font-semibold text-ink-900">POST /api/v1/receipts/send/ · Authorization: Bearer cep_… · X-Tenant: your workspace code</p>
      <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-surface-subtle p-3 text-xs leading-5 text-ink-900">{example}</pre>
      <p className="mt-2 text-xs text-ink-500">201 sent · 200 already sent (duplicate) · 422 refused (blocked address, or the email engine rejected it) · 424 the email engine is failing temporarily: call again with the same number.</p>
    </section>
  )
}

const REPLY: Record<SmsReply['action'], { label: string; status: string }> = {
  OPT_OUT: { label: 'Opted out', status: 'FAILED' }, OPT_IN: { label: 'Opted in again', status: 'ACTIVE' }, HELP: { label: 'Asked for help', status: 'PAUSED' }, NONE: { label: 'Reply', status: 'DRAFT' },
}

/** What people texted back to this campaign: STOP and START are already applied, the rest is for a person to read. */
export function TextReplies({ campaignId }: { campaignId: string }) {
  const replies = useQuery({ queryKey: ['sms-inbound', campaignId], queryFn: ({ signal }) => api.get<SmsReply[]>('/sms-inbound/', { campaign: campaignId }, signal), refetchInterval: 30_000 })
  if (replies.isError || replies.isPending || replies.data.length === 0) return null
  return (
    <section aria-label="Replies" className="rounded-lg border border-line bg-surface p-5">
      <h3 className="text-card-title font-semibold text-ink-900">Replies</h3>
      <p className="mt-1 text-sm text-ink-500">STOP and START are applied the moment they arrive: the person is opted out (or back in) and the number is blocked for every campaign.</p>
      <ul className="mt-3 divide-y divide-line text-sm">
        {replies.data.map((reply) => (
          <li key={reply.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
            <span className="min-w-0"><span className="font-medium text-ink-900">{reply.name ?? reply.from_number}</span>{reply.name && <span className="ml-2 text-xs text-ink-500">{reply.from_number}</span>}
              <span className="ml-3 text-ink-700">{reply.body}</span></span>
            <span className="flex items-center gap-2 text-xs text-ink-500"><StatusBadge status={REPLY[reply.action].status} label={REPLY[reply.action].label} /> {formatDateTime(reply.received_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
