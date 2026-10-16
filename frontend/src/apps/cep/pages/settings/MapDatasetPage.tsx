/**
 * Settings → Report Databases → Map a Dataset (Option A of docs/mockups/report-databases.html): the tables and views the account can
 * read on the left, views first; the chosen one's columns on the right, each a field with a label, a type, a role, its calculations
 * and a sensitivity, with the first rows underneath, the labels applied. Save Dataset puts it in New Report for this workspace. The
 * same page edits a mapped dataset's fields.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Aggregate, FieldType, ReportDatabase, ReportDataset, ReportDatasetField, SourceColumns, SourceInfo } from '@/apps/insights/types'
import { DATABASES_KEY } from './reportDatabases'

const TYPE_LABEL: Record<FieldType, string> = { string: 'Text', number: 'Number', date: 'Date', datetime: 'Date and time', boolean: 'Yes/No' }
const AGG_LABEL: Record<Aggregate, string> = { sum: 'Sum', count: 'Count', count_distinct: 'Distinct', avg: 'Average', min: 'Min', max: 'Max' }
const SENS_LABEL = { NORMAL: 'Normal', PII: 'Personal', CONFIDENTIAL: 'Confidential' } as const
type Row = ReportDatasetField & { use: boolean; column_type: string; mappable: boolean }

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const t = window.setTimeout(() => setDebounced(value), ms); return () => window.clearTimeout(t) }, [value, ms])
  return debounced
}

export function MapDatasetPage() {
  const { id, datasetId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const database = useQuery({ queryKey: ['workspace', 'report-database', id], queryFn: ({ signal }) => api.get<ReportDatabase>(`/workspace/report-databases/${id}/`, undefined, signal), enabled: Boolean(id) })
  const sources = useQuery({ queryKey: ['workspace', 'report-database', id, 'sources'], queryFn: ({ signal }) => api.get<{ sources: SourceInfo[] }>(`/workspace/report-databases/${id}/sources/`, undefined, signal), enabled: Boolean(id) })
  const existing = useQuery({ queryKey: ['workspace', 'report-dataset', datasetId], queryFn: ({ signal }) => api.get<ReportDataset>(`/workspace/report-databases/datasets/${datasetId}/`, undefined, signal), enabled: Boolean(datasetId) })
  const [q, setQ] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [primaryKey, setPrimaryKey] = useState('')
  const [timeField, setTimeField] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const chosen = source ?? existing.data?.source ?? null
  const columns = useQuery({ queryKey: ['workspace', 'report-database', id, 'source', chosen], queryFn: ({ signal }) => api.get<SourceColumns>(`/workspace/report-databases/${id}/sources/${chosen}/`, undefined, signal), enabled: Boolean(id && chosen) })

  useEffect(() => {                                   // the saved dataset fills the form once it arrives
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (existing.data && !source) { setLabel(existing.data.label); setDescription(existing.data.description ?? ''); setPrimaryKey(existing.data.primary_key ?? ''); setTimeField(existing.data.time_field ?? '') }
  }, [existing.data, source])
  useEffect(() => {                                   // the source's columns become editable rows once read
    if (!columns.data) return
    const saved = existing.data && existing.data.source === columns.data.source ? existing.data.fields : []
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(columns.data.columns.map((c) => {
      const kept = saved.find((f) => f.column === c.column)
      return { use: kept ? true : saved.length === 0 && c.mappable, mappable: c.mappable, column: c.column, column_type: c.column_type, label: kept?.label ?? titleCase(c.column), type: kept?.type ?? c.type, role: kept?.role ?? c.role,
        aggregates: kept?.aggregates ?? c.aggregates, format: kept?.format ?? c.format, sensitivity: kept?.sensitivity ?? 'NORMAL', key: kept?.key }
    }))
    if (!existing.data && !label) setLabel(titleCase(columns.data.source.replace(/^v_/, '')))
  }, [columns.data, existing.data])     // eslint-disable-line react-hooks/exhaustive-deps

  const fields = useMemo(() => rows.filter((r) => r.use).map(({ use: _use, column_type: _ct, ...f }) => f), [rows])
  const settled = useDebounced({ fields, label }, 700)
  const preview = useQuery({
    queryKey: ['workspace', 'report-database', id, 'preview', chosen, settled],
    queryFn: () => api.post<{ columns: { key: string; label: string; masked: boolean }[]; rows: unknown[][] }>(`/workspace/report-databases/${id}/preview/`, { label: settled.label || 'Dataset', source: chosen, fields: settled.fields }),
    enabled: Boolean(id && chosen && settled.fields.length > 0), retry: false, placeholderData: (previous) => previous,
  })
  const save = useMutation({
    mutationFn: () => {
      const body = { label: label.trim(), description: description.trim(), source: chosen, primary_key: primaryKey || null, time_field: timeField || null, fields }
      return existing.data ? api.put<ReportDataset>(`/workspace/report-databases/datasets/${existing.data.id}/`, { ...body, row_version: existing.data.row_version }) : api.post<ReportDataset>(`/workspace/report-databases/${id}/datasets/`, body)
    },
    onSuccess: (saved) => { toast.success(existing.data ? 'The dataset was saved' : `${saved.label} is ready`, existing.data ? undefined : 'It is in New Report for this workspace.'); void queryClient.invalidateQueries({ queryKey: DATABASES_KEY }); void queryClient.invalidateQueries({ queryKey: ['insights', 'catalog'] }); navigate('/settings/report-databases') },
    onError: (error) => { setErrors(error instanceof ApiError ? error.fieldErrors : {}); toast.failure(error, 'The dataset was not saved') },
  })
  const update = (column: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.column === column ? { ...r, ...patch } : r)))

  if (database.isError) return <ErrorState title="The database could not be loaded" error={database.error} onRetry={() => void database.refetch()} />
  if (database.isPending || (datasetId && existing.isPending)) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const db = database.data
  const list = (sources.data?.sources ?? []).filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()))
  const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">{existing.data ? `${existing.data.label} · Fields` : `Map a Dataset · ${db.name}`}</h2>
          <p className="mt-0.5 text-sm text-ink-800">Pick a table or view, then say what each column is. Report authors see your labels, never column names.</p>
        </div>
        <Link to="/settings/report-databases" className={buttonSecondary}>Back to Report Databases</Link>
      </div>
      {!db.usable && <ErrorState title="This database cannot be read yet" error={new Error(db.read_only === false ? 'The account can write. Give the engine a SELECT-only account and test the connection again.' : 'Test the connection first.')} />}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside aria-label="Tables and views" className="flex flex-col gap-2">
          <label className="relative">
            <span className="sr-only">Search tables and views</span>
            <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tables and views" className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
          </label>
          {sources.isError ? <ErrorState error={sources.error} onRetry={() => void sources.refetch()} /> : sources.isPending ? <Spinner label="Reading the tables" /> : (
            <div className="max-h-[520px] overflow-auto rounded-md border border-line bg-surface text-sm">
              {(['view', 'table'] as const).map((kind) => {
                const items = list.filter((s) => s.kind === kind)
                if (!items.length) return null
                return (
                  <div key={kind}>
                    <p className="border-b border-line-subtle bg-surface-subtle px-3 py-1.5 text-[11px] font-semibold tracking-wide text-ink-700 uppercase">{kind === 'view' ? 'Views' : 'Tables'} · {items.length}</p>
                    {items.map((s) => (
                      <button key={s.name} type="button" disabled={!s.mappable || !db.usable} onClick={() => { setSource(s.name); setErrors({}) }} aria-pressed={chosen === s.name}
                        className={`flex w-full items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:text-ink-300 ${chosen === s.name ? 'bg-brand-100 text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.name}</span>
                        <span className="text-[11px] whitespace-nowrap text-ink-800">{s.columns} columns{s.rows != null ? ` · ${compact(s.rows)} rows` : ''}{s.mapped_as ? ' · mapped' : ''}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
              {list.length === 0 && <p className="px-3 py-4 text-xs text-ink-800">Nothing matches.</p>}
            </div>
          )}
          <p className="text-xs text-ink-800">A view is the safest source: it shows only what you put in it, already joined. Big tables run under the engine's limits like any report.</p>
        </aside>

        <section className="min-w-0 space-y-3">
          {!chosen ? (
            <EmptyState title="Pick a table or view" hint="Its columns appear here, each one a field you name." />
          ) : columns.isError ? (
            <ErrorState title="The columns could not be read" error={columns.error} onRetry={() => void columns.refetch()} />
          ) : columns.isPending ? (
            <Spinner label="Reading the columns" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Dataset Name" required error={errors.label}>{({ id: fid, describedBy, invalid }) => <TextInput id={fid} describedBy={describedBy} invalid={invalid} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />}</Field>
                <Field label="Description" error={errors.description}>{({ id: fid, describedBy, invalid }) => <TextInput id={fid} describedBy={describedBy} invalid={invalid} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}</Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Row Key" error={errors.primary_key} hint="What one row is; optional.">{({ id: fid, describedBy }) => <Select id={fid} describedBy={describedBy} value={primaryKey} onChange={(e) => setPrimaryKey(e.target.value)}><option value="">None</option>{fields.map((f) => <option key={f.column} value={keyOf(f)}>{f.label}</option>)}</Select>}</Field>
                <Field label="Time Field" error={errors.time_field} hint="The date a period filter applies to.">{({ id: fid, describedBy }) => <Select id={fid} describedBy={describedBy} value={timeField} onChange={(e) => setTimeField(e.target.value)}><option value="">None</option>{dateFields.map((f) => <option key={f.column} value={keyOf(f)}>{f.label}</option>)}</Select>}</Field>
              </div>
              <div className="overflow-x-auto rounded-md border border-line bg-surface">
                <table className="w-full text-sm" aria-label="Columns">
                  <thead><tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase"><th className="w-10 px-2 py-2 text-center">Use</th><th className="px-2 py-2">Column</th><th className="px-2 py-2">Label</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Role</th><th className="px-2 py-2">Calculations</th><th className="px-2 py-2">Sensitivity</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.column} className={`border-t border-line-subtle ${r.use ? '' : 'text-ink-700'}`}>
                        <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`Use ${r.column}`} checked={r.use} disabled={!r.mappable} onChange={(e) => update(r.column, { use: e.target.checked })} className="h-4 w-4 accent-brand-600" /></td>
                        <td className="px-2 py-1.5"><span className="font-mono text-xs text-ink-900">{r.column}</span><span className="block font-mono text-[11px] text-ink-700">{r.column_type}</span></td>
                        <td className="px-2 py-1.5"><TextInput aria-label={`${r.column} label`} value={r.label} onChange={(e) => update(r.column, { label: e.target.value })} disabled={!r.use} maxLength={100} className="!mt-0 h-8 min-w-36" /></td>
                        <td className="px-2 py-1.5"><Select aria-label={`${r.column} type`} value={r.type} disabled={!r.use} onChange={(e) => { const type = e.target.value as FieldType; update(r.column, { type, ...(type !== 'number' ? { role: 'dimension', aggregates: [] } : {}) }) }} className="!mt-0 h-8">{(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select></td>
                        <td className="px-2 py-1.5"><Select aria-label={`${r.column} role`} value={r.role} disabled={!r.use || r.type !== 'number'} onChange={(e) => { const role = e.target.value as Row['role']; update(r.column, { role, aggregates: role === 'measure' && r.aggregates.length === 0 ? ['sum'] : role === 'measure' ? r.aggregates : [] }) }} className="!mt-0 h-8"><option value="dimension">Dimension</option><option value="measure">Measure</option></Select></td>
                        <td className="px-2 py-1.5">{r.role === 'measure' && r.use ? (
                          <div className="flex flex-wrap gap-1" role="group" aria-label={`${r.column} calculations`}>
                            {(Object.keys(AGG_LABEL) as Aggregate[]).map((a) => <button key={a} type="button" aria-pressed={r.aggregates.includes(a)} onClick={() => update(r.column, { aggregates: r.aggregates.includes(a) ? r.aggregates.filter((x) => x !== a) : [...r.aggregates, a] })} className={`h-6 rounded-control-md border px-2 text-[11px] font-semibold ${r.aggregates.includes(a) ? 'border-brand-100 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>{AGG_LABEL[a]}</button>)}
                          </div>
                        ) : r.type === 'date' || r.type === 'datetime' ? <span className="text-[11px] text-ink-700">day · week · month · quarter · year</span> : null}</td>
                        <td className="px-2 py-1.5"><Select aria-label={`${r.column} sensitivity`} value={r.sensitivity} disabled={!r.use} onChange={(e) => update(r.column, { sensitivity: e.target.value as Row['sensitivity'] })} className={`!mt-0 h-8 ${r.sensitivity !== 'NORMAL' ? '!border-warning-text' : ''}`}>{(Object.keys(SENS_LABEL) as Row['sensitivity'][]).map((s) => <option key={s} value={s}>{SENS_LABEL[s]}</option>)}</Select></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errors.fields && <p className="text-sm text-danger-text">{errors.fields}</p>}
              <p className="text-xs text-ink-800">Personal fields are masked for readers without the right, as in every dataset. Confidential hides a column from everyone.</p>
              {preview.isError ? <ErrorState title="The preview did not run" error={preview.error} /> : preview.data && (
                <div className="overflow-x-auto rounded-md border border-line bg-surface">
                  <table className="w-full text-xs" aria-label="Preview">
                    <thead><tr className="text-left font-semibold text-ink-800">{preview.data.columns.map((c) => <th key={c.key} className="px-2 py-1.5">{c.label}{c.masked ? ' (masked)' : ''}</th>)}</tr></thead>
                    <tbody>{preview.data.rows.map((row, i) => <tr key={i} className="border-t border-line-subtle">{row.map((v, j) => <td key={j} className="px-2 py-1.5 text-ink-900">{v == null ? '' : String(v)}</td>)}</tr>)}</tbody>
                  </table>
                  <p className="px-2 py-1.5 text-[11px] text-ink-800">Preview: the first {preview.data.rows.length} rows, with your labels{preview.isFetching ? ' · updating' : ''}</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Link to="/settings/report-databases" className={buttonSecondary}>Cancel</Link>
                <button type="button" className={buttonPrimary} disabled={save.isPending || !label.trim() || fields.length === 0 || !db.usable} onClick={() => save.mutate()}>Save Dataset</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function keyOf(f: ReportDatasetField): string {
  return f.key ?? f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function titleCase(name: string): string {
  return name.replace(/[_\s]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 10_000 ? `${Math.round(n / 1000)} K` : formatNumber(n)
}
