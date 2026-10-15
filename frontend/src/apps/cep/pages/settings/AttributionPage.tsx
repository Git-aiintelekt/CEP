/**
 * Settings → Attribution: whether orders are credited to campaigns, the windows a click, an open and a text count for, the send
 * costs behind ROI, where the shop sends its orders, the last 30 days, and the latest orders with the campaign each one earned
 * (or why none). Home, Reports and each campaign's results read the figures this fills.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonPrimary, buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import { SaveTick } from '@/components/SaveTick'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag, type TagTone } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError, session } from '@/lib/api'
import { formatDateTime, formatMoney, formatNumber, formatPercent, formatRelative } from '@/lib/format'
import type { AttributedOrder, AttributionSettings, AttributionSettingsInput, TouchType } from '@/lib/types'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const ATTRIBUTION_KEY = ['workspace', 'attribution']
const ORDERS_KEY = ['workspace', 'attribution', 'orders']
const TOUCH_LABEL: Record<TouchType, string> = { CODE: 'Campaign Code', CLICK: 'Click', OPEN: 'Open', TEXT: 'Text', REFUND: 'Refund' }
const STATUS_TONE: Record<AttributedOrder['status'], TagTone> = { ATTRIBUTED: 'success', UNATTRIBUTED: 'neutral', PENDING: 'warning' }
const STATUS_LABEL: Record<AttributedOrder['status'], string> = { ATTRIBUTED: 'Credited', UNATTRIBUTED: 'Not Credited', PENDING: 'Waiting' }

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`)

/** tick: the "Saved" confirmation, just before the control */
function Setting({ id, title, text, tick, children }: { id: string; title: string; text: ReactNode; tick?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 border-b border-line-subtle py-4 last:border-b-0">
      <div className="min-w-0 max-w-xl">
        <p id={`${id}-title`} className="text-sm font-semibold text-ink-900">{title}</p>
        <p id={`${id}-help`} className="text-sm text-ink-800">{text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">{tick}{children}</div>
    </div>
  )
}

/** canEdit: the /dev/settings playground shows the page as an administrator sees it, without a sign-in */
export function AttributionPage({ canEdit }: { canEdit?: boolean } = {}) {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const isAdmin = canEdit ?? can('user.admin')
  const settings = useQuery({ queryKey: ATTRIBUTION_KEY, queryFn: ({ signal }) => api.get<AttributionSettings>('/attribution/settings/', undefined, signal), refetchInterval: 60_000 })
  const save = useMutation({
    mutationFn: (body: AttributionSettingsInput) => api.put<AttributionSettings>('/attribution/settings/', body),
    onSuccess: (next) => { queryClient.setQueryData(ATTRIBUTION_KEY, next); void queryClient.invalidateQueries({ queryKey: ORDERS_KEY }) },
  })

  if (settings.isError) return <ErrorState title="The attribution settings could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = settings.data
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const locked = save.isPending || !isAdmin

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Attribution</h2>
        <p className="mt-0.5 max-w-4xl text-sm text-ink-800">
          Which campaign earned an order. The shop sends its orders here; each is credited to one campaign: the one named by a campaign code, else the person's last click,
          open or text before the order. Home, Reports and each campaign's results then show attributed revenue, ROI and progress against revenue targets.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-5">
          <section aria-label="Attribution Rules" className="rounded-lg border border-line bg-surface px-5">
            <Setting id="enabled" title="Attribution" tick={<SaveTick mutation={save} field="enabled" />} text={data.enabled
              ? `On since ${formatDateTime(data.enabled_at)}. Orders sent from the shop are credited every five minutes.`
              : 'Off: orders are refused and revenue reads Not Set Up. Turn it on, then send orders from the shop.'}>
              <Switch checked={data.enabled} disabled={locked} onChange={(next) => save.mutate({ enabled: next })} labelledBy="enabled-title" describedBy="enabled-help" />
            </Setting>
            <Setting id="click" title="Click Window" tick={<SaveTick mutation={save} field="click_days" />} text="A click on a campaign's link takes the credit for an order the same person places within this time.">
              <div className="w-44"><Select aria-labelledby="click-title" aria-describedby="click-help" value={String(data.click_days)} disabled={locked} invalid={Boolean(errors.click_days)}
                onChange={(event) => save.mutate({ click_days: Number(event.target.value) })}>
                {data.choices.click_days.map((n) => <option key={n} value={n}>{days(n)}</option>)}
              </Select></div>
            </Setting>
            <Setting id="open" title="Open Window" tick={<SaveTick mutation={save} field="open_days" />} text="With no click, an open of a marketing email takes the credit within this time. E-receipts never earn credit for being read.">
              <div className="w-44"><Select aria-labelledby="open-title" aria-describedby="open-help" value={String(data.open_days)} disabled={locked}
                onChange={(event) => save.mutate({ open_days: Number(event.target.value) })}>
                {data.choices.open_days.map((n) => <option key={n} value={n}>{n === 0 ? 'Opens Do Not Count' : days(n)}</option>)}
              </Select></div>
            </Setting>
            <Setting id="text" title="Text Window" tick={<SaveTick mutation={save} field="text_days" />} text="With no click or open, a marketing text delivered to the person takes the credit within this time. Text links are not tracked yet, so delivery stands in for a click.">
              <div className="w-44"><Select aria-labelledby="text-title" aria-describedby="text-help" value={String(data.text_days)} disabled={locked}
                onChange={(event) => save.mutate({ text_days: Number(event.target.value) })}>
                {data.choices.text_days.map((n) => <option key={n} value={n}>{n === 0 ? 'Texts Do Not Count' : days(n)}</option>)}
              </Select></div>
            </Setting>
            {data.store_sales_available && (
              <Setting id="store" title="Count Store Sales" tick={<SaveTick mutation={save} field="store_sales" />} text={<>Every transaction the point of sale posts under <Link to="/settings/pos" className="font-semibold text-brand-800 hover:underline">POS Receipts</Link> also becomes an order: the amount without tax, the customer, the store and its promotion codes. Off, nothing about a transaction is kept.</>}>
                <Switch checked={data.store_sales} disabled={locked || !data.enabled} onChange={(next) => save.mutate({ store_sales: next })} labelledBy="store-title" describedBy="store-help" />
              </Setting>
            )}
            {save.isError && <div className="py-4"><ErrorState title="The setting was not changed" error={save.error} /></div>}
          </section>

          <CostsCard data={data} disabled={!isAdmin} onSaved={(next) => queryClient.setQueryData(ATTRIBUTION_KEY, next)} />
        </div>

        <div className="min-w-0 space-y-5">
          <SummaryCard data={data} isAdmin={isAdmin} />
          <ConnectCard data={data} />
        </div>
      </div>

      <OrdersCard enabled={data.enabled} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------- costs
function CostsCard({ data, disabled, onSaved }: { data: AttributionSettings; disabled: boolean; onSaved: (next: AttributionSettings) => void }) {
  const [email, setEmail] = useState(data.email_cost_per_1000 === null ? '' : String(data.email_cost_per_1000))
  const [text, setText] = useState(data.text_cost_per_1000 === null ? '' : String(data.text_cost_per_1000))
  const toast = useToast()
  const save = useMutation({
    mutationFn: () => api.put<AttributionSettings>('/attribution/settings/', { email_cost_per_1000: email.trim() || null, text_cost_per_1000: text.trim() || null }),
    onSuccess: (next) => {
      const anyRate = next.email_cost_per_1000 !== null || next.text_cost_per_1000 !== null
      toast.success('Send costs saved', anyRate ? 'ROI now uses these rates.' : "ROI uses each campaign's planned cost.")
      onSaved(next)
    },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const changed = email !== (data.email_cost_per_1000 === null ? '' : String(data.email_cost_per_1000)) || text !== (data.text_cost_per_1000 === null ? '' : String(data.text_cost_per_1000))
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate() }
  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-surface p-5">
      <h3 className="font-display text-card-heading font-semibold text-ink-900">Send Costs</h3>
      <p className="mt-1 mb-4 text-sm text-ink-800">What a delivered message costs, for ROI. A campaign's cost is its delivered messages at these rates plus its offer cost. Left empty, ROI uses each campaign's planned cost.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Email, per 1,000 Delivered (${data.currency})`} error={errors.email_cost_per_1000}>
          {(ids) => <TextInput {...ids} inputMode="decimal" value={email} disabled={disabled || save.isPending} onChange={(event) => setEmail(event.target.value)} placeholder="0.85" />}
        </Field>
        <Field label={`Text, per 1,000 Delivered (${data.currency})`} error={errors.text_cost_per_1000}>
          {(ids) => <TextInput {...ids} inputMode="decimal" value={text} disabled={disabled || save.isPending} onChange={(event) => setText(event.target.value)} placeholder="7.50" />}
        </Field>
      </div>
      {save.isError && <div className="mt-3 empty:hidden"><ErrorState title="The costs were not saved" error={save.error} shownFields={['email_cost_per_1000', 'text_cost_per_1000']} /></div>}
      <div className="mt-4 flex justify-end">
        <button type="submit" className={buttonPrimary} disabled={disabled || save.isPending || !changed}>Save Costs</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------------- the last 30 days
function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">{label}</dt>
      <dd className="mt-0.5 cep-num text-card-title font-semibold text-ink-900">{value}</dd>
      {note && <dd className="text-helper text-ink-800">{note}</dd>}
    </div>
  )
}

function SummaryCard({ data, isAdmin }: { data: AttributionSettings; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState('')
  const recalc = useMutation({
    mutationFn: () => api.post<{ reset: number; attributed: number; unattributed: number; campaigns: number; remaining: number }>('/attribution/recalculate/'),
    onSuccess: (result) => {
      setOutcome(`${formatNumber(result.reset)} orders judged again: ${formatNumber(result.attributed)} credited, ${formatNumber(result.unattributed)} not; ${formatNumber(result.campaigns)} campaigns updated.`
        + (result.remaining ? ` ${formatNumber(result.remaining)} more within five minutes.` : ''))
      void queryClient.invalidateQueries({ queryKey: ATTRIBUTION_KEY })
    },
  })
  const s = data.summary
  const money = (value: number) => formatMoney(value, { whole: true })
  return (
    <section aria-labelledby="attribution-summary" className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="attribution-summary" className="font-display text-card-heading font-semibold text-ink-900">Last {s.days} Days</h3>
        <span className="text-helper text-ink-800">{s.last_received_at ? `Last order ${formatRelative(s.last_received_at)}` : 'No order received yet'}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Figure label="Orders" value={formatNumber(s.orders)} note={s.store_orders ? `${formatNumber(s.store_orders)} from stores, all time` : undefined} />
        <Figure label="Revenue" value={money(s.revenue)} note="Net of refunds" />
        <Figure label="Credited" value={money(s.attributed_revenue)} note={s.attributed_share === null ? 'No orders yet' : `${formatPercent(s.attributed_share)} of orders`} />
        <Figure label="Not Credited" value={formatNumber(s.unattributed)} note={s.pending ? `${formatNumber(s.pending)} waiting` : 'None waiting'} />
      </dl>
      <h4 className="mt-5 text-xs font-semibold tracking-wide text-ink-800 uppercase">Credited By</h4>
      <ul className="mt-2 divide-y divide-line-subtle">
        {(['CODE', 'CLICK', 'OPEN', 'TEXT'] as const).map((touch) => (
          <li key={touch} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-ink-900">{TOUCH_LABEL[touch]}</span>
            <span className="cep-num text-ink-800">{formatNumber(s.by_touch[touch].orders)} orders · {money(s.by_touch[touch].revenue)}</span>
          </li>
        ))}
      </ul>
      {s.top_campaigns.length > 0 && (
        <>
          <h4 className="mt-5 text-xs font-semibold tracking-wide text-ink-800 uppercase">Top Campaigns</h4>
          <ul className="mt-2 divide-y divide-line-subtle">
            {s.top_campaigns.map((campaign) => (
              <li key={campaign.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/campaigns/${campaign.id}`} className="min-w-0 truncate font-semibold text-ink-900 hover:underline">{campaign.name}</Link>
                <span className="cep-num shrink-0 text-ink-800">{money(campaign.revenue)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {isAdmin && data.enabled && (
        <div className="mt-5 border-t border-line-subtle pt-4">
          <p className="text-sm text-ink-800">After changing a window, judge the last 400 days of orders again under the new rules.</p>
          <button type="button" className={`${buttonSecondary} mt-3`} disabled={recalc.isPending} onClick={() => recalc.mutate()}>{recalc.isPending ? 'Recalculating' : 'Recalculate'}</button>
          {outcome && <p role="status" className="mt-2 text-sm text-ink-900">{outcome}</p>}
          {recalc.isError && <div className="mt-3"><ErrorState title="Not recalculated" error={recalc.error} /></div>}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------------- connecting the shop
function ConnectCard({ data }: { data: AttributionSettings }) {
  const [copied, setCopied] = useState('')
  const copy = (what: string, text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(what), () => undefined)
  const example = JSON.stringify({ order_id: 'W-100234', amount: 129.5, currency: data.currency, ordered_at: '2026-10-04T14:30:00Z', email: 'jane@example.com', party_id: 'C-88213',
                                   channel: 'ONLINE', coupon_codes: ['FALL15'] }, null, 2)
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h3 className="font-display text-card-heading font-semibold text-ink-900">Send Orders from the Shop</h3>
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
          <dt className="text-xs font-semibold tracking-wide text-ink-800 uppercase">One Order</dt>
          <dd className="mt-1">
            <pre className="overflow-x-auto rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs text-ink-900">{example}</pre>
            <p className="mt-2 text-ink-800">
              <code>order_id</code> and <code>amount</code> (the revenue to count, without tax and shipping) are required. Name the person by <code>party_id</code>, <code>email</code> or <code>phone</code>.
              <code> campaign_code</code> or a coupon equal to a campaign's code credits that campaign outright. A refund is <code>{'"type": "REFUND"'}</code> with a positive amount and <code>original_order_id</code>.
              Up to 500 at once as <code>{'{"orders": [...]}'}</code>; an order sent twice counts once.
            </p>
          </dd>
        </div>
      </dl>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------------- the latest orders
function OrdersCard({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const orders = useQuery({
    queryKey: [...ORDERS_KEY, { status, q }],
    queryFn: ({ signal }) => api.get<{ results: AttributedOrder[] }>('/attribution/orders/', { status: status || undefined, q: q || undefined }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
  const rows = orders.data?.results ?? []
  const columns: Column<AttributedOrder>[] = [
    { key: 'at', header: 'Ordered', render: (row) => <span className="cep-num whitespace-nowrap">{formatDateTime(row.ordered_at)}</span> },
    { key: 'order', header: 'Order', render: (row) => <span className="flex flex-col"><span className="cep-num font-semibold text-ink-900">{row.order_id}</span>
      <span className="text-xs text-ink-800">{row.kind === 'REFUND' ? 'Refund' : row.source === 'POS' ? `Store ${row.store_number ?? ''}`.trim() : row.channel.charAt(0) + row.channel.slice(1).toLowerCase()}{row.email ? ` · ${row.email}` : row.party_id ? ` · ${row.party_id}` : ''}</span></span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (row) => <span className="cep-num whitespace-nowrap text-ink-900">{formatMoney(row.amount)}</span> },
    { key: 'credit', header: 'Credited To', render: (row) => row.status === 'ATTRIBUTED' && row.campaign_id
      ? <span className="flex flex-col gap-0.5"><Link to={`/campaigns/${row.campaign_id}`} className="font-semibold text-ink-900 hover:underline">{row.campaign_name}</Link>
          <span className="text-xs text-ink-800">{TOUCH_LABEL[row.touch_type ?? 'CLICK']}{row.touch_at && row.touch_type !== 'CODE' ? ` · ${formatDateTime(row.touch_at)}` : ''}</span></span>
      : <span className="flex flex-col gap-0.5"><span><Tag tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Tag></span>{row.note && <span className="max-w-sm text-xs text-ink-800">{row.note}</span>}</span> },
  ]
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line-subtle px-4 py-3">
        <h3 className="font-display text-card-heading font-semibold text-ink-900">Latest Orders</h3>
        <p className="mt-1 text-sm text-ink-800">The newest 50, with the campaign each was credited to, or why none. An order waits a minute before it is judged, so a click still on its way is counted.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3 border-b border-line-subtle px-4 py-3" onSubmit={(event: FormEvent) => event.preventDefault()}>
        <Field label="State">
          {(ids) => <Select {...ids} controlSize="sm" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option><option value="ATTRIBUTED">Credited</option><option value="UNATTRIBUTED">Not Credited</option><option value="PENDING">Waiting</option>
          </Select>}
        </Field>
        <Field label="Search">{(ids) => <TextInput {...ids} controlSize="sm" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order, email or campaign" />}</Field>
      </form>
      {orders.isError ? <div className="p-4"><ErrorState error={orders.error} onRetry={() => void orders.refetch()} /></div>
      : orders.isPending ? <p className="flex items-center gap-2 p-4 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
      : rows.length === 0 ? <div className="p-4"><EmptyState title="No Orders Yet" variant="plain"
          hint={status || q ? 'Nothing matches these filters.' : enabled ? 'The first order the shop sends appears here within a minute.' : 'Turn attribution on, then send orders from the shop.'} /></div>
      : <DataTable columns={columns} rows={rows} rowKey={(row) => String(row.id)} caption="Latest orders" framed={false} phone="table" />}
    </section>
  )
}
