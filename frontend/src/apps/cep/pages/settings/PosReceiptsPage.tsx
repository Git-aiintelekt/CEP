/**
 * Settings → POS Receipts: what the point of sale must be told (endpoint, headers, key), which e-receipt campaign its
 * transactions go out on, the workspace's stores (the STORE tags of a receipt), and the trail of what was received — read
 * from the integration log, because C360 stores nothing about a transaction or a customer.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonDanger, buttonPrimary, buttonSecondary, Field, Select, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SaveTick } from '@/components/SaveTick'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag, type TagTone } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { api, ApiError, request } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { saveFailure } from '@/lib/saveFeedback'
import type { PosReceivedPage, PosSettings, Store, StoreInput } from '@/lib/types'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const KEY = ['workspace', 'pos']
const STORES = ['stores']
const RECEIVED = ['workspace', 'pos', 'received']
const POS_FIELDS = ['campaign', 'return_campaign', 'text_campaign', 'default_country']
const POS_FAILED = 'The setting was not saved'
const CODE_TONE: Record<string, TagTone> = { S100: 'success', S101: 'warning', S102: 'neutral', S103: 'success', S104: 'neutral', S105: 'warning' }
const EMPTY_STORE: StoreInput = { store_number: '', name: '', brand: '', address1: '', address2: '', city: '', state: '', postal_code: '', country: '', district: '', phone: '', email: '', manager: '',
                                  return_policy: '', url1: '', url2: '', url3: '', url4: '', image_url: '', is_active: true }

export function PosReceiptsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<PosSettings>('/workspace/pos/', undefined, signal) })
  const save = useMutation({
    mutationFn: (body: { campaign?: string | null; return_campaign?: string | null; text_campaign?: string | null; default_country?: string }) => api.put<PosSettings>('/workspace/pos/', body),
    onSuccess: (next) => queryClient.setQueryData(KEY, next),
  })
  const [copied, setCopied] = useState('')
  const copy = (what: string, text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(what), () => undefined)

  if (settings.isError) return <ErrorState title="The POS settings could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
  const data = settings.data
  const errors = save.error instanceof ApiError && save.error.status === 400 ? saveFailure(save.error, POS_FAILED, POS_FIELDS).fields : {}
  const emailCampaigns = data.campaigns.filter((c) => c.channel !== 'SMS' && c.channel !== 'MMS')
  const textCampaigns = data.campaigns.filter((c) => c.channel === 'SMS' || c.channel === 'MMS')

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">POS Receipts</h2>
        <p className="mt-0.5 text-sm text-ink-500">The point of sale posts each transaction here as TransactionTree TTDR 3.2.2 XML; C360 renders the e-receipt on the campaign below and sends it. The transaction and the customer are not kept, only what was received and what was sent, unless <Link to="/settings/attribution" className="font-semibold text-brand-800 hover:underline">Attribution</Link> counts store sales.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <section className="rounded-lg border border-line bg-surface p-5">
            <h3 className="font-display text-card-heading font-semibold text-ink-900">E-Receipt Campaign</h3>
            <p className="mt-1 text-sm text-ink-500">Transactions go out on this campaign's template and sender. It must be published to production with a verified sender.</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Field label="Email Receipt" required error={errors.campaign} labelEnd={<SaveTick mutation={save} field="campaign" />} hint="Sent when the transaction's EntryType asks for EMAIL (or BOTH, ALL, EMAIL_SMS…).">
                {(ids) => <Select {...ids} value={data.campaign ?? ''} onChange={(event) => save.mutate({ campaign: event.target.value || null })}>
                  <option value="">{emailCampaigns.filter((c) => c.ready).length === 1 ? 'The one published campaign' : 'Choose a Campaign'}</option>
                  {emailCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}{item.ready ? '' : ' (not published)'}</option>)}
                </Select>}
              </Field>
              <Field label="Returns and Exchanges" error={errors.return_campaign} labelEnd={<SaveTick mutation={save} field="return_campaign" />} hint="Leave empty to use the same campaign. A return renders as a refund: negative amounts, the tender as Refund to….">
                {(ids) => <Select {...ids} value={data.return_campaign ?? ''} onChange={(event) => save.mutate({ return_campaign: event.target.value || null })}>
                  <option value="">Same Campaign</option>
                  {emailCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}{item.ready ? '' : ' (not published)'}</option>)}
                </Select>}
              </Field>
              <Field label="Text Receipt" error={errors.text_campaign} labelEnd={<SaveTick mutation={save} field="text_campaign" />} hint="An e-receipt campaign on the SMS channel, sent when EntryType asks for SMS (SMS, EMAIL_SMS, SMS_LINK…). Empty: texts are accepted and answered S105.">
                {(ids) => <Select {...ids} value={data.text_campaign ?? ''} onChange={(event) => save.mutate({ text_campaign: event.target.value || null })}>
                  <option value="">{textCampaigns.filter((c) => c.ready).length === 1 ? 'The one published text campaign' : textCampaigns.length ? 'Choose a Campaign' : 'No text e-receipt campaign yet'}</option>
                  {textCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}{item.ready ? '' : ' (not published)'}</option>)}
                </Select>}
              </Field>
              <Field label="Phone Numbers Are From" error={errors.default_country} labelEnd={<SaveTick mutation={save} field="default_country" />} help="How a ten-digit number from a register is read: with +1 for US or CA. A number sent with its country code is used as sent. It decides whether a text receipt can be sent at all." hint="Ten-digit numbers from a US or CA register are read as +1…; numbers sent with a country code are used as they are.">
                {(ids) => <Select {...ids} value={data.default_country} onChange={(event) => save.mutate({ default_country: event.target.value })}>
                  <option value="US">United States (+1)</option><option value="CA">Canada (+1)</option><option value="GB">United Kingdom (+44)</option><option value="IN">India (+91)</option><option value="AU">Australia (+61)</option>
                </Select>}
              </Field>
            </div>
            {data.campaigns.length === 0 && <p className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-text">No e-receipt campaign exists yet. Create one under Campaigns (type E-Receipt), attach the receipt template and publish it.</p>}
            {save.isError && <div className="mt-3 empty:hidden"><ErrorState title={POS_FAILED} error={save.error} shownFields={POS_FIELDS} /></div>}
          </section>

          <StoresCard />
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border border-line bg-surface p-5">
            <h3 className="font-display text-card-heading font-semibold text-ink-900">Tell the Point of Sale</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Endpoint (POST, application/xml or the form field XmlInput)</dt>
                <dd className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-subtle px-3 py-2"><code className="min-w-0 break-all text-ink-900">{data.endpoint}</code>
                  <button type="button" className="shrink-0 text-sm font-semibold text-brand-800 hover:underline" onClick={() => copy('endpoint', data.endpoint)}>{copied === 'endpoint' ? 'Copied' : 'Copy'}</button></dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Headers</dt>
                <dd className="mt-1 text-ink-700"><code>X-Tenant-Key: {data.tenant_key}</code> and <code>accessTokenKey: &lt;the API key&gt;</code> — or <code>Authorization: Bearer &lt;the API key&gt;</code> with <code>X-Tenant: {data.tenant_key}</code>.</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">API Key</dt>
                <dd className="mt-1 text-ink-700">Create one under <Link to="/settings/api-keys" className="font-semibold text-brand-800 hover:underline">API Keys</Link> with the scope <code>{data.scope}</code>; it is shown once. Each workspace has its own key, and a revoked key stops the point of sale at once.</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Answers</dt>
                <dd className="mt-1 text-ink-700">XML: <code>S100</code> email receipt sent · <code>S101</code> accepted, no email address · <code>S102</code> already received · <code>S103</code> text receipt sent · <code>S104</code> no e-receipt asked for, nothing sent · <code>S105</code> text asked for but not sent (the message says why) · <code>E1xx</code> the document is refused (the message says where) · <code>E120</code> no campaign · <code>E888</code> wrong key · <code>E900</code> the engine did not accept it, call again later.</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-ink-500 uppercase">What triggers a receipt</dt>
                <dd className="mt-1 text-ink-700">The transaction's <code>EntryType</code>: <code>EMAIL</code>, <code>BOTH</code>, <code>ALL</code> and every <code>…EMAIL…</code> value send the email receipt; <code>SMS</code>, <code>SMS_LINK</code>, <code>ALL</code> and every <code>…SMS…</code> value send the text receipt (both when both are named — the text's outcome rides in the answer as <code>TEXT_STATUS</code>); <code>PRINT</code>, <code>NOPRINT</code>, <code>PUSH</code> and <code>NONE</code> are accepted and send nothing. A return or void renders as a refund; an exchange shows the returned lines as negatives.</dd>
              </div>
            </dl>
          </section>
          <ReceivedCard />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------- stores
function StoresCard() {
  const queryClient = useQueryClient()
  const stores = useQuery({ queryKey: STORES, queryFn: ({ signal }) => api.get<Store[]>('/stores/', undefined, signal) })
  const [editing, setEditing] = useState<Store | 'new' | null>(null)
  const [outcome, setOutcome] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const importCsv = useMutation({
    mutationFn: (chosen: File) => { const form = new FormData(); form.append('file', chosen); return request<{ added: number; updated: number; problems: string[] }>('/stores/import/', { method: 'POST', body: form }) },
    onSuccess: (result) => {
      setOutcome(`${formatNumber(result.added)} added, ${formatNumber(result.updated)} updated${result.problems.length ? `; ${formatNumber(result.problems.length)} line${result.problems.length === 1 ? '' : 's'} skipped: ${result.problems.slice(0, 3).join(' · ')}` : ''}.`)
      void queryClient.invalidateQueries({ queryKey: STORES }); void queryClient.invalidateQueries({ queryKey: KEY })
    },
  })
  const rows = stores.data ?? []
  const columns: Column<Store>[] = [
    { key: 'number', header: 'Store', render: (row) => <span><span className="block font-semibold text-ink-900">{row.store_number} · {row.name}</span>{row.brand && <span className="block text-xs text-ink-500">{row.brand}</span>}</span> },
    { key: 'address', header: 'Address', render: (row) => <span className="text-ink-700">{[row.address1, row.city, row.state, row.postal_code].filter(Boolean).join(', ') || '—'}</span>, phoneOptional: true },
    { key: 'phone', header: 'Phone', render: (row) => row.phone ?? '—', phoneOptional: true },
    { key: 'active', header: 'In Use', render: (row) => row.is_active ? <Tag tone="success">In Use</Tag> : <Tag>Off</Tag> },
    { key: 'edit', header: '', align: 'right', render: (row) => <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => setEditing(row)}>Edit</button> },
  ]
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
        <h3 className="font-display text-card-heading font-semibold text-ink-900">Stores</h3>
        <span className="flex gap-2">
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose a CSV of stores" onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) importCsv.mutate(chosen); event.target.value = '' }} />
          <button type="button" className={buttonSecondary} disabled={importCsv.isPending} onClick={() => file.current?.click()}><Upload size={16} strokeWidth={1.5} aria-hidden />Import CSV</button>
          <button type="button" className={buttonSecondary} onClick={() => setEditing('new')}>Add Store</button>
        </span>
      </div>
      <p className="px-4 pt-3 text-sm text-ink-500">A transaction names its store by number only. The store's details here fill the receipt's store tags (name, address, phone, manager, return policy, links). A CSV needs a header row with <code>store_number</code> and <code>name</code>; the other columns are optional and a listed store is updated.</p>
      {outcome && <p role="status" className="px-4 pt-2 text-sm text-ink-700">{outcome}</p>}
      {importCsv.isError && <div className="px-4 pt-2"><ErrorState title="The CSV was not imported" error={importCsv.error} /></div>}
      <div className="p-4">
        {stores.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
        : stores.isError ? <ErrorState error={stores.error} onRetry={() => void stores.refetch()} />
        : rows.length === 0 ? <EmptyState title="No Stores Yet" hint="Add the stores the point of sale sends transactions from, or import them from a CSV." variant="plain" />
        : <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption="Stores" inset="card" />}
      </div>
      {editing && <StoreForm store={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function StoreForm({ store, onClose }: { store: Store | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<StoreInput>(store ? { ...EMPTY_STORE, ...Object.fromEntries(Object.entries(store).map(([k, v]) => [k, v ?? ''])) as StoreInput, is_active: store.is_active } : EMPTY_STORE)
  const done = () => { void queryClient.invalidateQueries({ queryKey: STORES }); void queryClient.invalidateQueries({ queryKey: KEY }); onClose() }
  const body = () => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))
  const save = useMutation({
    mutationFn: () => store ? api.patch<Store>(`/stores/${store.id}/`, body()) : api.post<Store>('/stores/', body()),
    onSuccess: (saved) => { toast.success('Store saved', `Receipts from store ${saved.store_number} carry these details.`); done() },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/stores/${store?.id}/`),
    onSuccess: () => { toast.success('Store removed', `Receipts from store ${store?.store_number} carry only the number.`); done() },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : null
  const set = <K extends keyof StoreInput>(key: K, value: StoreInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const text = (key: Exclude<keyof StoreInput, 'is_active'>, label: string, extra?: { required?: boolean; hint?: string }) => (
    <Field key={key} label={label} required={extra?.required} error={errors[key]} hint={extra?.hint}>
      {(ids) => <TextInput {...ids} value={form[key] ?? ''} onChange={(event) => set(key, event.target.value)} />}
    </Field>
  )
  return (
    <Modal title={store ? `Store ${store.store_number}` : 'Add Store'} size="lg" scrollBody onClose={onClose}
      footer={<div className="flex flex-wrap items-center justify-between gap-2">
        <span>{store && <button type="button" className={buttonDanger} disabled={remove.isPending} onClick={() => window.confirm(`Remove store ${store.store_number}? Receipts from it will carry only the number.`) && remove.mutate()}>Remove</button>}</span>
        <span className="flex gap-2"><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" form="store-form" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save</button></span>
      </div>}>
      <form id="store-form" className="grid gap-4 lg:grid-cols-2" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
        {text('store_number', 'Store Number', { required: true, hint: 'Exactly as the point of sale sends it.' })}
        {text('name', 'Name', { required: true })}
        {text('brand', 'Brand')}
        {text('district', 'District')}
        {text('address1', 'Address 1')}
        {text('address2', 'Address 2')}
        {text('city', 'City')}
        {text('state', 'State')}
        {text('postal_code', 'Postal Code')}
        {text('country', 'Country')}
        {text('phone', 'Phone')}
        {text('email', 'Email')}
        {text('manager', 'Manager')}
        {text('image_url', 'Image URL')}
        {text('url1', 'URL 1')}
        {text('url2', 'URL 2')}
        {text('url3', 'URL 3')}
        {text('url4', 'URL 4')}
        <div className="lg:col-span-2">
          <Field label="Return Policy" error={errors.return_policy}>
            {(ids) => <TextArea {...ids} rows={2} value={form.return_policy ?? ''} onChange={(event) => set('return_policy', event.target.value)} />}
          </Field>
        </div>
        <div className="lg:col-span-2"><Switch checked={form.is_active} onChange={(is_active) => set('is_active', is_active)} label="In Use" /></div>
        {other !== null && <div className="lg:col-span-2"><ErrorState title="The store was not saved" error={other} /></div>}
        {remove.isError && <div className="lg:col-span-2"><ErrorState title="The store was not removed" error={remove.error} /></div>}
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- the trail
function ReceivedCard() {
  const [code, setCode] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const received = useQuery({
    queryKey: [...RECEIVED, { code, q }],
    queryFn: ({ signal }) => api.get<PosReceivedPage>('/workspace/pos/received/', { code: code || undefined, q: q || undefined }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const rows = received.data?.results ?? []
  const columns: Column<PosReceivedPage['results'][number]>[] = [
    { key: 'at', header: 'Received', render: (row) => <span className="cep-num whitespace-nowrap">{formatDateTime(row.at)}</span> },
    { key: 'id', header: 'Transaction', render: (row) => <span className="cep-num font-medium text-ink-900">{row.transaction_id ?? '—'}</span> },
    { key: 'code', header: 'Answer', render: (row) => <span className="flex flex-col gap-0.5"><span><Tag tone={CODE_TONE[row.code ?? ''] ?? 'error'}>{`${row.code ?? '—'} ${row.code_label ?? ''}`.trim()}</Tag></span>{row.message && <span className="max-w-xs truncate text-xs text-ink-500" title={row.message}>{row.message}</span>}</span> },
    { key: 'receipt', header: 'Receipt', render: (row) => row.execution_id ? <span className="cep-num text-xs text-ink-500">sent · {row.message_id ?? `#${row.execution_id}`}</span> : <span className="text-xs text-ink-500">—</span>, phoneOptional: true },
  ]
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line-subtle px-4 py-3">
        <h3 className="font-display text-card-heading font-semibold text-ink-900">Received from the Point of Sale</h3>
        <p className="mt-1 text-sm text-ink-500">The last {received.data?.days ?? 30} days, from the call log. Each row is one transaction posted and the answer it got; the receipt itself is on the campaign's Recipients tab, and the full XML under <Link to="/settings/integrations" className="font-semibold text-brand-800 hover:underline">Integrations</Link>.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3 border-b border-line-subtle px-4 py-3" onSubmit={(event: FormEvent) => event.preventDefault()}>
        <Field label="Answer">
          {(ids) => <Select {...ids} controlSize="sm" value={code} onChange={(event) => setCode(event.target.value)}>
            <option value="">All</option><option value="S100">S100 Receipt sent</option><option value="S101">S101 No email address</option><option value="S102">S102 Already received</option>
            <option value="S103">S103 Text receipt sent</option><option value="S104">S104 Printed, no e-receipt</option><option value="S105">S105 Text not sent</option>
            <option value="E103">E103 Document refused</option><option value="E120">E120 No campaign</option><option value="E900">E900 Engine refused</option>
          </Select>}
        </Field>
        <Field label="Transaction ID">{(ids) => <TextInput {...ids} controlSize="sm" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="243309" />}</Field>
      </form>
      {received.isError ? <div className="p-4"><ErrorState error={received.error} onRetry={() => void received.refetch()} /></div>
      : received.isPending ? <p className="flex items-center gap-2 p-4 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
      : rows.length === 0 ? <div className="p-4"><EmptyState title="Nothing Received Yet" hint={code || q ? 'Nothing matches these filters.' : 'The first transaction the point of sale posts appears here with the answer it got.'} variant="plain" /></div>
      : <DataTable columns={columns} rows={rows} rowKey={(row) => String(row.id)} caption="Received transactions" framed={false} phone="table" />}
      {received.data?.more && <p className="border-t border-line-subtle px-4 py-3 text-xs text-ink-500">Only the newest 100 are shown; narrow by answer or transaction id.</p>}
    </section>
  )
}
