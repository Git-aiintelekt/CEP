/** /customers/:partyId: one customer across the workspace (GET /customers/{party_id}/, apps/customers/profile.py): the record,
 * consent per channel, custom attributes, the lists they are on, every journey they entered (with a link to their timeline),
 * the events received for them, their orders and their last messages. Nothing is edited here: the record is C360's. */
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { DataTable } from '@/components/DataTable'
import { buttonSecondary } from '@/components/Form'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { DetailCard, Fact, FACTS_GRID } from '@/features/campaigns/parts'
import { api } from '@/lib/api'
import { formatDateTime, formatMoney, titleize } from '@/lib/format'
import type { CustomerRecord } from '@/lib/types'

const CHANNEL_LABEL: Record<string, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }
/** consent_suppression.marketable_reason, in words */
const REASON_LABEL: Record<string, string> = { NO_CONSENT: 'No consent', UNSUBSCRIBED: 'Unsubscribed', SMS_STOP: 'Texted STOP', HARD_BOUNCE: 'Bounced', SOFT_BOUNCE_THRESHOLD: 'Bouncing',
                                               COMPLAINT: 'Complained', DND_REGISTRY: 'Do-not-call registry', MANUAL_BLOCK: 'Blocked', INVALID_ADDRESS: 'Invalid address', GLOBAL_SUPPRESSION_LIST: 'Suppressed' }
const METHOD_LABEL: Record<string, string> = { UNSUBSCRIBE_LINK: 'unsubscribe link', SMS_STOP: 'texted STOP', PREFERENCE_CENTER: 'preference centre', CSR: 'by hand', IMPORT: 'import', COMPLAINT: 'complaint' }
const methodWords = (code: string) => METHOD_LABEL[code] ?? titleize(code).toLowerCase()
const reasonWords = (code: string | null | undefined) => (code ? REASON_LABEL[code] ?? titleize(code) : 'No consent')
const ENROLLMENT_LABEL: Record<string, string> = { ACTIVE: 'In Journey', COMPLETED: 'Completed', EXITED: 'Exited Early' }
const MESSAGE_LABEL: Record<string, string> = { QUEUED: 'Queued', SUBMITTED: 'Sent', DELIVERED: 'Delivered', OPENED: 'Opened', CLICKED: 'Clicked', BOUNCED: 'Bounced', COMPLAINED: 'Complained',
                                                FAILED: 'Not sent', RESPONDED: 'Replied', OPTED_OUT: 'Opted out' }

function words(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function addressLines(address: Record<string, unknown> | null): string[] {
  if (!address) return []
  const keys = ['line1', 'line2', 'street', 'city', 'state', 'postal_code', 'postcode', 'country']
  const known = keys.map((key) => address[key]).filter((value) => value !== null && value !== undefined && value !== '').map(String)
  return known.length > 0 ? known : Object.values(address).filter((value) => typeof value === 'string' && value !== '') as string[]
}

export function CustomerPage({ partyId: given }: { partyId?: string } = {}) {
  const params = useParams()
  const partyId = given ?? params.partyId ?? ''
  const query = useQuery({ queryKey: ['customers', partyId], queryFn: ({ signal }) => api.get<CustomerRecord>(`/customers/${encodeURIComponent(partyId)}/`, undefined, signal) })
  if (query.isPending) return <p className="flex items-center gap-3 text-sm text-ink-800"><Spinner /> Loading the customer</p>
  if (query.isError) return <ErrorState title="This customer could not be loaded" error={query.error} onRetry={() => void query.refetch()} />
  const { customer, consent, lists, events, orders, messages, journeys, journey_suppressions: suppressed } = query.data
  const attributes = Object.entries(customer.custom_attributes ?? {})
  const address = addressLines(customer.primary_address)
  return (
    <section>
      <Link to="/customers" className="mb-3 inline-flex items-center gap-1 text-helper text-brand-800 hover:underline">
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden /> Customers
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="font-display text-page-title font-semibold break-words text-ink-900">{customer.name}</h1>
          <p className="cep-num text-sm text-ink-800">Customer ID {customer.party_id} · {customer.source_system} · updated {formatDateTime(customer.synced_at)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {consent.map((row) => (
              <Tag key={row.channel} tone={row.marketable ? 'success' : 'warning'}>
                {`${CHANNEL_LABEL[row.channel] ?? titleize(row.channel)}: ${row.marketable ? 'Can receive' : reasonWords(row.marketable_reason)}`}
              </Tag>
            ))}
            {consent.length === 0 && <Tag>No consent recorded</Tag>}
          </div>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-6">
        <DetailCard title="Record" description="As C360 synced it, or as an upload added it. C360 does not edit the record.">
          <dl className={FACTS_GRID}>
            <Fact label="Email Addresses">
              {customer.emails.length === 0 ? <span className="text-ink-300">None</span>
                : customer.emails.map((email, index) => <span key={index} className="block">{email.address}{email.is_primary ? ' · primary' : ''}{email.is_valid === false ? ' · invalid' : ''}</span>)}
            </Fact>
            <Fact label="Phone Numbers">
              {customer.phones.length === 0 ? <span className="text-ink-300">None</span>
                : customer.phones.map((phone, index) => <span key={index} className="cep-num block">{phone.number}{phone.type ? ` · ${titleize(phone.type)}` : ''}{phone.is_primary ? ' · primary' : ''}</span>)}
            </Fact>
            <Fact label="Address">{address.length === 0 ? <span className="text-ink-300">None</span> : address.map((line, index) => <span key={index} className="block">{line}</span>)}</Fact>
          </dl>
        </DetailCard>

        <DetailCard title="Consent" flush description="Per channel, as the send engine judges it; a journey or campaign message is held back when a channel cannot receive.">
          {consent.length === 0 ? <p className="p-6 text-sm text-ink-800">No consent has been recorded for this customer on any channel.</p> : (
            <DataTable rows={consent} rowKey={(row) => row.channel} caption="Consent by channel" inset="card" framed={false} primary="channel" columns={[
              { key: 'channel', header: 'Channel', render: (row) => <span className="font-medium text-ink-900">{CHANNEL_LABEL[row.channel] ?? titleize(row.channel)}</span> },
              { key: 'status', header: 'Status', render: (row) => titleize(row.consent_status) },
              { key: 'marketable', header: 'Can Receive', render: (row) => (row.marketable ? 'Yes' : `No · ${reasonWords(row.marketable_reason)}`) },
              { key: 'in', header: 'Opted In', render: (row) => <span className="cep-num text-ink-800">{row.opted_in_at ? formatDateTime(row.opted_in_at) : '—'}</span> },
              { key: 'out', header: 'Opted Out', render: (row) => <span className="cep-num text-ink-800">{row.opted_out_at ? `${formatDateTime(row.opted_out_at)}${row.opt_out_method ? ` · ${methodWords(row.opt_out_method)}` : ''}` : '—'}</span> },
              { key: 'suppressed', header: 'Suppressed', render: (row) => (row.suppressed ? row.suppression_reason || 'Yes' : '—') },
            ]} />
          )}
        </DetailCard>

        <DetailCard title="Custom Attributes" flush description="The fields C360 sends with the record, which conditions, splits, date entries and time-of-day waits read.">
          {attributes.length === 0 ? <p className="p-6 text-sm text-ink-800">The record carries no custom attributes.</p> : (
            <DataTable rows={attributes.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value }))} rowKey={(row) => row.key} caption="Custom attributes" inset="card" framed={false} primary="attribute" columns={[
              { key: 'attribute', header: 'Attribute', render: (row) => <span className="font-medium text-ink-900">{row.key}</span> },
              { key: 'value', header: 'Value', render: (row) => <span className="text-ink-800">{words(row.value)}</span> },
            ]} />
          )}
        </DetailCard>

        <DetailCard title="Journeys" flush description="Every journey this customer entered; open one for their timeline through it.">
          {journeys.length === 0 && suppressed.length === 0 ? <div className="p-6"><EmptyState title="No journeys yet" hint="They have not met any journey’s entry." variant="plain" /></div> : (
            <>
              {journeys.length > 0 && (
                <DataTable rows={journeys} rowKey={(row) => row.enrollment_id} caption="Journeys entered" inset="card" framed={false} primary="journey" columns={[
                  { key: 'journey', header: 'Journey', render: (row) => <span className="flex flex-col"><Link to={`/journeys/${row.journey_id}`} className="font-medium text-ink-900 hover:underline">{row.journey_name}</Link><span className="text-xs font-normal text-ink-800">{titleize(row.journey_status)}</span></span> },
                  { key: 'entered', header: 'Entered', render: (row) => <span className="cep-num text-ink-800">{formatDateTime(row.enrolled_at)}<span className="block text-xs">version {row.version_number}</span></span> },
                  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} label={ENROLLMENT_LABEL[row.status] ?? row.status} /> },
                  { key: 'where', header: 'Where Now', render: (row) => (
                    <span className="text-ink-800">
                      {row.where ? <>{row.where.label}{row.where.next_scheduled_at && <span className="block text-xs">until {formatDateTime(row.where.next_scheduled_at)}</span>}</>
                        : row.exit_reason ? <span className="text-xs">{row.exit_reason}</span> : <span className="text-ink-300">—</span>}
                    </span>
                  ) },
                  { key: 'converted', header: 'Converted', render: (row) => (row.converted_at ? <Tag>{row.attributed_revenue ? formatMoney(row.attributed_revenue) : 'Converted'}</Tag> : <span className="text-ink-300">—</span>) },
                  { key: 'timeline', header: 'Timeline', render: (row) => <Link to={`/journeys/${row.journey_id}?customer=${encodeURIComponent(row.enrollment_id)}`} className="font-medium text-brand-600 hover:text-brand-700">View Timeline</Link> },
                ]} />
              )}
              {suppressed.length > 0 && (
                <p className="border-t border-line px-3 py-2 text-sm text-ink-800">
                  Kept out of {suppressed.map((row, index) => <span key={row.journey_id}>{index > 0 ? ', ' : ''}<Link to={`/journeys/${row.journey_id}`} className="font-medium text-ink-900 hover:underline">{row.journey_name}</Link>{row.note ? ` (${row.note})` : ''}</span>)} by a journey suppression.
                </p>
              )}
            </>
          )}
        </DetailCard>

        <DetailCard title="Events" flush description="The last 50 events received for this customer: what the shop, the app, the point of sale and C360 itself reported.">
          {events.length === 0 ? <p className="p-6 text-sm text-ink-800">No event has been received for this customer.</p> : (
            <DataTable rows={events} rowKey={(row) => String(row.id)} caption="Events received" inset="card" framed={false} primary="event" columns={[
              { key: 'event', header: 'Event', render: (row) => <span className="flex flex-col"><span className="font-medium text-ink-900">{row.label}</span><span className="text-xs font-normal text-ink-800">{row.event_type}{row.event_id ? ` · ${row.event_id}` : ''}</span></span> },
              { key: 'happened', header: 'Happened', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDateTime(row.occurred_at)}</span> },
              { key: 'source', header: 'Source', render: (row) => <Tag>{row.source}</Tag> },
              { key: 'data', header: 'Data', render: (row) => <span className="text-ink-800">{Object.keys(row.payload).length === 0 ? '—' : Object.entries(row.payload).map(([key, value]) => `${key}: ${words(value)}`).join(' · ')}</span> },
            ]} />
          )}
        </DetailCard>

        <DetailCard title="Orders" flush description="The last 20 orders Attribution received for this customer, and which campaign each was credited to.">
          {orders.length === 0 ? <p className="p-6 text-sm text-ink-800">No order has been received for this customer.</p> : (
            <DataTable rows={orders} rowKey={(row) => `${row.kind}-${row.order_ref}`} caption="Orders" inset="card" framed={false} primary="order" columns={[
              { key: 'order', header: 'Order', render: (row) => <span className="cep-num font-medium text-ink-900">{row.order_ref}{row.kind === 'REFUND' ? <span className="ml-2 text-xs font-normal text-ink-800">refund</span> : null}</span> },
              { key: 'placed', header: 'Placed', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDateTime(row.ordered_at)}</span> },
              { key: 'amount', header: 'Amount', align: 'right', render: (row) => <span className="cep-num text-ink-900">{formatMoney(row.amount)}</span> },
              { key: 'channel', header: 'Channel', render: (row) => <Tag>{titleize(row.channel)}</Tag> },
              { key: 'credited', header: 'Credited To', render: (row) => <span className="text-ink-800">{row.campaign_id ? <Link to={`/campaigns/${row.campaign_id}`} className="font-medium text-ink-900 hover:underline">{row.campaign_name ?? 'Campaign'}</Link> : titleize(row.status)}</span> },
            ]} />
          )}
        </DetailCard>

        <DetailCard title="Messages" flush description="The last 30 messages sent to this customer by campaigns and journeys, with what became of each.">
          {messages.length === 0 ? <p className="p-6 text-sm text-ink-800">No message has been sent to this customer.</p> : (
            <DataTable rows={messages.map((row, index) => ({ ...row, key: `${row.at}-${index}` }))} rowKey={(row) => row.key} caption="Messages sent" inset="card" framed={false} primary="campaign" columns={[
              { key: 'sent', header: 'Sent', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDateTime(row.at)}</span> },
              { key: 'campaign', header: 'Campaign', render: (row) => <span className="flex flex-col">{row.campaign_id ? <Link to={`/campaigns/${row.campaign_id}`} className="font-medium text-ink-900 hover:underline">{row.campaign_name ?? 'Campaign'}</Link> : <span>—</span>}{row.journey_generated && <span className="text-xs font-normal text-ink-800">journey message</span>}</span> },
              { key: 'channel', header: 'Channel', render: (row) => <Tag>{CHANNEL_LABEL[row.channel] ?? row.channel}</Tag> },
              { key: 'outcome', header: 'Outcome', render: (row) => (
                <span className="text-ink-800">
                  {MESSAGE_LABEL[row.status] ?? titleize(row.status)}{row.status_reason ? ` · ${row.status_reason.toLowerCase().replace(/_/g, ' ')}` : ''}
                  {row.opened_at ? ` · opened ${formatDateTime(row.opened_at)}` : row.delivered_at ? ` · delivered ${formatDateTime(row.delivered_at)}` : ''}{row.clicked_at ? ' · clicked' : ''}
                </span>
              ) },
            ]} />
          )}
        </DetailCard>

        <DetailCard title="Contact Lists" flush description="The lists this customer is on. Lists a journey makes for its own sends are left out.">
          {lists.length === 0 ? <p className="p-6 text-sm text-ink-800">On no contact list.</p> : (
            <DataTable rows={lists} rowKey={(row) => row.id} caption="Contact lists" inset="card" framed={false} primary="list" columns={[
              { key: 'list', header: 'List', render: (row) => <Link to={`/contact-lists/${row.id}`} className="font-medium text-ink-900 hover:underline">{row.name}</Link> },
              { key: 'added', header: 'Added', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDateTime(row.added_at)}</span> },
              { key: 'how', header: 'How', render: (row) => <Tag>{titleize(row.membership_source)}</Tag> },
            ]} />
          )}
        </DetailCard>
        <p className="text-helper text-ink-800"><Link to="/customers" className={buttonSecondary}>Find Another Customer</Link></p>
      </div>
    </section>
  )
}
