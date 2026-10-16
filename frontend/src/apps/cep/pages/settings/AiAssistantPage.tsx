/**
 * Settings → AI Assistant: whether AI is used in reports at all, which of the platform's switched-on providers people may pick,
 * whether Explain This Report may send totals, and this month's prompts against the plan. Off, the prompt box does not
 * appear and no prompt or field name leaves CEP.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SaveTick } from '@/components/SaveTick'
import { ErrorState, Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { WorkspaceAssistant } from '@/apps/insights/types'

const KEY = ['workspace', 'ai-assistant']
type Body = Partial<Pick<WorkspaceAssistant, 'enabled' | 'explain'>> & { providers?: Partial<WorkspaceAssistant['providers']> }

export function AiAssistantPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<WorkspaceAssistant>('/workspace/ai-assistant/', undefined, signal) })
  const save = useMutation({
    mutationFn: (body: Body) => api.put<WorkspaceAssistant>('/workspace/ai-assistant/', body),
    onSuccess: (next) => { queryClient.setQueryData(KEY, next); void queryClient.invalidateQueries({ queryKey: ['insights', 'assistant'] }) },
  })

  if (settings.isError) return <ErrorState title="The AI Assistant settings could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = settings.data
  const offered = data.available.length > 0
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
          {!offered ? 'The platform has not switched on an AI provider yet, so nothing is offered here.'
            : data.enabled ? 'On. Ask for a Report sits above the report list for people who can build reports.'
            : 'Off. Reports are built in the editor only; no prompt or field name leaves CEP.'}
        </p>
        {save.isError && <div className="mt-3"><ErrorState title="The setting was not changed" error={save.error} /></div>}
      </section>

      {offered && (
        <section className="max-w-3xl rounded-lg border border-line bg-surface p-5">
          <h3 className="text-sm font-semibold text-ink-900">Providers</h3>
          <p className="mt-0.5 text-sm text-ink-800">Which of the platform's providers people here may pick at the prompt.</p>
          <ul className="mt-3 divide-y divide-line-subtle">
            {data.available.map((provider) => (
              <li key={provider.key} className="flex items-center gap-3 py-3">
                <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-subtle text-sm font-bold text-ink-900">{provider.mark}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900">{provider.name}</p>
                  <p className="text-xs text-ink-800">{provider.models.join(', ')}</p>
                </div>
                <Switch checked={data.providers[provider.key as 'anthropic' | 'openai']} disabled={save.isPending || !data.enabled} ariaLabel={`Allow ${provider.name}`}
                  onChange={(next) => save.mutate({ providers: { [provider.key]: next } })} />
              </li>
            ))}
          </ul>
        </section>
      )}

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
          {use.limit !== null ? `${formatNumber(use.limit)} a month${use.plan ? ` on the ${use.plan} plan` : ''}. ` : 'No limit on this plan. '}
          Only a draft counts; a question back does not. Prompts and drafts are kept for {data.retention_days} days for your audit log.
        </p>
      </section>
    </div>
  )
}
