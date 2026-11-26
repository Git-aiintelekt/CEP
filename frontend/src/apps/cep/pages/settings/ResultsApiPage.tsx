/**
 * Settings → Results API: what to hand the team of a system that reads campaign results from C360 (the address, the headers,
 * the key's scope, the description), then the four lists with their last 24 hours and their pause switch. Keys are still made
 * on API Keys and the full call log stays on Integrations: this page links to both (docs/mockups/results-api-settings.html, option B).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { buttonPrimary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { api, session } from '@/lib/api'
import { formatNumber, formatRelative } from '@/lib/format'
import type { ResultsApiKey, ResultsApiList, ResultsApiSettings } from '@/lib/types'

import { HEALTH } from './IntegrationsPage'
import { RESULTS_API_KEY } from './resultsApi'

const DAY = 86_400_000
const HOLDS: Record<ResultsApiList['kind'], string> = {
  RESULTS_CAMPAIGNS: 'Totals, held-back people and money',
  RESULTS_RUNS: 'The same totals for each send',
  RESULTS_MESSAGES: 'One row a recipient, by party ID',
  RESULTS_SUPPRESSIONS: 'Who must not be contacted, by party ID',
}
const label = 'text-xs font-semibold tracking-wide text-ink-800 uppercase'
const inline = 'font-semibold text-brand-800 hover:underline'

/** a key that stops working within a month says so beside its name */
function named(key: ResultsApiKey, now: number): string {
  if (!key.expires_at) return key.name
  const days = Math.ceil((new Date(key.expires_at).getTime() - now) / DAY)
  if (days > 30) return key.name
  return `${key.name} (expires ${days <= 0 ? 'today' : days === 1 ? 'in 1 day' : `in ${days} days`})`
}

/** `canPause` and the two addresses stand in for the signed-in person and the app's routes in the /dev/settings playground */
export function ResultsApiPage({ canPause, apiKeysTo = '/settings/api-keys', integrationsTo = '/settings/integrations' }: { canPause?: boolean; apiKeysTo?: string; integrationsTo?: string }) {
  const { can } = useAuth()
  const mayPause = canPause ?? can('provider.edit')
  const queryClient = useQueryClient()
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const settings = useQuery({ queryKey: RESULTS_API_KEY, queryFn: ({ signal }) => api.get<ResultsApiSettings>('/workspace/results-api/', undefined, signal), refetchInterval: 60_000 })
  const toggle = useMutation({
    mutationFn: (row: ResultsApiList) => api.post(`/integrations/${row.integration_id}/${row.status === 'PAUSED' ? 'resume' : 'pause'}/`),
    onSuccess: (_next, row) => {
      if (row.status === 'PAUSED') toast.success('List resumed', `${row.name} can be read again.`)
      else toast.success('List paused', `${row.name} answers “paused” until it is resumed.`)
      void queryClient.invalidateQueries({ queryKey: ['integrations'] })
      return queryClient.invalidateQueries({ queryKey: RESULTS_API_KEY })
    },
  })

  if (settings.isError) return <ErrorState title="The Results API could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = settings.data
  const now = settings.dataUpdatedAt                                                  // "12 min ago" and "expires in 9 days" are as of the last read of the page's data
  const quiet = data.lists.every((row) => !row.calls_24h && !row.last_call_at)        // nothing has read yet: the table says what there is, not what happened
  const copy = () => void navigator.clipboard?.writeText(data.endpoint).then(() => setCopied(true), () => undefined)

  function toggleWithConfirm(row: ResultsApiList) {
    if (row.status === 'PAUSED' || window.confirm(`Pause ${row.name}? The system reading this list is answered “paused” until it is resumed. The other lists go on.`)) toggle.mutate(row)
  }

  const list: Column<ResultsApiList> = { key: 'list', header: 'List', render: (row) => (
    <span className="flex flex-col"><span className="font-medium text-ink-900">{row.name}</span><span className="text-helper text-ink-800">{HOLDS[row.kind]}</span></span>) }
  const address: Column<ResultsApiList> = { key: 'address', header: 'Address', render: (row) => <code className="text-ink-900">{row.path}</code> }
  const status: Column<ResultsApiList> = { key: 'status', header: 'Status', render: (row) => {
    const health = HEALTH[row.health] ?? HEALTH.idle
    return <StatusBadge status={health.status} label={health.label} />
  } }
  const columns: Column<ResultsApiList>[] = quiet
    ? [list, address, { key: 'limit', header: 'Limit a Minute', render: (row) => <span className="cep-num">{formatNumber(row.limit_per_minute)}</span> }, status]
    : [list, address,
        { key: 'calls', header: 'Calls', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.calls_24h)}</span> },
        { key: 'throttled', header: 'Throttled', align: 'right', render: (row) => (
          <span className={`cep-num ${row.throttled_24h > 0 ? 'font-medium text-warning-text' : ''}`} title={`The limit is ${formatNumber(row.limit_per_minute)} calls a minute. Calls held by it are slowed, not lost.`}>
            {formatNumber(row.throttled_24h)}</span>) },
        { key: 'last', header: 'Last Read', render: (row) => (
          <span className="flex flex-col"><span className="text-ink-900">{row.last_call_at ? formatRelative(row.last_call_at, now) : 'Not Yet'}</span>
            {row.last_read_by && <span className="text-helper text-ink-800">{row.last_read_by}</span>}</span>) },
        status,
        { key: 'action', header: '', align: 'right', render: (row) => mayPause && row.integration_id
          ? <Button size="sm" loading={toggle.isPending && toggle.variables?.kind === row.kind} onClick={() => toggleWithConfirm(row)} aria-label={`${row.status === 'PAUSED' ? 'Resume' : 'Pause'} ${row.name}`}>
              {row.status === 'PAUSED' ? 'Resume' : 'Pause'}</Button>
          : null },
      ]

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Results API</h2>
        <p className="mt-0.5 max-w-4xl text-sm text-ink-800">Other systems read your campaign results from here. They call C360 when they want the figures; C360 never calls them.</p>
      </div>
      {toggle.isError && <ErrorState title={toggle.variables?.status === 'PAUSED' ? 'The list was not resumed' : 'The list was not paused'} error={toggle.error} />}

      <section aria-labelledby="results-connect" className="rounded-lg border border-line bg-surface p-5">
        <h3 id="results-connect" className="font-display text-card-heading font-semibold text-ink-900">Connect a System</h3>
        <p className="mt-0.5 text-helper text-ink-800">Give these to the team that builds the other system.</p>
        <dl className="mt-4 space-y-4 text-sm">
          <div>
            <dt className={label}>Base Address (GET, JSON or CSV)</dt>
            <dd className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-subtle px-3 py-2"><code className="min-w-0 break-all text-ink-900">{data.endpoint}</code>
              <button type="button" className={`shrink-0 text-sm ${inline}`} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></dd>
          </div>
          <div>
            <dt className={label}>Headers</dt>
            <dd className="mt-1 text-ink-800"><code>Authorization: Bearer &lt;the API key&gt;</code> and <code>X-Tenant: {session.tenant}</code>.</dd>
          </div>
          <div>
            <dt className={label}>API Key</dt>
            {data.keys.length > 0 ? (
              <dd className="mt-1 text-ink-800">
                A key with the scope <code>{data.scope}</code> and no other, made under <Link to={apiKeysTo} className={inline}>API Keys</Link>.{' '}
                <span className="font-semibold text-ink-900">{formatNumber(data.keys.length)} active key{data.keys.length === 1 ? ' has' : 's have'} it:</span>{' '}
                {data.keys.map((key) => named(key, now)).join(', ')}.
              </dd>
            ) : (
              <dd className="mt-1 text-ink-800">
                A key with the scope <code>{data.scope}</code> and no other. <span className="font-semibold text-ink-900">No key has it yet</span>, so nothing can be read.
                <span className="mt-3 block"><Link to={apiKeysTo} className={buttonPrimary}>Go to API Keys</Link></span>
              </dd>
            )}
          </div>
          <div>
            <dt className={label}>Specification</dt>
            <dd className="mt-1 text-ink-800">
              Every address, field and limit: <a href={data.description_url} target="_blank" rel="noreferrer" className={inline}>Open API Description</a>.
              The Word copy, <i>CEP Results API: Integration Specification</i>, with the test checklist, comes from the platform team.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="results-lists" className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-6 py-4">
          <div>
            <h3 id="results-lists" className="font-display text-card-heading font-semibold text-ink-900">The Four Lists</h3>
            <p className="mt-0.5 text-helper text-ink-800">{quiet ? '' : 'The last 24 hours. '}Nothing personal is answered: a customer is a party ID.</p>
          </div>
          {!quiet && <Link to={integrationsTo} className={`text-sm ${inline}`}>View Log in Integrations</Link>}
        </div>
        <DataTable columns={columns} rows={data.lists} rowKey={(row) => row.kind} caption="The four lists" framed={false} inset="card" primary="list" />
      </section>
    </div>
  )
}
