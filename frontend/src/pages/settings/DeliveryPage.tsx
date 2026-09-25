import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { buttonPrimary, buttonSecondary, Field, Select, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { DeliveryProvider, DeliverySender, ProviderType } from '@/lib/types'

const PROVIDERS = ['delivery', 'providers']
const SENDERS = ['delivery', 'senders']

// ---------------------------------------------------------------------------------------------------- provider form
function ProviderForm({ catalogue, provider, onClose }: { catalogue: ProviderType[]; provider: DeliveryProvider | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const creatable = catalogue.filter((item) => item.manageable)
  const [type, setType] = useState(provider?.provider_type ?? creatable[0]?.provider_type ?? '')
  const [name, setName] = useState(provider?.name ?? '')
  const [config, setConfig] = useState<Record<string, string>>(provider?.config ?? {})
  const [secret, setSecret] = useState('')
  const [transactionalSecret, setTransactionalSecret] = useState('')
  const [dropTransactional, setDropTransactional] = useState(false)
  const [rate, setRate] = useState(provider?.rate_limit_per_minute ? String(provider.rate_limit_per_minute) : '')
  const [isDefault, setIsDefault] = useState(provider?.is_default ?? false)
  const [isActive, setIsActive] = useState(provider?.is_active ?? true)
  const spec = catalogue.find((item) => item.provider_type === type)

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), config, rate_limit_per_minute: rate ? Number(rate) : null, is_default: isDefault, is_active: isActive, ...(secret ? { secret } : {}),
        ...(transactionalSecret ? { transactional_secret: transactionalSecret } : {}), ...(dropTransactional && !transactionalSecret ? { drop_transactional_secret: true } : {}) }
      return provider ? api.patch<DeliveryProvider>(`/delivery-providers/${provider.id}/`, body) : api.post<DeliveryProvider>('/delivery-providers/', { ...body, provider_type: type })
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['delivery'] }); onClose() },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : null

  return (
    <Modal title={provider ? `Edit ${provider.name}` : 'Add a sending engine'} onClose={onClose} size="lg"
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="provider-form" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}{provider ? 'Save changes' : 'Add engine'}</button>
      </>}>
      <form id="provider-form" noValidate className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
        {other !== null && <ErrorState title="Could not save the provider" error={other} />}
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Engine" required error={errors.provider_type} hint={spec?.description}>
            {(ids) => <Select {...ids} value={type} disabled={Boolean(provider)} onChange={(event) => { setType(event.target.value); setConfig({}) }}>
              {(provider ? catalogue : creatable).map((item) => <option key={item.provider_type} value={item.provider_type}>{item.channel === 'SMS' ? 'Texts' : 'Email'} · {item.label}</option>)}
            </Select>}
          </Field>
          <Field label="Name" required error={errors.name} hint="How it appears in this workspace, e.g. SendGrid (marketing) or Texts (short code 55123).">
            {(ids) => <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />}
          </Field>
        </div>
        {spec?.fields.map((field) => {
          const second = field.secret && field.credential === 'transactional_secret'
          const stored = second ? Boolean(provider?.has_transactional_secret) && !dropTransactional : Boolean(provider?.has_secret)
          const error = errors[field.secret ? (second ? 'transactional_secret' : 'secret') : `config.${field.key}`] ?? errors[field.key]
          const hint = field.secret && stored ? (second ? 'A transactional key is stored. Leave this empty to keep it.' : 'A credential is stored. Leave this empty to keep it.') : field.help
          return (
            <Field key={field.key} label={field.label} required={field.required && !(field.secret && stored)} error={error} hint={hint}>
              {(ids) => second
                ? <div className="flex items-end gap-2">
                    <TextInput {...ids} type="password" value={transactionalSecret} onChange={(event) => setTransactionalSecret(event.target.value)} autoComplete="new-password" placeholder={stored ? '••••••••' : ''} />
                    {stored && <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setDropTransactional(true)}>Remove</button>}
                  </div>
                : field.secret
                ? <TextInput {...ids} type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" placeholder={provider?.has_secret ? '••••••••' : ''} />
                : field.kind === 'textarea'
                  ? <TextArea {...ids} rows={3} className="cep-num text-xs" value={config[field.key] ?? ''} onChange={(event) => setConfig({ ...config, [field.key]: event.target.value })} />
                  : <TextInput {...ids} value={config[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => setConfig({ ...config, [field.key]: event.target.value })} autoComplete="off" />}
            </Field>
          )
        })}
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Messages per minute" error={errors.rate_limit_per_minute} hint="Optional pace limit. Leave empty to send as fast as the provider accepts.">
            {(ids) => <TextInput {...ids} type="number" min={1} value={rate} onChange={(event) => setRate(event.target.value)} />}
          </Field>
          <div className="space-y-2 self-end pb-1 text-sm text-ink-900">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> Default engine for {spec?.channel === 'SMS' ? 'texts' : 'email'}</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> In use</label>
          </div>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- sender form
function SenderForm({ providers, sender, onClose }: { providers: DeliveryProvider[]; sender: DeliverySender | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const usable = providers.filter((item) => item.manageable !== false)
  const [provider, setProvider] = useState(sender?.delivery_provider ?? usable[0]?.id ?? '')
  const [name, setName] = useState(sender?.display_name ?? '')
  const [from, setFrom] = useState(sender?.from_address ?? '')
  const [senderId, setSenderId] = useState(sender?.sender_id ?? '')
  const [replyTo, setReplyTo] = useState(sender?.reply_to_address ?? '')
  const texts = usable.find((item) => item.id === provider)?.channel === 'SMS'
  const [isDefault, setIsDefault] = useState(sender?.is_default ?? false)
  const save = useMutation({
    mutationFn: () => {
      const body = texts ? { delivery_provider: provider, display_name: name.trim(), sender_id: senderId.trim(), is_default: isDefault }
        : { delivery_provider: provider, display_name: name.trim(), from_address: from.trim(), reply_to_address: replyTo.trim() || null, is_default: isDefault }
      return sender ? api.patch<DeliverySender>(`/delivery-senders/${sender.id}/`, body) : api.post<DeliverySender>('/delivery-senders/', body)
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['delivery'] }); onClose() },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : null
  return (
    <Modal title={sender ? `Edit ${sender.display_name}` : 'Add a sender'} onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="sender-form" className={buttonPrimary} disabled={save.isPending}>{sender ? 'Save changes' : 'Add sender'}</button>
      </>}>
      <form id="sender-form" noValidate className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
        {other !== null && <ErrorState title="Could not save the sender" error={other} />}
        <Field label="Sends through" required error={errors.delivery_provider}>
          {(ids) => <Select {...ids} value={provider} onChange={(event) => setProvider(event.target.value)}>
            {usable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>}
        </Field>
        <Field label={texts ? 'Name' : 'From name'} required error={errors.display_name} hint={texts ? 'How this sender is listed in campaigns, e.g. Northwind texts.' : 'What people see in their inbox, e.g. Northwind Rewards.'}>
          {(ids) => <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        {texts ? (
          <Field label="Sender number" required error={errors.sender_id} hint="The number texts come from: a short code (55123), a long number with country code (+14045550100) or an alphanumeric sender (up to 11 characters). It must be registered with your aggregator.">
            {(ids) => <TextInput {...ids} value={senderId} onChange={(event) => setSenderId(event.target.value)} autoComplete="off" />}
          </Field>
        ) : (<>
          <Field label="From address" required error={errors.from_address} hint="Must belong to a domain your provider is allowed to send for. Changing it needs a new verification.">
            {(ids) => <TextInput {...ids} type="email" value={from} onChange={(event) => setFrom(event.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Reply-to address" error={errors.reply_to_address}>
            {(ids) => <TextInput {...ids} type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} autoComplete="off" />}
          </Field>
        </>)}
        <label className="flex items-center gap-2 text-sm text-ink-900"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> Default sender for {texts ? 'texts' : 'email'}</label>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- page
export function DeliveryPage() {
  const { can, me } = useAuth()
  const queryClient = useQueryClient()
  const allowed = can('provider.edit')
  const catalogue = useQuery({ queryKey: [...PROVIDERS, 'catalogue'], queryFn: ({ signal }) => api.get<ProviderType[]>('/delivery-providers/catalogue/', undefined, signal), enabled: allowed, staleTime: Infinity })
  const providers = useQuery({ queryKey: PROVIDERS, queryFn: ({ signal }) => api.get<DeliveryProvider[]>('/delivery-providers/', undefined, signal), enabled: allowed })
  const senders = useQuery({ queryKey: SENDERS, queryFn: ({ signal }) => api.get<DeliverySender[]>('/delivery-senders/', undefined, signal), enabled: allowed })
  const [editing, setEditing] = useState<DeliveryProvider | 'new' | null>(null)
  const [editingSender, setEditingSender] = useState<DeliverySender | 'new' | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['delivery'] })
  const check = useMutation({
    mutationFn: (provider: DeliveryProvider) => api.post<{ ok: boolean; detail: string | null }>(`/delivery-providers/${provider.id}/check/`),
    onSuccess: (result, provider) => { setNotice({ ok: result.ok, text: result.ok ? `${provider.name}: the connection and credential work.` : `${provider.name}: ${result.detail}` }); void refresh() },
  })
  const removeProvider = useMutation({ mutationFn: (provider: DeliveryProvider) => api.delete(`/delivery-providers/${provider.id}/`), onSuccess: refresh })
  const verify = useMutation({
    mutationFn: ({ sender, to }: { sender: DeliverySender; to: string }) => api.post<{ ok: boolean; detail: string | null; to: string }>(`/delivery-senders/${sender.id}/verify/`, { to }),
    onSuccess: (result, { sender }) => {
      const from = sender.from_address ?? sender.sender_id
      setNotice({ ok: result.ok, text: result.ok ? `A verification message from ${from} was accepted and sent to ${result.to}.` : `${from}: ${result.detail}` })
      void refresh()
    },
  })
  const removeSender = useMutation({ mutationFn: (sender: DeliverySender) => api.delete(`/delivery-senders/${sender.id}/`), onSuccess: refresh })

  if (!allowed) return <ErrorState title="Delivery settings need the provider.edit permission" error={new Error('Ask a workspace administrator to add it to your role.')} />
  if (providers.isError) return <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
  const labels = Object.fromEntries((catalogue.data ?? []).map((item) => [item.provider_type, item]))
  const rows = (providers.data ?? []).map((item) => ({ ...item, manageable: labels[item.provider_type]?.manageable ?? true }))
  function startVerify(sender: DeliverySender) {
    if (sender.channel === 'EMAIL') return verify.mutate({ sender, to: me?.principal.email ?? '' })
    const to = window.prompt('Send the verification text to which mobile number? Include the country code, e.g. +14045550100')
    if (to?.trim()) verify.mutate({ sender, to: to.trim() })
  }
  const failure = check.error ?? removeProvider.error ?? verify.error ?? removeSender.error

  const providerColumns: Column<DeliveryProvider>[] = [
    { key: 'name', header: 'Provider', render: (row) => (
      <div><p className="font-medium text-ink-900">{row.name}<span className="ml-2"><Tag>{row.channel === 'SMS' ? 'TEXTS' : 'EMAIL'}</Tag></span>{row.is_default && <span className="ml-1"><Tag>DEFAULT</Tag></span>}</p>
        <p className="text-xs text-ink-500">{labels[row.provider_type]?.label ?? row.provider_type}{row.config.endpoint ? ` · ${row.config.endpoint}` : row.config.host ? ` · ${row.config.host}` : ''}{row.has_transactional_secret ? ' · separate key for receipts' : ''}</p></div>) },
    { key: 'state', header: 'State', render: (row) => !row.is_active ? <StatusBadge status="ARCHIVED" label="Switched off" />
      : row.last_check_ok === false ? <StatusBadge status="FAILED" label="Check failed" /> : row.last_check_ok ? <StatusBadge status="ACTIVE" label={`Checked ${formatDateTime(row.last_checked_at)}`} /> : <StatusBadge status="DRAFT" label="Not checked yet" /> },
    { key: 'webhook', header: 'Callback address', render: (row) => row.webhook_url
      ? <button type="button" className={`${buttonClass({ variant: 'link', size: 'sm' })} text-left`} title={row.webhook_url}
          onClick={() => void navigator.clipboard?.writeText(row.webhook_url as string).then(() => setCopied(row.id), () => undefined)}>{copied === row.id ? 'Copied' : 'Copy webhook URL'}</button>
      : <span className="text-xs text-ink-500">No callbacks</span> },
    { key: 'actions', header: '', align: 'right', render: (row) => (
      <span className="flex justify-end gap-1">
        <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={check.isPending} onClick={() => check.mutate(row)}>Check</button>
        {row.manageable === false ? <Link to="/settings/email" className="text-brand-800 hover:underline">Email server</Link> : (<>
          <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setEditing(row)}>Edit</button>
          <button type="button" className={buttonClass({ variant: 'danger', size: 'sm' })} onClick={() => window.confirm(`Remove ${row.name}? Its senders are removed with it.`) && removeProvider.mutate(row)}>Remove</button>
        </>)}
      </span>) },
  ]
  const senderColumns: Column<DeliverySender>[] = [
    { key: 'name', header: 'Sender', render: (row) => (
      <div><p className="font-medium text-ink-900">{row.display_name}<span className="ml-2"><Tag>{row.channel === 'EMAIL' ? 'EMAIL' : 'TEXTS'}</Tag></span>{row.is_default && <span className="ml-1"><Tag>DEFAULT</Tag></span>}</p>
        <p className="text-xs text-ink-500">{row.from_address ?? row.sender_id}</p></div>) },
    { key: 'provider', header: 'Sends through', render: (row) => row.provider_name },
    { key: 'status', header: 'Verification', render: (row) => <StatusBadge status={row.verification_status === 'VERIFIED' ? 'ACTIVE' : row.verification_status === 'FAILED' ? 'FAILED' : 'PAUSED'}
        label={row.verification_status === 'VERIFIED' ? 'Verified' : row.verification_status === 'FAILED' ? 'Verification failed' : 'Not verified yet'} /> },
    { key: 'actions', header: '', align: 'right', render: (row) => row.provider_type === 'SMTP' ? <Link to="/settings/email" className="text-sm font-medium text-brand-800 hover:underline">Email server</Link> : (
      <span className="flex justify-end gap-1">
        <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={verify.isPending} onClick={() => startVerify(row)}>{row.verification_status === 'VERIFIED' ? 'Verify again' : 'Verify'}</button>
        <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setEditingSender(row)}>Edit</button>
        <button type="button" className={buttonClass({ variant: 'danger', size: 'sm' })} onClick={() => window.confirm(`Remove the sender ${row.display_name}?`) && removeSender.mutate(row)}>Remove</button>
      </span>) },
  ]

  return (
    <div className="space-y-8">
      {notice && <p role="status" className={`rounded-lg border px-4 py-3 text-sm ${notice.ok ? 'border-success bg-surface-subtle text-success-text' : 'border-danger bg-danger-bg text-danger-text'}`}>{notice.text}</p>}
      {failure != null && <ErrorState title="That did not work" error={failure} />}

      <section aria-labelledby="providers-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="providers-heading" className="font-display text-section-title font-semibold text-ink-900">Sending engines</h2>
            <p className="text-sm text-ink-500">The services that carry this workspace's email, e-receipts and text messages: Postal or SendGrid over their HTTP API, your own mail server, and a text aggregator for SMS and MMS. Many teams keep one engine for marketing and another for receipts. Register the callback address with the provider so deliveries, bounces, opens and clicks come back.</p>
          </div>
          <button type="button" className={buttonPrimary} disabled={!catalogue.data} onClick={() => setEditing('new')}>Add engine</button>
        </div>
        {providers.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading providers</p>
          : rows.length === 0 ? <EmptyState title="No sending engine yet" hint="Add Postal or SendGrid for email or a text engine here, or offer your own mail server as a campaign sender under Email server." />
          : <DataTable columns={providerColumns} rows={rows} rowKey={(row) => row.id} caption="Sending engines" />}
      </section>

      <section aria-labelledby="senders-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="senders-heading" className="font-display text-section-title font-semibold text-ink-900">Senders</h2>
            <p className="text-sm text-ink-500">Who a campaign comes from: a From name and address for email, a short code or number for texts. A sender must be verified before a campaign using it can be published.</p>
          </div>
          <button type="button" className={buttonSecondary} disabled={rows.every((row) => row.manageable === false)} onClick={() => setEditingSender('new')}>Add sender</button>
        </div>
        {senders.isError ? <ErrorState error={senders.error} onRetry={() => void senders.refetch()} />
          : senders.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading senders</p>
          : senders.data.length === 0 ? <EmptyState title="No sender yet" hint="Add a provider first, then the From address your campaigns should use." />
          : <DataTable columns={senderColumns} rows={senders.data} rowKey={(row) => row.id} caption="Senders" />}
      </section>

      {editing && catalogue.data && <ProviderForm catalogue={catalogue.data} provider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {editingSender && <SenderForm providers={rows} sender={editingSender === 'new' ? null : editingSender} onClose={() => setEditingSender(null)} />}
    </div>
  )
}
