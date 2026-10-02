/** Settings → Delivery → Deliverability Testing: the workspace's Mailgun Inspect account, its default clients, and Check Connection. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/Button'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { DeliverabilityService, InspectClient } from '@/lib/types'

const SERVICE_KEY = ['deliverability', 'service'] as const
const CLIENTS_KEY = ['deliverability', 'clients'] as const
const CATEGORY_LABEL: Record<string, string> = { Web: 'Webmail', Application: 'Desktop Apps', Mobile: 'Phones and Tablets' }

export function DeliverabilityServiceSection({ onNotice }: { onNotice: (notice: { ok: boolean; text: string }) => void }) {
  const queryClient = useQueryClient()
  const service = useQuery({ queryKey: SERVICE_KEY, queryFn: ({ signal }) => api.get<DeliverabilityService>('/deliverability/service/', undefined, signal) })
  const [editing, setEditing] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['deliverability'] })
  const check = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail: string | null }>('/deliverability/service/check/'),
    onSuccess: (result) => { onNotice({ ok: result.ok, text: result.ok ? 'Mailgun Inspect: the account works.' : `Mailgun Inspect: ${result.detail ?? 'the check failed.'}` }); void refresh() },
  })
  const remove = useMutation({ mutationFn: () => api.delete('/deliverability/service/'), onSuccess: () => void refresh() })

  return (
    <section aria-labelledby="deliverability-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="deliverability-heading" className="font-display text-section-title font-semibold text-ink-900">Deliverability Testing</h2>
          <p className="text-sm text-ink-800">Inbox previews of a template in real email clients, through your own Mailgun Inspect account. Each test counts against your plan's monthly allowance.</p>
        </div>
        {service.data?.configured && <button type="button" className={buttonSecondary} onClick={() => setEditing(true)}>Edit</button>}
      </div>
      {service.isError ? <ErrorState error={service.error} onRetry={() => void service.refetch()} />
        : service.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
        : !service.data.configured ? (
          <EmptyState title="No inbox-preview account yet" hint="Add your Mailgun Inspect username and API key. Mailgun Inspect Basic covers client previews; the spam check needs Premium."
            action={<button type="button" className={buttonPrimary} onClick={() => setEditing(true)}>Set Up Mailgun Inspect</button>} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-3">
            <div>
              <p className="font-medium text-ink-900">Mailgun Inspect <span className="ml-2 align-middle"><ServiceState service={service.data} /></span></p>
              <p className="text-xs text-ink-800">
                {service.data.region === 'EU' ? 'EU region' : 'US region'}{service.data.username ? ` · ${service.data.username}` : ''} · API key stored
                {service.data.default_clients.length ? ` · ${service.data.default_clients.length} default clients` : ' · the service’s default clients'}
                {service.data.image_blocking ? ' · images blocked' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" loading={check.isPending} onClick={() => check.mutate()}>Check Connection</Button>
              <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => window.confirm('Remove the Mailgun Inspect account? Past test results stay; new tests need an account again.') && remove.mutate()}>Remove</Button>
            </div>
          </div>
        )}
      {editing && service.data && <ServiceForm service={service.data} onClose={() => setEditing(false)} />}
    </section>
  )
}

function ServiceState({ service }: { service: DeliverabilityService }) {
  if (!service.is_active) return <StatusBadge status="ARCHIVED" label="Switched Off" />
  if (service.last_check_ok === false) return <StatusBadge status="FAILED" label="Check Failed" />
  if (service.last_check_ok) return <StatusBadge status="ACTIVE" label={`Checked ${formatDateTime(service.last_checked_at)}`} />
  return <StatusBadge status="DRAFT" label="Not Checked Yet" />
}

function ServiceForm({ service, onClose }: { service: DeliverabilityService; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [region, setRegion] = useState<'US' | 'EU'>(service.region)
  const [username, setUsername] = useState(service.username)
  const [apiKey, setApiKey] = useState('')
  const [imageBlocking, setImageBlocking] = useState(service.image_blocking)
  const [chosen, setChosen] = useState<string[]>(service.default_clients)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const clients = useQuery({ queryKey: CLIENTS_KEY, queryFn: ({ signal }) => api.get<{ clients: InspectClient[]; detail: string | null }>('/deliverability/clients/', undefined, signal), enabled: service.has_api_key })

  const save = useMutation({
    mutationFn: () => api.put<DeliverabilityService>('/deliverability/service/', { region, username: username.trim(), ...(apiKey ? { api_key: apiKey } : {}), image_blocking: imageBlocking, default_clients: chosen, is_active: true }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['deliverability'] }); onClose() },
    onError: (error) => { if (error instanceof ApiError && error.status === 400) setErrors(error.fieldErrors) },
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setErrors({})
    if (!service.has_api_key && !apiKey.trim()) return setErrors({ api_key: 'Enter the Mailgun Inspect API key.' })
    save.mutate()
  }
  const toggle = (id: string) => setChosen((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]))
  const groups = ['Web', 'Application', 'Mobile'].map((category) => ({ category, rows: (clients.data?.clients ?? []).filter((c) => c.category === category) })).filter((g) => g.rows.length)
  const otherError = save.isError && !(save.error instanceof ApiError && save.error.status === 400) ? save.error : null

  return (
    <Modal title={service.configured ? 'Mailgun Inspect Account' : 'Set Up Mailgun Inspect'} subtitle="Mailgun → Inspect → Settings → API: the account username and an API key." onClose={onClose} size="lg" scrollBody
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" form="deliverability-service-form" className={buttonPrimary} disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save'}</button></>}>
      <form id="deliverability-service-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {otherError && <ErrorState title="Could not save" error={otherError} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Region" required hint="Where your Mailgun account lives.">
            {(ids) => <Select {...ids} value={region} onChange={(event) => setRegion(event.target.value as 'US' | 'EU')}><option value="US">US (api.mailgun.net)</option><option value="EU">EU (api.eu.mailgun.net)</option></Select>}
          </Field>
          <Field label="Username" hint="The Inspect account's API username." error={errors.username} limit={{ used: username.length, max: 200 }}>
            {(ids) => <TextInput {...ids} value={username} maxLength={200} autoComplete="off" onChange={(event) => setUsername(event.target.value)} />}
          </Field>
        </div>
        <Field label="API Key" required={!service.has_api_key} error={errors.api_key} hint={service.has_api_key ? 'Stored. Leave empty to keep it.' : 'Write-only: stored encrypted, never shown again.'}>
          {(ids) => <TextInput {...ids} type="password" value={apiKey} autoComplete="new-password" onChange={(event) => setApiKey(event.target.value)} />}
        </Field>
        <label className="flex items-start gap-2 text-sm text-ink-900">
          <input type="checkbox" className="mt-0.5" checked={imageBlocking} onChange={(event) => setImageBlocking(event.target.checked)} />
          <span>Render with images blocked<span className="block text-xs text-ink-800">How the email looks to people whose inbox does not load images until asked.</span></span>
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">Default Clients</legend>
          <p className="mb-2 text-xs text-ink-800">The clients every test renders in. Leave all unchecked to use the service's own default set.</p>
          {!service.has_api_key ? <p className="text-xs text-ink-800">Save the API key first; the client list comes from the account.</p>
            : clients.isPending ? <p className="flex items-center gap-2 text-xs text-ink-800"><Spinner size="sm" /> Loading the client list</p>
            : clients.data?.detail ? <p className="text-xs text-danger-text">{clients.data.detail}</p>
            : (
              <div className="grid gap-4 sm:grid-cols-3">
                {groups.map((group) => (
                  <div key={group.category}>
                    <p className="mb-1 text-xs font-semibold text-ink-900">{CATEGORY_LABEL[group.category] ?? group.category}</p>
                    <ul className="max-h-56 space-y-1 overflow-auto pr-1">
                      {group.rows.map((client) => (
                        <li key={client.id}>
                          <label className="flex items-start gap-2 text-sm text-ink-900">
                            <input type="checkbox" className="mt-0.5" checked={chosen.includes(client.id)} onChange={() => toggle(client.id)} />
                            <span>{client.client}<span className="block text-xs text-ink-800">{[client.os, client.browser].filter(Boolean).join(' · ')}</span></span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
        </fieldset>
      </form>
    </Modal>
  )
}
