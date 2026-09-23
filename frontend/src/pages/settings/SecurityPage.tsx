import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonDanger, buttonPrimary, buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { IdentityProvider, Role, SecuritySettings, SupportAccess } from '@/lib/types'

const KEY = ['workspace', 'security']

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span><span className="block text-sm font-medium text-ink-900">{label}</span><span className="block text-xs text-ink-500">{hint}</span></span>
    </label>
  )
}

function MfaRule({ settings }: { settings: SecuritySettings }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (require_mfa: boolean) => api.put<SecuritySettings>('/workspace/security/', { require_mfa }),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
  })
  const refused = save.error instanceof ApiError ? save.error.fieldErrors.require_mfa : undefined
  return (
    <section aria-labelledby="mfa-rule" className="rounded-lg border border-line bg-surface p-5">
      <h2 id="mfa-rule" className="text-sm font-semibold text-ink-900">Multi-factor authentication</h2>
      <div className="mt-3">
        <Toggle label="Require it for everyone in this workspace" checked={settings.require_mfa} disabled={save.isPending} onChange={(next) => save.mutate(next)}
          hint="People who have not set it up are asked to do so the next time they sign in, before anything else. Single sign-on users are covered by your identity provider." />
      </div>
      {refused && <p role="alert" className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-text">{refused} <Link to="/account/security" className="font-medium underline">Set it up now</Link></p>}
      {save.isError && !refused && <div className="mt-3"><ErrorState title="Could not save" error={save.error} /></div>}
    </section>
  )
}

const EMPTY: IdentityProvider = { display_name: '', issuer: '', client_id: '', has_client_secret: false, scopes: 'openid email profile', allowed_email_domains: [], jit_provisioning: false,
                                  default_role: null, enforce_sso: false, is_active: true }

function SsoForm({ settings, roles }: { settings: SecuritySettings; roles: Role[] }) {
  const queryClient = useQueryClient()
  const existing = settings.identity_provider
  const [form, setForm] = useState<IdentityProvider>(existing ?? EMPTY)
  const [secret, setSecret] = useState('')
  const [domains, setDomains] = useState((existing?.allowed_email_domains ?? []).join(', '))
  const [copied, setCopied] = useState(false)
  const set = <K extends keyof IdentityProvider>(key: K, value: IdentityProvider[K]) => setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => api.put<SecuritySettings>('/workspace/security/', { identity_provider: {
      display_name: form.display_name.trim(), issuer: form.issuer.trim(), client_id: form.client_id.trim(), scopes: form.scopes.trim(), jit_provisioning: form.jit_provisioning,
      default_role: form.default_role, enforce_sso: form.enforce_sso, is_active: form.is_active,
      allowed_email_domains: domains.split(/[\s,;]+/).filter(Boolean), ...(secret ? { client_secret: secret } : {}) } }),
    onSuccess: (data) => { queryClient.setQueryData(KEY, data); setSecret(''); if (data.identity_provider) setForm(data.identity_provider) },
  })
  const remove = useMutation({
    mutationFn: () => api.put<SecuritySettings>('/workspace/security/', { identity_provider: null }),
    onSuccess: (data) => { queryClient.setQueryData(KEY, data); setForm(EMPTY); setDomains(''); setSecret('') },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : remove.isError ? remove.error : null

  return (
    <form className="mt-4 space-y-4" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
      <div className="rounded-lg bg-surface-subtle px-3 py-2.5">
        <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Redirect URI to register with your identity provider</p>
        <div className="mt-1 flex gap-2">
          <code className="min-w-0 flex-1 text-xs break-all text-ink-900">{settings.redirect_uri}</code>
          <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => void navigator.clipboard?.writeText(settings.redirect_uri).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Name on the sign-in button" required error={errors.display_name} hint="For example: Okta, Microsoft, Google Workspace">
          {(ids) => <TextInput {...ids} value={form.display_name} onChange={(event) => set('display_name', event.target.value)} />}
        </Field>
        <Field label="Issuer" required error={errors.issuer} hint="The https:// address of your OpenID Connect provider. It is checked when you save.">
          {(ids) => <TextInput {...ids} value={form.issuer} onChange={(event) => set('issuer', event.target.value)} placeholder="https://login.example.com" />}
        </Field>
        <Field label="Client ID" required error={errors.client_id}>
          {(ids) => <TextInput {...ids} value={form.client_id} onChange={(event) => set('client_id', event.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Client secret" error={errors.client_secret} hint={form.has_client_secret ? 'A secret is stored. Leave this empty to keep it.' : 'Stored encrypted; never shown again.'}>
          {(ids) => <TextInput {...ids} type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" placeholder={form.has_client_secret ? '••••••••' : ''} />}
        </Field>
        <Field label="Allowed email domains" error={errors.allowed_email_domains} hint="Only these may sign in, e.g. example.com. Empty = any address your provider vouches for.">
          {(ids) => <TextInput {...ids} value={domains} onChange={(event) => setDomains(event.target.value)} />}
        </Field>
        <Field label="Role for new accounts" error={errors.default_role} hint="Used when accounts are created on first sign-in.">
          {(ids) => <Select {...ids} value={form.default_role ?? ''} onChange={(event) => set('default_role', event.target.value || null)}>
            <option value="">No role</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </Select>}
        </Field>
      </div>
      <div className="space-y-3">
        <Toggle label="Single sign-on is on" checked={form.is_active} onChange={(next) => set('is_active', next)} hint="The sign-in page shows a button for it." />
        <Toggle label="Create accounts on first sign-in" checked={form.jit_provisioning} onChange={(next) => set('jit_provisioning', next)} hint="Otherwise only people you added under Users can sign in." />
        <Toggle label="Require single sign-on" checked={form.enforce_sso} onChange={(next) => set('enforce_sso', next)}
          hint="Passwords stop working for everyone except administrators, who keep theirs for the day the identity provider is unreachable." />
        {errors.enforce_sso && <p className="text-xs font-medium text-danger-text">{errors.enforce_sso}</p>}
      </div>
      {other !== null && <ErrorState title="Could not save single sign-on" error={other} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save single sign-on</button>
        {existing && <button type="button" className={buttonDanger} disabled={remove.isPending}
          onClick={() => window.confirm('Remove single sign-on? People who only sign in through it will need a password link.') && remove.mutate()}>Remove</button>}
        {save.isSuccess && <span role="status" className="self-center text-sm text-success-text">Saved</span>}
      </div>
    </form>
  )
}

function SupportLog() {
  const log = useQuery({ queryKey: ['workspace', 'support-access'], queryFn: ({ signal }) => api.get<SupportAccess[]>('/workspace/support-access/', undefined, signal) })
  const columns: Column<SupportAccess>[] = [
    { key: 'when', header: 'When', render: (row) => formatDateTime(row.started_at) },
    { key: 'who', header: 'Support person', render: (row) => row.staff },
    { key: 'as', header: 'Acted as', render: (row) => <div><p className="font-medium text-ink-900">{row.as_user}</p><p className="text-xs text-ink-500">{row.as_email}</p></div> },
    { key: 'why', header: 'Reason', render: (row) => row.reason },
    { key: 'mode', header: 'Access', render: (row) => <StatusBadge status={row.mode === 'WRITE' ? 'PAUSED' : 'DRAFT'} label={row.mode === 'WRITE' ? `Could change data · ${row.writes} change${row.writes === 1 ? '' : 's'}` : 'Read-only'} /> },
    { key: 'ended', header: 'Ended', render: (row) => (row.ended_at ? formatDateTime(row.ended_at) : new Date(row.expires_at) > new Date() ? <StatusBadge status="ACTIVE" label="Open now" /> : formatDateTime(row.expires_at)) },
  ]
  return (
    <section aria-labelledby="support-log">
      <h2 id="support-log" className="text-sm font-semibold text-ink-900">Support access</h2>
      <p className="mt-0.5 mb-3 text-sm text-ink-500">Every time someone from the platform's support team acted as one of your users, with their reason. Support can never manage users, roles, API keys or these settings.</p>
      {log.isError ? <ErrorState error={log.error} onRetry={() => void log.refetch()} />
        : log.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
        : log.data.length === 0 ? <EmptyState title="Support has never accessed this workspace" />
        : <DataTable columns={columns} rows={log.data} rowKey={(row) => row.id} caption="Support access" />}
    </section>
  )
}

export function SecurityPage() {
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<SecuritySettings>('/workspace/security/', undefined, signal) })
  const roles = useQuery({ queryKey: ['settings', 'roles'], queryFn: ({ signal }) => api.get<Role[]>('/roles/', undefined, signal) })
  const [configuring, setConfiguring] = useState(false)

  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading security settings</p>

  const data = settings.data
  return (
    <div className="space-y-6">
      <MfaRule settings={data} />
      <section aria-labelledby="sso" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="sso" className="text-sm font-semibold text-ink-900">Single sign-on (OpenID Connect)</h2>
        {!data.sso_available ? <p className="mt-1 text-sm text-ink-500">Single sign-on is not part of this workspace's plan. Contact us to add it.</p>
          : data.identity_provider || configuring ? <SsoForm settings={data} roles={roles.data ?? []} />
          : (<>
            <p className="mt-1 text-sm text-ink-500">Let people sign in with your company's identity provider (Okta, Microsoft Entra ID, Google Workspace, Auth0 and others) instead of a password.</p>
            <button type="button" className={`mt-4 ${buttonSecondary}`} onClick={() => setConfiguring(true)}>Set up single sign-on</button>
          </>)}
      </section>
      <SupportLog />
    </div>
  )
}
