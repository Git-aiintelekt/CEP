/**
 * New Report, the first step: pick a dataset, grouped by component. The report is created with the dataset's first
 * columns (its dimensions, then its measures totalled) and opened in the viewer; the editor (the option still to be
 * chosen from docs/mockups/report-builder.html) takes it from there. Your Databases holds the workspace's own databases to
 * query, the datasets mapped from them and, for a report author, Connect a Database (Option 1 of
 * docs/mockups/new-report-sources.html); Your Files the uploaded files and Upload a File.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useAuth } from '@/auth/AuthContext'
import { engineMark } from '@/apps/cep/pages/settings/reportDatabases'
import { DatabaseZap, FileUp } from 'lucide-react'
import { insightsApi, useCatalog } from '../api'
import { ConnectDatabaseDrawer } from '../components/ConnectDatabaseDrawer'
import { starterDefinition } from '../starter'
import type { CatalogDataset, QueryTarget } from '../types'

/** canConnect: the /dev/new-report playground's say, which has no session; the page asks the session otherwise */
export function NewReportPage({ canConnect }: { canConnect?: boolean } = {}) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const connects = canConnect ?? can('report.edit')
  const [params] = useSearchParams()
  const [connecting, setConnecting] = useState(false)
  const catalog = useCatalog()
  const targets = useQuery({ queryKey: ['workspace', 'report-databases', 'targets'], queryFn: ({ signal }) => api.get<{ databases: QueryTarget[] }>('/workspace/report-databases/targets/', undefined, signal), retry: false })
  const toast = useToast()
  const [dataset, setDataset] = useState<string>(params.get('dataset') ?? '')
  const [name, setName] = useState('')
  const datasets = (catalog.data?.datasets ?? []).filter((d) => !params.get('component') || d.component.key === params.get('component'))
  const platform = datasets.filter((d) => !d.database && d.kind !== 'upload')
  const own = datasets.filter((d) => d.database)
  const files = datasets.filter((d) => d.kind === 'upload')
  const chosen = datasets.find((d) => d.key === dataset) ?? null
  const create = useMutation({
    mutationFn: () => insightsApi.create({ name: name.trim() || `${chosen?.label} report`, dataset, definition: starterDefinition(chosen as CatalogDataset) }),
    onSuccess: (report) => navigate(`/insights/reports/${report.id}/edit`, { replace: true }),
    onError: (error) => toast.failure(error, 'The report was not created'),
  })

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="New Report" description="Pick what to report on. The report opens in the editor with the dataset's first columns." help={<PageHelp chapter="insights" />} />
      {catalog.isPending ? <Spinner label="Loading the datasets" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : (
        <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); if (chosen) create.mutate() }}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink-900">Dataset</legend>
            {Array.from(new Map(platform.map((d) => [d.component.key, d.component])).values()).map((component) => (
              <div key={component.key} className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold tracking-wide text-ink-800 uppercase">{component.name}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {platform.filter((d) => d.component.key === component.key).map((d) => (
                    <label key={d.key} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${dataset === d.key ? 'border-brand-600 bg-brand-100/40' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                      <input type="radio" name="dataset" value={d.key} checked={dataset === d.key} onChange={() => setDataset(d.key)} className="mt-1" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">{d.label}</span>
                        <span className="block text-xs text-ink-800">{d.description}</span>
                        <span className="mt-1 block text-xs text-ink-700">{d.fields.filter((f) => f.role === 'dimension').length} dimensions · {d.fields.filter((f) => f.role === 'measure').length} measures</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {(targets.data?.databases.length ?? 0) + own.length > 0 || connects ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Your Databases</p>
                <ul className="grid gap-2 sm:grid-cols-2" aria-label="Your Databases">
                  {targets.data?.databases.map((t) => (
                    <li key={t.id}><button type="button" onClick={() => navigate(`/insights/reports/new/query/${t.id}`)} className="flex w-full items-start gap-3 rounded-md border border-line bg-surface p-3 text-left transition-colors hover:bg-surface-hover">
                      <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-100 text-[10px] leading-tight font-bold text-brand-800">{engineMark(t.engine)}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">Query {t.name}</span>
                        <span className="block text-xs text-ink-800">{t.engine_name} · {t.database_name}. Pick tables, joins, columns and calculations, or write the SELECT; the report is built on the result.</span>
                      </span>
                    </button></li>
                  ))}
                  {own.map((d) => (
                    <li key={d.key}>
                      <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${dataset === d.key ? 'border-brand-600 bg-brand-100/40' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                        <input type="radio" name="dataset" value={d.key} checked={dataset === d.key} onChange={() => setDataset(d.key)} className="mt-1" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink-900">{d.label}</span>
                          <span className="block text-xs text-ink-800">{[d.description, `${d.database?.name} (${d.database?.engine_name})`, d.kind === 'query' ? 'from a query' : null].filter(Boolean).join(' · ')}</span>
                          <span className="mt-1 block text-xs text-ink-700">{d.fields.filter((f) => f.role === 'dimension').length} dimensions · {d.fields.filter((f) => f.role === 'measure').length} measures</span>
                        </span>
                      </label>
                    </li>
                  ))}
                  {connects && (
                    <li><button type="button" onClick={() => setConnecting(true)} className="flex w-full items-start gap-3 rounded-md border border-dashed border-line-control bg-surface p-3 text-left transition-colors hover:bg-surface-hover">
                      <DatabaseZap size={20} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-700" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">Connect a Database</span>
                        <span className="block text-xs text-ink-800">MySQL, PostgreSQL or ClickHouse, read-only.</span>
                      </span>
                    </button></li>
                  )}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Your Files</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {files.map((d) => (
                  <label key={d.key} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${dataset === d.key ? 'border-brand-600 bg-brand-100/40' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                    <input type="radio" name="dataset" value={d.key} checked={dataset === d.key} onChange={() => setDataset(d.key)} className="mt-1" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink-900">{d.label}</span>
                      <span className="block text-xs text-ink-800">{d.upload?.file_name} · {formatNumber(d.upload?.row_count ?? 0)} rows</span>
                      <span className="mt-1 block text-xs text-ink-700">{d.fields.filter((f) => f.role === 'dimension').length} dimensions · {d.fields.filter((f) => f.role === 'measure').length} measures</span>
                    </span>
                  </label>
                ))}
                <button type="button" onClick={() => navigate('/insights/uploads?upload=1')} className="flex w-full items-start gap-3 rounded-md border border-dashed border-line-control bg-surface p-3 text-left transition-colors hover:bg-surface-hover">
                  <FileUp size={20} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-700" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-900">Upload a File</span>
                    <span className="block text-xs text-ink-800">A CSV or Excel file. Review its columns, and report on it like any dataset.</span>
                  </span>
                </button>
              </div>
            </div>
          </fieldset>
          <Field label="Name" hint="You can rename it later.">
            {({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} value={name} onChange={(event) => setName(event.target.value)} placeholder={chosen ? `${chosen.label} report` : 'Pick a dataset first'} maxLength={200} />}
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonPrimary} disabled={!chosen || create.isPending}>Create Report</button>
            <button type="button" className={buttonSecondary} onClick={() => navigate(-1)}>Cancel</button>
          </div>
        </form>
      )}
      {connecting && <ConnectDatabaseDrawer onClose={() => setConnecting(false)} />}
    </div>
  )
}
