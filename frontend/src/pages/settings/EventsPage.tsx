/**
 * Settings → Events: what the shop, the loyalty system and CEP itself tell journeys about customers. Where to send events
 * (POST /events/ with an events:ingest key), which events CEP raises on its own, the last seven days by type, the latest
 * events, and the coupon requests journeys leave for C360 to fulfil.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { Field, Select, TextInput } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { api, session } from '@/lib/api'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import type { EventsSettings, JourneyEventRow } from '@/lib/types'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const SETTINGS_KEY = ['workspace', 'events']
const RECENT_KEY = ['workspace', 'events', 'recent']

export function EventsPage() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => api.get<EventsSettings>('/workspace/events/', undefined, signal), refetchInterval: 60_000 })

  if (settings.isError) return <ErrorState title="The events could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = settings.data

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Events</h2>
        <p className="mt-0.5 max-w-4xl text-sm text-ink-800">
          What happened to a customer: a purchase, an abandoned cart, a birthday, a tier change. The shop and the loyalty system send events here,
          and CEP raises some itself. A journey whose trigger is an event enrols the customer within a minute; a Condition step can check for one.
        </p>
      </div>
      {!data.journeys_enabled && <Notice tone="warning">Journeys are not part of this workspace, so events are refused. Ask the platform team to enable them.</Notice>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-5">
          <SummaryCard data={data} />
          <BuiltInCard />
        </div>
        <div className="min-w-0 space-y-5">
          <ConnectCard data={data} />
          <CouponsCard data={data} />
        </div>
      </div>

      <RecentCard data={data} />
    </div>
  )
}

function SummaryCard({ data }: { data: EventsSettings }) {
  const s = data.summary
  return (
    <section aria-labelledby="events-summary" className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="events-summary" className="font-display text-card-heading font-semibold text-ink-900">Last {s.days} Days</h3>
        <span className="text-helper text-ink-800">{s.last_received_at ? `Last event ${formatRelative(s.last_received_at)}` : 'No event received yet'}</span>
      </div>
      <p className="mt-3 cep-num text-card-title font-semibold text-ink-900">{formatNumber(s.total)} event{s.total === 1 ? '' : 's'}</p>
      {s.by_type.length > 0 ? (
        <ul className="mt-3 divide-y divide-line-subtle">
          {s.by_type.map((row) => (
            <li key={row.event_type} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-ink-900">{row.label} <span className="text-helper text-ink-800">{row.event_type}</span></span>
              <span className="cep-num text-ink-800">{formatNumber(row.count)} · {formatRelative(row.last_received_at)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-ink-800">Nothing in the last {s.days} days.</p>}
      {s.unknown_customers > 0 && (
        <p className="mt-3 text-sm text-ink-800">
          {formatNumber(s.unknown_customers)} event{s.unknown_customers === 1 ? ' names' : 's name'} a customer CEP does not have yet. They enter journeys once the customer
          arrives from C360, within seven days of the event.
        </p>
      )}
    </section>
  )
}

function BuiltInCard() {
  const rows: [string, string][] = [
    ['Purchase, First Purchase', 'Every order the shop sends to Attribution, and every store sale when Attribution counts them. First Purchase is the customer’s first order.'],
    ['Coupon Issue', 'Every Issue Coupon step of a journey, when it asks C360 for the coupon.'],
    ['Email Open/Click', 'Read from CEP’s own tracking of its emails; security scanners are left out. Nothing to send.'],
    ['SMS Response', 'Read from the replies to CEP’s texts. Nothing to send.'],
  ]
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h3 className="font-display text-card-heading font-semibold text-ink-900">Raised by CEP Itself</h3>
      <dl className="mt-3 space-y-3 text-sm">
        {rows.map(([name, text]) => (
          <div key={name}>
            <dt className="font-semibold text-ink-900">{name}</dt>
            <dd className="text-ink-800">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-800">
        Purchases need <Link to="/settings/attribution" className="font-semibold text-brand-800 hover:underline">Attribution</Link> switched on and the shop sending orders.
      </p>
    </section>
  )
}

function ConnectCard({ data }: { data: EventsSettings }) {
  const [copied, setCopied] = useState('')
  const copy = (what: string, text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(what), () => undefined)
  const example = JSON.stringify({ event_type: 'CART_ABANDON', event_id: 'cart-77812', party_id: 'C-88213', occurred_at: '2026-10-06T09:30:00Z',
                                   payload: { cart_value: 84.5, items: 3, cart_url: 'https://shop.example/cart/77812' } }, null, 2)
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h3 className="font-display text-card-heading font-semibold text-ink-900">Send Events</h3>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Endpoint (POST, JSON)</dt>
          <dd className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-subtle px-3 py-2"><code className="min-w-0 break-all text-ink-900">{data.endpoint}</code>
            <button type="button" className="shrink-0 text-sm font-semibold text-brand-800 hover:underline" onClick={() => copy('endpoint', data.endpoint)}>{copied === 'endpoint' ? 'Copied' : 'Copy'}</button></dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Headers</dt>
          <dd className="mt-1 text-ink-800"><code>Authorization: Bearer &lt;the API key&gt;</code> and <code>X-Tenant: {session.tenant}</code>.</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">API Key</dt>
          <dd className="mt-1 text-ink-800">
            A key with the scope <code>{data.scope}</code>, made under <Link to="/settings/api-keys" className="font-semibold text-brand-800 hover:underline">API Keys</Link>.{' '}
            {data.keys_with_scope ? `${formatNumber(data.keys_with_scope)} active key${data.keys_with_scope === 1 ? ' has' : 's have'} it.` : 'No key has it yet.'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">One Event</dt>
          <dd className="mt-1">
            <pre className="overflow-x-auto rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs text-ink-900">{example}</pre>
            <p className="mt-2 text-ink-800">
              <code>event_type</code> is required, and the customer by <code>party_id</code>, <code>email</code> or <code>phone</code> (an email or number must match a customer).
              With <code>event_id</code>, an event sent twice counts once. <code>occurred_at</code> defaults to now; <code>payload</code> holds the details.
              Up to 500 at once as <code>{'{"events": [...]}'}</code>.
            </p>
          </dd>
        </div>
      </dl>
    </section>
  )
}

function CouponsCard({ data }: { data: EventsSettings }) {
  const c = data.coupons
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h3 className="font-display text-card-heading font-semibold text-ink-900">Coupon Requests for C360</h3>
      <p className="mt-1 text-sm text-ink-800">
        A journey’s Issue Coupon step asks C360 for the coupon: C360 reads the open requests and marks each one issued, with the customer’s own code when it has one.
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {([['Waiting', c.requested], ['Issued', c.issued], ['Failed', c.failed]] as const).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">{label}</dt>
            <dd className="cep-num text-card-title font-semibold text-ink-900">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-800">
        <code>GET {c.endpoint}</code> lists the waiting requests; <code>PATCH …/&lt;id&gt;/</code> with <code>{'{"status": "ISSUED", "external_code": "…"}'}</code> marks one done.
        The key needs the scope <code>{c.scope}</code>{c.keys_with_scope ? '' : '; no key has it yet'}.
      </p>
    </section>
  )
}

function RecentCard({ data }: { data: EventsSettings }) {
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const recent = useQuery({
    queryKey: [...RECENT_KEY, { type, q }],
    queryFn: ({ signal }) => api.get<{ results: JourneyEventRow[] }>('/workspace/events/recent/', { type: type || undefined, q: q || undefined }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
  const rows = recent.data?.results ?? []
  const columns: Column<JourneyEventRow>[] = [
    { key: 'received', header: 'Received', render: (row) => <span className="cep-num whitespace-nowrap">{formatDateTime(row.received_at)}</span> },
    { key: 'event', header: 'Event', render: (row) => <span className="flex flex-col"><span className="font-semibold text-ink-900">{row.label}</span>
      <span className="text-xs text-ink-800">{row.event_type}{row.event_id ? ` · ${row.event_id}` : ''}</span></span> },
    { key: 'customer', header: 'Customer', render: (row) => <span className="flex flex-col"><span className="text-ink-900">{row.customer_name || row.party_id}</span>
      {row.customer_name ? <span className="text-xs text-ink-800">{row.party_id}</span> : <span className="text-xs text-ink-800">Not in the customer records yet</span>}</span> },
    { key: 'source', header: 'Source', render: (row) => <Tag>{row.source}</Tag> },
    { key: 'occurred', header: 'Happened', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDateTime(row.occurred_at)}</span>, phoneOptional: true },
  ]
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line-subtle px-4 py-3">
        <h3 className="font-display text-card-heading font-semibold text-ink-900">Latest Events</h3>
        <p className="mt-1 text-sm text-ink-800">The newest 50, sent or raised by CEP. Opens, clicks and text replies are read from tracking and do not appear here.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3 border-b border-line-subtle px-4 py-3" onSubmit={(event: FormEvent) => event.preventDefault()}>
        <Field label="Type">
          {(ids) => <Select {...ids} controlSize="sm" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All</option>
            {data.types.filter((t) => !t.from_tracking).map((t) => <option key={t.event_type} value={t.event_type}>{t.label}</option>)}
          </Select>}
        </Field>
        <Field label="Search">{(ids) => <TextInput {...ids} controlSize="sm" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, event id or source" />}</Field>
      </form>
      {recent.isError ? <div className="p-4"><ErrorState error={recent.error} onRetry={() => void recent.refetch()} /></div>
      : recent.isPending ? <p className="flex items-center gap-2 p-4 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
      : rows.length === 0 ? <div className="p-4"><EmptyState title="No Events Yet" variant="plain" hint={type || q ? 'Nothing matches these filters.' : 'The first event sent here appears within a minute.'} /></div>
      : <DataTable columns={columns} rows={rows} rowKey={(row) => String(row.id)} caption="Latest events" framed={false} phone="table" />}
    </section>
  )
}
