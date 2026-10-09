/** The Webhook step's panel: the address, a signing secret kept encrypted on the server (shown only as set or not), whether to
 * include the customer's attributes, and Send a Test Call (POST /journeys/{id}/webhook-test/). The config it writes is what
 * apps/journeys/webhooks.py reads: a `secret` typed here becomes `secret_enc` on save. */
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { buttonSecondary, Field, TextInput } from '@/components/Form'
import { Spinner } from '@/components/States'
import { api } from '@/lib/api'

const URL_OK = /^https?:\/\/[^\s/$.?#].[^\s]*$/i

export function webhookProblem(config: Record<string, unknown>): string | null {
  const url = String(config.url ?? '').trim()
  if (!url) return null
  if (url.length > 2000 || !URL_OK.test(url)) return 'The address is a full http(s) URL.'
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) return 'The address must be https (http is only allowed for localhost).'
  } catch {
    return 'The address is a full http(s) URL.'
  }
  return null
}

export function isWebhookConfigured(config: Record<string, unknown>): boolean {
  return String(config.url ?? '').trim() !== '' && webhookProblem(config) === null
}

export function webhookHost(config: Record<string, unknown>): string | null {
  try {
    return new URL(String(config.url ?? '')).hostname || null
  } catch {
    return null
  }
}

export function summarizeWebhook(config: Record<string, unknown>): string {
  const host = webhookHost(config)
  return host ? `Webhook: ${host}` : 'No address set'
}

type SetFn = (patch: Record<string, unknown>) => void

export function WebhookFields({ config, set, journeyId }: { config: Record<string, unknown>; set: SetFn; journeyId?: string }) {
  const url = String(config.url ?? '')
  const hasStored = Boolean(config.secret_enc) && config.secret === undefined
  const [changingSecret, setChangingSecret] = useState(!config.secret_enc)
  const problem = webhookProblem(config)
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; status: number | null; error: string | null; duration_ms: number; response?: string }>(`/journeys/${journeyId}/webhook-test/`, {
      url: url.trim(), ...(config.secret !== undefined ? { secret: config.secret } : config.secret_enc ? { secret_enc: config.secret_enc } : {}), include_attributes: Boolean(config.include_attributes), label: config.label,
    }),
  })
  return (
    <div className="space-y-4">
      <Field label="Address" required hint="An https URL that accepts a JSON POST." error={problem ?? undefined}>
        {(ids) => <TextInput {...ids} value={url} maxLength={2000} onChange={(event) => set({ url: event.target.value })} placeholder="https://hooks.example.com/cep" />}
      </Field>
      <div>
        <p className="block text-sm font-medium text-ink-800">Signing Secret</p>
        {hasStored && !changingSecret ? (
          <p className="mt-1 flex items-center gap-3 text-sm text-ink-800">
            A secret is set.
            <button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => setChangingSecret(true)}>Change</button>
            <button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => set({ secret: '' })}>Remove</button>
          </p>
        ) : (
          <TextInput className="mt-1" type="password" aria-label="Signing Secret" autoComplete="new-password" value={String(config.secret ?? '')} maxLength={200}
            onChange={(event) => set({ secret: event.target.value })} placeholder="Optional" />
        )}
        <p className="mt-1 text-xs text-ink-800">Each call carries X-CEP-Signature: sha256 of HMAC-SHA256 over “timestamp.body” with this secret, with X-CEP-Timestamp beside it. Kept encrypted; never shown again.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink-900">
        <input type="checkbox" className="mt-0.5" checked={Boolean(config.include_attributes)} onChange={(event) => set({ include_attributes: event.target.checked })} />
        <span>Include the customer’s custom attributes<span className="block text-xs text-ink-800">The record’s own fields (name, email, phone) and the journey context always go.</span></span>
      </label>
      {journeyId && (
        <div>
          <button type="button" className={buttonSecondary} disabled={!isWebhookConfigured(config) || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Spinner size="sm" /> : null} Send a Test Call
          </button>
          {test.data && (
            <p role="status" className={`mt-2 text-sm ${test.data.ok ? 'text-ink-800' : 'text-danger-text'}`}>
              {test.data.ok ? `The endpoint answered ${test.data.status} in ${test.data.duration_ms} ms.` : test.data.error ?? 'The call failed.'}
            </p>
          )}
          {test.isError && <p role="alert" className="mt-2 text-sm text-danger-text">The test call could not be sent.</p>}
          <p className="mt-1 text-xs text-ink-800">Sends a sample customer with the same headers and signature; it shows on the journey’s Webhook Calls card.</p>
        </div>
      )}
    </div>
  )
}
