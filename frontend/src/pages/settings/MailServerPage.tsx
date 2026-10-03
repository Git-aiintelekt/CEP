import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { buttonDanger, buttonPrimary, buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { MailServer, MailServerSettings } from '@/lib/types'

const KEY = ['workspace', 'mail-server']

const EMPTY: MailServer = { host: '', port: 587, security: 'STARTTLS', username: '', has_password: false, from_email: '', from_name: '', reply_to: '',
                            campaign_sender: false, is_active: true, last_tested_at: null, last_test_ok: null, last_test_error: null }

const IN_USE: Record<string, string> = {
  tenant: 'Messages for this workspace go out through your own server.',
  platform: "Until you enter your own server, messages for this workspace go out through the platform's server, with the platform's From address.",
  environment: "Until you enter your own server, messages for this workspace go out through the platform's server.",
  console: 'No mail server is available: password links have to be copied and sent by hand.',
}

export function MailServerPage() {
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<MailServerSettings>('/workspace/mail-server/', undefined, signal) })

  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  return <MailServerForm data={settings.data} myEmail={me?.principal.email ?? ''}
    onSaved={(next) => queryClient.setQueryData(KEY, next)} />
}

function MailServerForm({ data, myEmail, onSaved }: { data: MailServerSettings; myEmail: string; onSaved: (next: MailServerSettings) => void }) {
  const existing = data.server
  const [form, setForm] = useState<MailServer>(existing ?? EMPTY)
  const [password, setPassword] = useState('')
  const [testTo, setTestTo] = useState(myEmail)
  const set = <K extends keyof MailServer>(key: K, value: MailServer[K]) => setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => api.put<MailServerSettings>('/workspace/mail-server/', {
      is_active: form.is_active, campaign_sender: form.campaign_sender,
      from_email: form.from_email.trim(), from_name: form.from_name?.trim() || null, reply_to: form.reply_to?.trim() || null,
      host: form.host.trim(), port: Number(form.port), security: form.security, username: form.username?.trim() || null, ...(password ? { password } : {}),
    }),
    onSuccess: (next) => { onSaved(next); setPassword(''); if (next.server) setForm(next.server) },
  })
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error: string | null; to: string; sender_profile: MailServerSettings['sender_profile'] }>('/workspace/mail-server/test/', { to: testTo.trim() }),
    onSuccess: (result) => onSaved({ ...data, sender_profile: result.sender_profile ?? data.sender_profile,
                                     server: data.server && { ...data.server, last_tested_at: new Date().toISOString(), last_test_ok: result.ok, last_test_error: result.error } }),
  })
  const remove = useMutation({
    mutationFn: () => api.delete('/workspace/mail-server/'),
    onSuccess: () => { onSaved({ ...data, server: null, sender_profile: null, in_use: data.in_use === 'tenant' ? 'platform' : data.in_use }); setForm(EMPTY); setPassword('') },
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : remove.isError ? remove.error : test.isError ? test.error : null
  const server = data.server

  return (
    <form className="max-w-3xl space-y-6" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="text-card-title font-semibold text-ink-900">Outgoing Email</h2>
        <p className="mt-1 text-sm text-ink-800">
          Your own SMTP server. It carries the messages this platform sends to people in your workspace (password links, support notifications) and, if you offer it below, your campaigns. Campaign email otherwise goes through your sending engines.
        </p>
        <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${data.in_use === 'console' ? 'bg-warning-bg text-warning-text' : 'bg-surface-subtle text-ink-800'}`}>{IN_USE[data.in_use] ?? data.in_use}</p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-card-title font-semibold text-ink-900">Your SMTP Server</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label="Server" required error={errors.host} hint="e.g. smtp.office365.com, smtp.gmail.com, email-smtp.us-east-1.amazonaws.com">
              {(ids) => <TextInput {...ids} value={form.host} onChange={(event) => set('host', event.target.value)} autoComplete="off" />}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Port" required error={errors.port}>
                {(ids) => <TextInput {...ids} type="number" min={1} max={65535} value={form.port} onChange={(event) => set('port', Number(event.target.value))} />}
              </Field>
              <Field label="Security" required error={errors.security}>
                {(ids) => <Select {...ids} value={form.security} onChange={(event) => set('security', event.target.value as MailServer['security'])}>
                  <option value="STARTTLS">STARTTLS (587)</option>
                  <option value="SSL">SSL/TLS (465)</option>
                  <option value="NONE">None</option>
                </Select>}
              </Field>
            </div>
            <Field label="Username" error={errors.username} hint="Often the full email address. Leave empty for a server that needs no sign-in.">
              {(ids) => <TextInput {...ids} value={form.username ?? ''} onChange={(event) => set('username', event.target.value)} autoComplete="off" />}
            </Field>
            <Field label="Password" error={errors.password} hint={form.has_password ? 'A password is stored. Leave this empty to keep it.' : 'Stored encrypted; never shown again. Many providers want an app password here, not your account password.'}>
              {(ids) => <TextInput {...ids} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={form.has_password ? '••••••••' : ''} />}
            </Field>
          </div>
        </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="text-card-title font-semibold text-ink-900">Sender</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="From Address" required error={errors.from_email} help="The address password links, notifications and, when offered, campaigns come from. It must be one the server is allowed to send as, or the server refuses the message." hint="Must be an address the server is allowed to send as.">
            {(ids) => <TextInput {...ids} type="email" value={form.from_email} onChange={(event) => set('from_email', event.target.value)} autoComplete="off" />}
          </Field>
          <Field label="From Name" error={errors.from_name} hint="Shown next to the address, e.g. Northwind Apparel.">
            {(ids) => <TextInput {...ids} value={form.from_name ?? ''} onChange={(event) => set('from_name', event.target.value)} />}
          </Field>
          <Field label="Reply-To Address" error={errors.reply_to} hint="Where replies go, if not the From address.">
            {(ids) => <TextInput {...ids} type="email" value={form.reply_to ?? ''} onChange={(event) => set('reply_to', event.target.value)} autoComplete="off" />}
          </Field>
          <label className="flex cursor-pointer items-start gap-3 self-end pb-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={form.is_active} onChange={(event) => set('is_active', event.target.checked)} />
            <span><span className="block text-sm font-medium text-ink-900">In Use</span><span className="block text-xs text-ink-800">Switch off to keep these settings without using them; platform messages then fall back to the platform's server, and campaigns cannot use this server.</span></span>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="text-card-title font-semibold text-ink-900">Campaigns</h2>
        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={form.campaign_sender} onChange={(event) => set('campaign_sender', event.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-ink-900">Offer as a Campaign Sender</span>
            <span className="block text-xs text-ink-800">Offers this server to campaigns: adds a delivery provider and a sender ({form.from_name || form.from_email || 'the From address above'}) that campaigns can pick. It becomes verified, and usable for publishing, once a test message has gone through.</span>
          </span>
        </label>
        {data.sender_profile && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-800">
            <StatusBadge status={data.sender_profile.verification_status === 'VERIFIED' ? 'ACTIVE' : 'PAUSED'} label={data.sender_profile.verification_status === 'VERIFIED' ? 'Verified Sender' : 'Sender Not Verified Yet'} />
            {data.sender_profile.display_name} · {data.sender_profile.from_address}{data.sender_profile.is_default ? ' · default email sender' : ''}
            {data.sender_profile.verification_status !== 'VERIFIED' && <span className="text-xs text-ink-800">Send a test message below to verify it.</span>}
          </p>
        )}
      </section>

      {other !== null && <ErrorState title="Could not save the mail server" error={other} />}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save</button>
        {existing && <button type="button" className={buttonDanger} disabled={remove.isPending}
          onClick={() => window.confirm("Remove your mail server? Platform messages will fall back to the platform's server, and campaigns can no longer use it.") && remove.mutate()}>Remove</button>}
        {save.isSuccess && <span role="status" className="text-sm text-success-text">Saved</span>}
      </div>

      {server && (
        <section aria-labelledby="mail-test" className="rounded-lg border border-line bg-surface p-5">
          <h2 id="mail-test" className="text-card-title font-semibold text-ink-900">Send a Test Message</h2>
          <p className="mt-1 text-sm text-ink-800">Uses the saved settings. Save first if you changed anything above.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-72"><Field label="To" required>{(ids) => <TextInput {...ids} type="email" value={testTo} onChange={(event) => setTestTo(event.target.value)} />}</Field></div>
            <button type="button" className={buttonSecondary} disabled={test.isPending || !testTo.trim()} onClick={() => test.mutate()}>
              {test.isPending && <Spinner size="sm" />}Send Test
            </button>
            {server.last_test_ok !== null && (
              <span className="flex items-center gap-2 text-sm text-ink-800">
                <StatusBadge status={server.last_test_ok ? 'ACTIVE' : 'FAILED'} label={server.last_test_ok ? 'Last Test Passed' : 'Last Test Failed'} /> {formatDateTime(server.last_tested_at)}
              </span>
            )}
          </div>
          {server.last_test_ok === false && server.last_test_error && <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 cep-num text-xs text-danger-text">{server.last_test_error}</p>}
        </section>
      )}
    </form>
  )
}
