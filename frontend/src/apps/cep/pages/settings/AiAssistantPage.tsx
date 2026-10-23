/**
 * Settings → AI Assistant: whether AI is used in reports at all; per provider, whether the platform's key is in use, the
 * workspace's own key (which wins, and whose prompts the plan does not limit), or nothing yet; whether Explain This Report
 * may send totals; and this month's prompts against the plan. Off, the prompt box does not appear and no prompt or field
 * name leaves CEP.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/Button'
import { Field, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SaveTick } from '@/components/SaveTick'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { WorkspaceAssistant, WorkspaceAssistantProvider } from '@/apps/insights/types'

const KEY = ['workspace', 'ai-assistant']
type ProviderKey = 'anthropic' | 'openai'
type Body = Partial<Pick<WorkspaceAssistant, 'enabled' | 'explain'>> & { providers?: Partial<WorkspaceAssistant['providers']>; own?: Partial<Record<ProviderKey, { api_key?: string; model_reports?: string; model_fast?: string } | null>> }

export function AiAssistantPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<WorkspaceAssistantProvider | null>(null)
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<WorkspaceAssistant>('/workspace/ai-assistant/', undefined, signal) })
  // the AI Reports menu item follows these switches (GET /me insights.ai_reports)
  const settle = (next: WorkspaceAssistant) => { queryClient.setQueryData(KEY, next); void queryClient.invalidateQueries({ queryKey: ['insights', 'assistant'] }); void queryClient.invalidateQueries({ queryKey: ['me'] }) }
  const save = useMutation({ mutationFn: (body: Body) => api.put<WorkspaceAssistant>('/workspace/ai-assistant/', body), onSuccess: settle })
  const check = useMutation({
    mutationFn: (provider: ProviderKey) => api.post<{ ok: boolean; detail: string }>('/workspace/ai-assistant/check/', { provider }),
    onSuccess: (result) => { (result.ok ? toast.success : toast.failure)(result.ok ? 'The key works' : 'The check failed', result.detail); void settings.refetch() },
  })
  const remove = useMutation({
    mutationFn: (provider: ProviderKey) => api.put<WorkspaceAssistant>('/workspace/ai-assistant/', { own: { [provider]: null } }),
    onSuccess: (next) => { settle(next); toast.success('Your own key was removed') },
  })

  if (settings.isError) return <ErrorState title="The AI Assistant settings could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = settings.data
  const offered = data.available.some((p) => p.platform || p.own?.configured)
  const use = data.usage

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">AI Assistant</h2>
        <p className="mt-0.5 text-sm text-ink-800">Ask for a Report turns a prompt into a draft report through Claude or OpenAI. The model receives the prompt and the field names, never customer rows.</p>
      </div>

      <section className="max-w-3xl rounded-lg border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <Switch checked={data.enabled} disabled={save.isPending || !offered} onChange={(next) => save.mutate({ enabled: next })} label="Use AI in Reports" describedBy="ai-help" />
          <SaveTick mutation={save} field="enabled" />
        </div>
        <p id="ai-help" className="mt-2 text-sm text-ink-800">
          {!offered ? 'No provider is in use yet: your platform has not switched one on, and the workspace has no key of its own. Add your own key below to use AI in reports.'
            : data.enabled ? 'On. Ask for a Report sits above the report list for people who can build reports.'
            : 'Off. Reports are built in the editor only; no prompt or field name leaves CEP.'}
        </p>
        {save.isError && <div className="mt-3"><ErrorState title="The setting was not changed" error={save.error} /></div>}
      </section>

      <section className="max-w-3xl rounded-lg border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold text-ink-900">Providers</h3>
        <p className="mt-0.5 text-sm text-ink-800">Each provider runs on the platform's key within your plan, or on your own key, which the plan does not limit. Your own key wins when both exist.</p>
        <ul className="mt-3 divide-y divide-line-subtle">
          {data.available.map((provider) => (
            <li key={provider.key} className="flex flex-col gap-3 py-4" aria-label={provider.name}>
              <div className="flex items-start gap-3">
                <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-subtle text-sm font-bold text-ink-900">{provider.mark}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900">{provider.name} <span className="ml-1.5 align-middle"><ProviderState provider={provider} /></span></p>
                  <p className="text-xs text-ink-800">
                    {provider.own?.configured ? `Your own key · ${[provider.own.model_reports, provider.own.model_fast].filter(Boolean).join(', ')} · prompts on it are not limited by your plan`
                      : provider.platform ? `The platform's key · ${provider.platform_models.join(', ')}`
                      : `Not offered by the platform. Add your own key (${provider.keys}) to use it.`}
                  </p>
                  {provider.own?.last_check_ok === false && provider.own.last_check_error && <p className="mt-1 text-xs text-danger-text">{provider.own.last_check_error}</p>}
                </div>
                {provider.platform && !provider.own?.configured && (
                  <Switch checked={data.providers[provider.key]} disabled={save.isPending || !data.enabled} ariaLabel={`Allow ${provider.name}`}
                    onChange={(next) => save.mutate({ providers: { [provider.key]: next } })} />
                )}
              </div>
              <div className="flex flex-wrap gap-2 pl-11">
                {provider.own?.configured ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(provider)}>Edit Key</Button>
                    <Button variant="secondary" size="sm" loading={check.isPending && check.variables === provider.key} onClick={() => check.mutate(provider.key)}>Check Connection</Button>
                    <Button variant="danger" size="sm" disabled={remove.isPending}
                      onClick={() => window.confirm(provider.platform ? `Stop using your own ${provider.name} key? Prompts go through the platform's key again, within your plan.` : `Remove your ${provider.name} key? Its models disappear from the picker.`) && remove.mutate(provider.key)}>
                      {provider.platform ? 'Use the Platform’s Key' : 'Remove'}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(provider)}>{provider.platform ? 'Use Your Own Key' : 'Add Your Own Key'}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {check.isError && <div className="mt-3"><ErrorState title="The connection was not checked" error={check.error} /></div>}
        {remove.isError && <div className="mt-3"><ErrorState title="The key was not removed" error={remove.error} /></div>}
      </section>

      {offered && (
        <section className="max-w-3xl rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center gap-3">
            <Switch checked={data.explain && data.explain_allowed} disabled={save.isPending || !data.enabled || !data.explain_allowed} onChange={(next) => save.mutate({ explain: next })} label="Explain This Report" describedBy="ai-explain" />
            <SaveTick mutation={save} field="explain" />
          </div>
          <p id="ai-explain" className="mt-2 text-sm text-ink-800">
            {data.explain_allowed ? 'Sends the report’s totals to the model for a short reading of the result. Personal-data fields are never sent.' : 'Switched off for the platform by the platform team.'}
          </p>
        </section>
      )}

      <section className="max-w-3xl rounded-lg border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold text-ink-900">AI Prompts This Month</h3>
        <p className="mt-1 text-sm text-ink-900"><span className="cep-num">{formatNumber(use.used)}{use.limit !== null ? ` of ${formatNumber(use.limit)}` : ''}</span></p>
        <p className="mt-1 text-xs text-ink-800">
          {use.limit !== null ? `${formatNumber(use.limit)} a month${use.plan ? ` on the ${use.plan} plan` : ''}, on the platform's keys. ` : 'No limit on this plan. '}
          Only a draft counts; a question back does not; prompts on your own key are not counted. Prompts and drafts are kept for {data.retention_days} days for your audit log.
        </p>
      </section>

      {editing && <OwnKeyForm provider={editing} onClose={() => setEditing(null)} onSaved={(next) => { settle(next); setEditing(null) }} />}
    </div>
  )
}

function ProviderState({ provider }: { provider: WorkspaceAssistantProvider }) {
  if (provider.own?.configured) {
    if (provider.own.last_check_ok === false) return <StatusBadge status="FAILED" label="Check Failed" />
    if (provider.own.last_check_ok) return <StatusBadge status="ACTIVE" label={`Checked ${formatDateTime(provider.own.last_checked_at)}`} />
    return <StatusBadge status="DRAFT" label="Not Checked Yet" />
  }
  if (provider.platform) return <StatusBadge status="ACTIVE" label="Provided by the Platform" />
  return <StatusBadge status="ARCHIVED" label="Not Offered" />
}

function OwnKeyForm({ provider, onClose, onSaved }: { provider: WorkspaceAssistantProvider; onClose: () => void; onSaved: (next: WorkspaceAssistant) => void }) {
  const [apiKey, setApiKey] = useState('')
  const [modelReports, setModelReports] = useState(provider.own?.model_reports ?? provider.default_models[0] ?? '')
  const [modelFast, setModelFast] = useState(provider.own?.model_fast ?? provider.default_models[1] ?? '')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const save = useMutation({
    mutationFn: () => api.put<WorkspaceAssistant>('/workspace/ai-assistant/', { own: { [provider.key]: { api_key: apiKey, model_reports: modelReports.trim(), model_fast: modelFast.trim() } } }),
    onSuccess: onSaved,
    onError: (error) => setErrors(error instanceof ApiError ? error.fieldErrors : { api_key: 'The key was not saved.' }),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!provider.own?.configured && !apiKey.trim()) { setErrors({ api_key: 'Give the provider’s API key.' }); return }
    save.mutate()
  }
  return (
    <Modal title={provider.own?.configured ? `Your ${provider.name} Key` : `Add Your Own ${provider.name} Key`} subtitle={`From ${provider.keys}. Stored encrypted and never shown again.`} onClose={onClose}
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" form="own-key-form" className={buttonPrimary} disabled={save.isPending}>Save</button></>}>
      <form id="own-key-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="API Key" required={!provider.own?.configured} error={errors.api_key} hint={provider.own?.configured ? 'Leave empty to keep the stored key.' : undefined}>
          {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />}
        </Field>
        <Field label="Model for Reports" error={errors.model_reports} hint="Offered as “best for reports”.">
          {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={modelReports} onChange={(event) => setModelReports(event.target.value)} maxLength={80} />}
        </Field>
        <Field label="Fast Model" error={errors.model_fast} hint="Offered as “fastest”.">
          {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={modelFast} onChange={(event) => setModelFast(event.target.value)} maxLength={80} />}
        </Field>
        <p className="text-xs text-ink-800">Prompts on your own key are billed by the provider to you and are not limited by your plan. The browser never sees the key; every call goes from CEP’s server to the provider.</p>
      </form>
    </Modal>
  )
}
