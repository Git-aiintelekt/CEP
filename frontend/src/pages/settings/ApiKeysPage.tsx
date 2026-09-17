import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonPrimary, buttonSecondary, Field, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, fromLocalInput } from '@/lib/format'
import type { ApiKey, ApiKeyCreated } from '@/lib/types'

const STATUS_TONE: Record<string, string> = { ACTIVE: 'ACTIVE', EXPIRED: 'PAUSED', REVOKED: 'CANCELLED' }

function CreateKey({ scopes, onClose, onCreated }: { scopes: string[]; onClose: () => void; onCreated: (key: ApiKeyCreated) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [cidrs, setCidrs] = useState('')
  const [expires, setExpires] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const create = useMutation({
    mutationFn: () => api.post<ApiKeyCreated>('/api-clients/', {
      name: name.trim(), scopes: chosen, expires_at: fromLocalInput(expires),
      allowed_ip_cidrs: cidrs.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
    }),
    onSuccess: async (created) => { await queryClient.invalidateQueries({ queryKey: ['settings'] }); void queryClient.invalidateQueries({ queryKey: ['workspace'] }); onCreated(created) },
    onError: (error) => error instanceof ApiError && error.status === 400 && setErrors(error.fieldErrors),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (name.trim().length < 2) found.name = 'Name the system that will use this key.'
    if (chosen.length === 0) found.scopes = 'Choose at least one scope.'
    setErrors(found)
    if (Object.keys(found).length === 0) create.mutate()
  }
  const other = create.isError && !(create.error instanceof ApiError && create.error.status === 400) ? create.error : null

  return (
    <Modal size="lg" title="New API key" onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="key-form" className={buttonPrimary} disabled={create.isPending}>
          {create.isPending && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}Create key
        </button>
      </>}>
      <form id="key-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {other !== null && <ErrorState title="Could not create the key" error={other} />}
        <Field label="Name" required error={errors.name} hint="The system that will use it, for example: POS integration.">
          {(ids) => <TextInput {...ids} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-ink-700">Scopes <span className="font-normal text-ink-500">(give the key only what it needs)</span></legend>
          {errors.scopes && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{errors.scopes}</p>}
          <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 md:grid-cols-3">
            {scopes.map((scope) => (
              <li key={scope}><label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-900">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={chosen.includes(scope)}
                  onChange={() => setChosen(chosen.includes(scope) ? chosen.filter((item) => item !== scope) : [...chosen, scope])} />{scope}</label></li>
            ))}
          </ul>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Allowed IP addresses" error={errors.allowed_ip_cidrs} hint="Optional. Addresses or CIDR ranges, separated by commas or new lines. Empty means any address.">
            {(ids) => <TextArea {...ids} rows={2} value={cidrs} onChange={(event) => setCidrs(event.target.value)} placeholder="203.0.113.0/24" className="font-mono" />}
          </Field>
          <Field label="Expires" error={errors.expires_at} hint="Optional. Your local time.">
            {(ids) => <TextInput {...ids} type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} />}
          </Field>
        </div>
      </form>
    </Modal>
  )
}

function KeyReveal({ created, onClose }: { created: ApiKeyCreated; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal title="Copy the key now" onClose={onClose} footer={<button type="button" className={buttonPrimary} onClick={onClose}>I have stored it</button>}>
      <div className="space-y-3 text-sm text-ink-700">
        <p><strong>{created.name}</strong> is ready. This is the only time the full key is shown: only a fingerprint of it is stored, so it cannot be recovered later.</p>
        <div className="flex gap-2">
          <input aria-label="API key" readOnly value={created.key} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-slate-50 px-3 py-2 font-mono text-xs" />
          <button type="button" className={buttonSecondary} onClick={() => void navigator.clipboard?.writeText(created.key).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p className="text-xs text-ink-500">Send it as <code className="font-mono">Authorization: Bearer {created.key_prefix}…</code> together with the <code className="font-mono">X-Tenant</code> header. If it leaks, revoke it here and create a new one.</p>
      </div>
    </Modal>
  )
}

export function ApiKeysPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<ApiKeyCreated | null>(null)
  const keys = useQuery({ queryKey: ['settings', 'api-keys'], queryFn: ({ signal }) => api.get<ApiKey[]>('/api-clients/', undefined, signal) })
  const scopes = useQuery({ queryKey: ['settings', 'scopes'], queryFn: ({ signal }) => api.get<{ scopes: string[] }>('/api-clients/scopes/', undefined, signal), staleTime: 10 * 60_000 })
  const revoke = useMutation({ mutationFn: (key: ApiKey) => api.post<ApiKey>(`/api-clients/${key.id}/revoke/`), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['settings'] }); void queryClient.invalidateQueries({ queryKey: ['workspace'] }) } })

  const columns: Column<ApiKey>[] = [
    { key: 'name', header: 'Key', render: (key) => <div><p className="font-medium text-ink-900">{key.name}</p><p className="font-mono text-xs text-ink-500">{key.key_prefix}…</p></div> },
    { key: 'scopes', header: 'Scopes', render: (key) => <span className="flex max-w-xs flex-wrap gap-1">{key.scopes.map((scope) => <Tag key={scope}>{scope}</Tag>)}</span> },
    { key: 'ips', header: 'Allowed from', render: (key) => key.allowed_ip_cidrs?.length ? <span className="font-mono text-xs">{key.allowed_ip_cidrs.join(', ')}</span> : <span className="text-ink-500">Any address</span> },
    { key: 'status', header: 'Status', render: (key) => <StatusBadge status={STATUS_TONE[key.status]} label={key.status === 'ACTIVE' ? 'Active' : key.status === 'EXPIRED' ? 'Expired' : 'Revoked'} /> },
    { key: 'used', header: 'Last used', render: (key) => formatDateTime(key.last_used_at).replace('—', 'Never') },
    { key: 'expires', header: 'Expires', render: (key) => formatDateTime(key.expires_at).replace('—', 'Never') },
    { key: 'actions', header: '', align: 'right', render: (key) => key.status !== 'REVOKED' && (
      <button type="button" className="text-sm font-medium text-red-700 hover:underline" disabled={revoke.isPending}
        onClick={() => window.confirm(`Revoke "${key.name}"? Systems using it stop working immediately. This cannot be undone.`) && revoke.mutate(key)}>Revoke</button>) },
  ]

  if (keys.isError) return <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Keys let other systems call the API for this workspace. A key can never manage users, roles or other keys.</p>
        <button type="button" className={buttonPrimary} onClick={() => setCreating(true)}>New API key</button>
      </div>
      {revoke.isError && <div className="mb-4"><ErrorState title="Could not revoke the key" error={revoke.error} /></div>}
      {keys.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading keys</p>
        : keys.data.length === 0 ? <EmptyState title="No API keys yet" hint="Create one when a system such as the POS or the data warehouse needs to call the API." />
        : <DataTable columns={columns} rows={keys.data} rowKey={(key) => key.id} caption="API keys" />}
      {creating && <CreateKey scopes={scopes.data?.scopes ?? []} onClose={() => setCreating(false)} onCreated={(key) => { setCreating(false); setCreated(key) }} />}
      {created && <KeyReveal created={created} onClose={() => setCreated(null)} />}
    </div>
  )
}
