/**
 * Settings → Report Databases → Map a Dataset (Option A and Option J2 of docs/mockups/report-databases.html): the tables and views the
 * account can read on the left, views first; on the right a diagram of the dataset's tables, the base and each joined table as a card
 * with its columns and the keys drawn between them, then the fields grouped by table (label, type, role, calculations, sensitivity)
 * and the first rows underneath with the labels applied. Add a Join brings another table in on a key, to the base or to a table
 * already joined; the join is checked before it is added. Save Dataset puts it in New Report for this workspace. The same page
 * edits a mapped dataset.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Aggregate, DatasetJoin, FieldType, JoinCheck, ReportDatabase, ReportDataset, ReportDatasetField, SourceColumns, SourceInfo } from '@/apps/insights/types'
import { DATABASES_KEY } from './reportDatabases'

const TYPE_LABEL: Record<FieldType, string> = { string: 'Text', number: 'Number', date: 'Date', datetime: 'Date and time', boolean: 'Yes/No' }
const AGG_LABEL: Record<Aggregate, string> = { sum: 'Sum', count: 'Count', count_distinct: 'Distinct', avg: 'Average', min: 'Min', max: 'Max' }
const SENS_LABEL = { NORMAL: 'Normal', PII: 'Personal', CONFIDENTIAL: 'Confidential' } as const
const MAX_JOINS = 5
/** the table badges: the base, then one tone per join */
const TONES = ['bg-fill-subtle text-ink-900', 'bg-brand-100 text-brand-800', 'bg-teal-100 text-teal-700', 'bg-plum-100 text-plum-700', 'bg-warning-bg text-warning-text', 'bg-success-bg text-success-text']
type Row = ReportDatasetField & { use: boolean; column_type: string; mappable: boolean; table: string }
type Columns = SourceColumns['columns']
type TableRef = { alias: string; table: string; to: string | null }

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
  const [joins, setJoins] = useState<DatasetJoin[] | null>(null)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [primaryKey, setPrimaryKey] = useState('')
  const [timeField, setTimeField] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [columnsByTable, setColumnsByTable] = useState<Record<string, Columns>>({})
  const [adding, setAdding] = useState<{ to: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const chosen = source ?? existing.data?.source ?? null
  const currentJoins = useMemo(() => joins ?? existing.data?.joins ?? [], [joins, existing.data])
  const columns = useQuery({ queryKey: ['workspace', 'report-database', id, 'source', chosen], queryFn: ({ signal }) => api.get<SourceColumns>(`/workspace/report-databases/${id}/sources/${chosen}/`, undefined, signal), enabled: Boolean(id && chosen) })
  const tables = useMemo<TableRef[]>(() => [{ alias: 't0', table: chosen ?? '', to: null }, ...currentJoins.map((j) => ({ alias: j.alias, table: j.table, to: j.to }))], [chosen, currentJoins])

  useEffect(() => {                                   // the saved dataset fills the form once it arrives
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (existing.data && !source) { setLabel(existing.data.label); setDescription(existing.data.description ?? ''); setPrimaryKey(existing.data.primary_key ?? ''); setTimeField(existing.data.time_field ?? '') }
  }, [existing.data, source])
  useEffect(() => {                                   // the base's columns become editable rows once read
    if (!columns.data) return
    const got = columns.data
    const saved = existing.data && existing.data.source === got.source ? existing.data.fields.filter((f) => !f.table || f.table === 't0') : []
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColumnsByTable((all) => ({ ...all, [got.source]: got.columns }))
    setRows((all) => [...rowsFor('t0', got.source, got.columns, saved, saved.length === 0), ...all.filter((r) => r.table !== 't0')])
    if (!existing.data && !label) setLabel(titleCase(got.source.replace(/^v_/, '')))
  }, [columns.data, existing.data])     // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                   // a saved dataset's joined tables: their columns are read for the diagram
    if (!existing.data || joins !== null || !id) return
    for (const join of existing.data.joins) {
      void api.get<SourceColumns>(`/workspace/report-databases/${id}/sources/${join.table}/`).then((got) => {
        setColumnsByTable((all) => ({ ...all, [join.table]: got.columns }))
        const saved = existing.data?.fields.filter((f) => f.table === join.alias) ?? []
        setRows((all) => [...all.filter((r) => r.table !== join.alias), ...rowsFor(join.alias, join.table, got.columns, saved, false)])
      })
    }
  }, [existing.data, joins, id])

  const fields = useMemo(() => rows.filter((r) => r.use).map(({ use: _use, column_type: _ct, mappable: _m, ...f }) => (currentJoins.length ? f : { ...f, table: undefined })), [rows, currentJoins.length])
  const settled = useDebounced({ fields, label, joins: currentJoins }, 700)
  const preview = useQuery({
    queryKey: ['workspace', 'report-database', id, 'preview', chosen, settled],
    queryFn: () => api.post<{ columns: { key: string; label: string; masked: boolean }[]; rows: unknown[][] }>(`/workspace/report-databases/${id}/preview/`, { label: settled.label || 'Dataset', source: chosen, joins: settled.joins, fields: settled.fields }),
    enabled: Boolean(id && chosen && settled.fields.length > 0), retry: false, placeholderData: (previous) => previous,
  })
  const save = useMutation({
    mutationFn: () => {
      const body = { label: label.trim(), description: description.trim(), source: chosen, joins: currentJoins, primary_key: primaryKey || null, time_field: timeField || null, fields }
      return existing.data ? api.put<ReportDataset>(`/workspace/report-databases/datasets/${existing.data.id}/`, { ...body, row_version: existing.data.row_version }) : api.post<ReportDataset>(`/workspace/report-databases/${id}/datasets/`, body)
    },
    onSuccess: (saved) => { toast.success(existing.data ? 'The dataset was saved' : `${saved.label} is ready`, existing.data ? undefined : 'It is in New Report for this workspace.'); void queryClient.invalidateQueries({ queryKey: DATABASES_KEY }); void queryClient.invalidateQueries({ queryKey: ['insights', 'catalog'] }); navigate('/settings/report-databases') },
    onError: (error) => { setErrors(error instanceof ApiError ? error.fieldErrors : {}); toast.failure(error, 'The dataset was not saved') },
  })
  const update = (table: string, column: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.table === table && r.column === column ? { ...r, ...patch } : r)))
  const pickSource = (name: string) => { setSource(name); setJoins([]); setRows([]); setErrors({}) }
  const addJoin = (join: DatasetJoin, got: Columns) => {
    setJoins([...currentJoins, join])
    setColumnsByTable((all) => ({ ...all, [join.table]: got }))
    setRows((all) => [...all, ...rowsFor(join.alias, join.table, got, [], true)])
    setAdding(null)
  }
  const removeJoin = (alias: string) => {
    const gone = new Set<string>([alias])
    for (const j of currentJoins) if (gone.has(j.to)) gone.add(j.alias)
    const kept = currentJoins.filter((j) => !gone.has(j.alias))
    const renamed = new Map(kept.map((j, i) => [j.alias, `t${i + 1}`]))
    setJoins(kept.map((j, i) => ({ ...j, alias: `t${i + 1}`, to: renamed.get(j.to) ?? j.to })))
    setRows((all) => all.filter((r) => !gone.has(r.table)).map((r) => ({ ...r, table: renamed.get(r.table) ?? r.table })))
  }

  if (database.isError) return <ErrorState title="The database could not be loaded" error={database.error} onRetry={() => void database.refetch()} />
  if (database.isPending || (datasetId && existing.isPending)) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const db = database.data
  const list = (sources.data?.sources ?? []).filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()))
  const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime')
  const toneOf = (alias: string) => TONES[Math.min(Number(alias.slice(1)), TONES.length - 1)]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">{existing.data ? `${existing.data.label} · Fields` : `Map a Dataset · ${db.name}`}</h2>
          <p className="mt-0.5 text-sm text-ink-800">Pick a table or view, join what it needs, then say what each column is. Report authors see your labels, never column or table names.</p>
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
                    {items.map((s) => {
                      const joined = tables.some((t) => t.table === s.name && t.alias !== 't0')
                      return (
                        <button key={s.name} type="button" disabled={!s.mappable || !db.usable} onClick={() => pickSource(s.name)} aria-pressed={chosen === s.name}
                          className={`flex w-full items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:text-ink-300 ${chosen === s.name ? 'bg-brand-100 text-brand-800' : joined ? 'bg-surface-subtle text-ink-900' : 'text-ink-900 hover:bg-surface-hover'}`}>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.name}</span>
                          <span className="text-[11px] whitespace-nowrap text-ink-800">{s.columns} columns{s.rows != null ? ` · ${compact(s.rows)} rows` : ''}{chosen === s.name ? ' · base' : joined ? ' · joined' : s.mapped_as ? ' · mapped' : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
              {list.length === 0 && <p className="px-3 py-4 text-xs text-ink-800">Nothing matches.</p>}
            </div>
          )}
          <p className="text-xs text-ink-800">The base table is the first you pick; Add a Join brings in another table's columns on a key. A view that already joins the tables is the simplest source.</p>
        </aside>

        <section className="min-w-0 space-y-3">
          {!chosen ? (
            <EmptyState title="Pick a table or view" hint="Its columns appear here, each one a field you name. Join other tables to it when a report needs their columns." />
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

              <div className="flex flex-wrap items-center gap-2">
                {tables.map((t) => <span key={t.alias} className={`inline-flex h-6 items-center rounded-sm px-2 font-mono text-xs font-semibold ${toneOf(t.alias)}`}>{t.table}{t.alias === 't0' ? ' · base' : ''}</span>)}
                <span className="text-xs text-ink-800">{currentJoins.length === 0 ? 'No join yet.' : `${currentJoins.length} of up to ${MAX_JOINS} joins`}</span>
                <Button variant="secondary" size="sm" className="ml-auto" disabled={currentJoins.length >= MAX_JOINS || !db.usable} onClick={() => setAdding({ to: 't0' })}><Plus size={14} strokeWidth={1.5} aria-hidden />Add a Join</Button>
              </div>
              <Diagram tables={tables} joins={currentJoins} rows={rows} columnsByTable={columnsByTable} toneOf={toneOf} onToggle={(table, column, use) => update(table, column, { use })} onRemove={removeJoin} onJoinTo={(alias) => setAdding({ to: alias })} canJoin={currentJoins.length < MAX_JOINS && db.usable} />
              {errors.joins && <p className="text-sm text-danger-text">{errors.joins}</p>}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Row Key" error={errors.primary_key} hint="What one row is; optional.">{({ id: fid, describedBy }) => <Select id={fid} describedBy={describedBy} value={primaryKey} onChange={(e) => setPrimaryKey(e.target.value)}><option value="">None</option>{fields.map((f) => <option key={`${f.table}.${f.column}`} value={keyOf(f)}>{f.label}</option>)}</Select>}</Field>
                <Field label="Time Field" error={errors.time_field} hint="The date a period filter applies to.">{({ id: fid, describedBy }) => <Select id={fid} describedBy={describedBy} value={timeField} onChange={(e) => setTimeField(e.target.value)}><option value="">None</option>{dateFields.map((f) => <option key={`${f.table}.${f.column}`} value={keyOf(f)}>{f.label}</option>)}</Select>}</Field>
              </div>
              <div className="overflow-x-auto rounded-md border border-line bg-surface">
                <table className="w-full text-sm" aria-label="Columns">
                  <thead><tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase"><th className="w-10 px-2 py-2 text-center">Use</th><th className="px-2 py-2">Column</th><th className="px-2 py-2">Label</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Role</th><th className="px-2 py-2">Calculations</th><th className="px-2 py-2">Sensitivity</th></tr></thead>
                  <tbody>
                    {tables.map((t) => {
                      const mine = rows.filter((r) => r.table === t.alias)
                      const join = currentJoins.find((j) => j.alias === t.alias)
                      return [
                        currentJoins.length > 0 && (
                          <tr key={`${t.alias}-group`} className="border-t border-line-subtle bg-surface-subtle"><th scope="rowgroup" colSpan={7} className="px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-ink-700 uppercase">
                            <span className={`mr-2 inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-[11px] normal-case tracking-normal ${toneOf(t.alias)}`}>{t.table}</span>
                            {t.alias === 't0' ? 'base' : `${join?.type === 'inner' ? 'Inner' : 'Left'} on ${join?.on.map(([a, b]) => `${a} = ${b}`).join(', ')}`} · {mine.filter((r) => r.use).length} of {mine.length} used
                          </th></tr>
                        ),
                        ...mine.map((r) => (
                          <tr key={`${r.table}.${r.column}`} className={`border-t border-line-subtle ${r.use ? '' : 'text-ink-700'}`}>
                            <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`Use ${r.column}${currentJoins.length ? ` of ${t.table}` : ''}`} checked={r.use} disabled={!r.mappable} onChange={(e) => update(r.table, r.column, { use: e.target.checked })} className="h-4 w-4 accent-brand-600" /></td>
                            <td className="px-2 py-1.5"><span className="font-mono text-xs text-ink-900">{r.column}</span><span className="block font-mono text-[11px] text-ink-700">{r.column_type}{isKey(currentJoins, r.table, r.column) ? ' · key' : ''}</span></td>
                            <td className="px-2 py-1.5"><TextInput aria-label={`${r.column} label`} value={r.label} onChange={(e) => update(r.table, r.column, { label: e.target.value })} disabled={!r.use} maxLength={100} className="!mt-0 h-8 min-w-36" /></td>
                            <td className="px-2 py-1.5"><Select aria-label={`${r.column} type`} value={r.type} disabled={!r.use} onChange={(e) => { const type = e.target.value as FieldType; update(r.table, r.column, { type, ...(type !== 'number' ? { role: 'dimension', aggregates: [] } : {}) }) }} className="!mt-0 h-8">{(Object.keys(TYPE_LABEL) as FieldType[]).map((ty) => <option key={ty} value={ty}>{TYPE_LABEL[ty]}</option>)}</Select></td>
                            <td className="px-2 py-1.5"><Select aria-label={`${r.column} role`} value={r.role} disabled={!r.use || r.type !== 'number'} onChange={(e) => { const role = e.target.value as Row['role']; update(r.table, r.column, { role, aggregates: role === 'measure' && r.aggregates.length === 0 ? ['sum'] : role === 'measure' ? r.aggregates : [] }) }} className="!mt-0 h-8"><option value="dimension">Dimension</option><option value="measure">Measure</option></Select></td>
                            <td className="px-2 py-1.5">{r.role === 'measure' && r.use ? (
                              <div className="flex flex-wrap gap-1" role="group" aria-label={`${r.column} calculations`}>
                                {(Object.keys(AGG_LABEL) as Aggregate[]).map((a) => <button key={a} type="button" aria-pressed={r.aggregates.includes(a)} onClick={() => update(r.table, r.column, { aggregates: r.aggregates.includes(a) ? r.aggregates.filter((x) => x !== a) : [...r.aggregates, a] })} className={`h-6 rounded-control-md border px-2 text-[11px] font-semibold ${r.aggregates.includes(a) ? 'border-brand-100 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>{AGG_LABEL[a]}</button>)}
                              </div>
                            ) : r.type === 'date' || r.type === 'datetime' ? <span className="text-[11px] text-ink-700">day · week · month · quarter · year</span> : null}</td>
                            <td className="px-2 py-1.5"><Select aria-label={`${r.column} sensitivity`} value={r.sensitivity} disabled={!r.use} onChange={(e) => update(r.table, r.column, { sensitivity: e.target.value as Row['sensitivity'] })} className={`!mt-0 h-8 ${r.sensitivity !== 'NORMAL' ? '!border-warning-text' : ''}`}>{(Object.keys(SENS_LABEL) as Row['sensitivity'][]).map((s) => <option key={s} value={s}>{SENS_LABEL[s]}</option>)}</Select></td>
                          </tr>
                        )),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
              {errors.fields && <p className="text-sm text-danger-text">{errors.fields}</p>}
              <p className="text-xs text-ink-800">Personal fields are masked for readers without the right, as in every dataset. Confidential hides a column from everyone. A key column is read for the join whether or not it is a field.</p>
              {preview.isError ? <ErrorState title="The preview did not run" error={preview.error} /> : preview.data && (
                <div className="overflow-x-auto rounded-md border border-line bg-surface">
                  <table className="w-full text-xs" aria-label="Preview">
                    <thead><tr className="text-left font-semibold text-ink-800">{preview.data.columns.map((c) => <th key={c.key} className="px-2 py-1.5">{c.label}{c.masked ? ' (masked)' : ''}</th>)}</tr></thead>
                    <tbody>{preview.data.rows.map((row, i) => <tr key={i} className="border-t border-line-subtle">{row.map((v, j) => <td key={j} className="px-2 py-1.5 text-ink-900">{v == null ? '' : String(v)}</td>)}</tr>)}</tbody>
                  </table>
                  <p className="px-2 py-1.5 text-[11px] text-ink-800">Preview: the first {preview.data.rows.length} {currentJoins.length ? 'joined ' : ''}rows, with your labels{preview.isFetching ? ' · updating' : ''}</p>
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
      {adding && chosen && id && (
        <AddJoinDialog connectionId={id} source={chosen} tables={tables} joins={currentJoins} columnsByTable={columnsByTable} sources={(sources.data?.sources ?? []).filter((s) => s.mappable)} to={adding.to}
          onClose={() => setAdding(null)} onAdd={addJoin} />
      )}
    </div>
  )
}

/** the rows of one table: its columns as fields, ticked by default for the base (all) or kept as saved; a joined table's labels carry its name */
function rowsFor(alias: string, table: string, columns: Columns, saved: ReportDatasetField[], tickAll: boolean): Row[] {
  const prefix = alias === 't0' ? '' : `${titleCase(table.replace(/^(dim_|tbl_)/, '').replace(/s$/, ''))} `
  return columns.map((c) => {
    const kept = saved.find((f) => f.column === c.column)
    return { use: kept ? true : tickAll && c.mappable, mappable: c.mappable, table: alias, column: c.column, column_type: c.column_type, label: kept?.label ?? `${prefix}${titleCase(c.column)}`, type: kept?.type ?? c.type,
      role: kept?.role ?? c.role, aggregates: kept?.aggregates ?? c.aggregates, format: kept?.format ?? c.format, sensitivity: kept?.sensitivity ?? 'NORMAL', key: kept?.key }
  })
}

function isKey(joins: DatasetJoin[], alias: string, column: string): boolean {
  return joins.some((j) => (j.to === alias && j.on.some(([a]) => a === column)) || (j.alias === alias && j.on.some(([, b]) => b === column)))
}

/** Option J2: the tables as cards in columns by depth, the keys drawn as lines between the paired columns */
function Diagram({ tables, joins, rows, columnsByTable, toneOf, onToggle, onRemove, onJoinTo, canJoin }: {
  tables: TableRef[]; joins: DatasetJoin[]; rows: Row[]; columnsByTable: Record<string, Columns>; toneOf: (alias: string) => string
  onToggle: (table: string, column: string, use: boolean) => void; onRemove: (alias: string) => void; onJoinTo: (alias: string) => void; canJoin: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; label: string }[]>([])
  const depth = (alias: string): number => { const j = joins.find((x) => x.alias === alias); return j ? depth(j.to) + 1 : 0 }
  const depths = Array.from({ length: Math.max(0, ...tables.map((t) => depth(t.alias))) + 1 }, (_, i) => i)
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const origin = root.getBoundingClientRect()
    const at = (alias: string, column: string, side: 'left' | 'right') => {
      const el = root.querySelector<HTMLElement>(`[data-cell="${alias}.${column}"]`) ?? root.querySelector<HTMLElement>(`[data-card="${alias}"]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: (side === 'right' ? r.right : r.left) - origin.left + root.scrollLeft, y: r.top + r.height / 2 - origin.top + root.scrollTop }
    }
    setLines(joins.flatMap((j) => j.on.flatMap(([a, b], i) => {
      const from = at(j.to, a, 'right'); const to = at(j.alias, b, 'left')
      return from && to ? [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y, label: i === 0 ? (j.type === 'inner' ? 'INNER' : 'LEFT') : '' }] : []
    })))
  }, [joins, rows, columnsByTable, tables])
  return (
    <div ref={box} className="relative overflow-auto rounded-md border border-line bg-surface-subtle p-3" role="group" aria-label="Tables in this dataset">
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
        {lines.map((l, i) => (
          <g key={i}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="stroke-brand-600" strokeWidth={1.5} />
            {l.label && <text x={(l.x1 + l.x2) / 2} y={Math.min(l.y1, l.y2) - 4} textAnchor="middle" className="fill-brand-800 text-[10px] font-semibold">{l.label}</text>}
          </g>
        ))}
      </svg>
      <div className="relative flex items-start gap-10">
        {depths.map((d) => (
          <div key={d} className="flex shrink-0 flex-col gap-6">
            {tables.filter((t) => depth(t.alias) === d).map((t) => {
              const cols = columnsByTable[t.table] ?? []
              const mine = rows.filter((r) => r.table === t.alias)
              const join = joins.find((j) => j.alias === t.alias)
              return (
                <div key={t.alias} data-card={t.alias} className={`w-56 rounded-md border bg-surface text-xs shadow-xs ${t.alias === 't0' ? 'border-brand-600' : 'border-line'}`} aria-label={`${t.table}${t.alias === 't0' ? ', the base' : `, joined ${join?.type ?? 'left'}`}`}>
                  <div className="flex items-center gap-1.5 border-b border-line-subtle px-2.5 py-1.5">
                    <span className={`inline-flex h-5 items-center rounded-sm px-1.5 font-mono font-semibold ${toneOf(t.alias)}`}>{t.table}</span>
                    <span className="ml-auto text-[11px] text-ink-800">{t.alias === 't0' ? 'base' : join?.type === 'inner' ? 'Inner' : 'Left'}</span>
                    {t.alias !== 't0' && <button type="button" aria-label={`Remove the join to ${t.table}`} onClick={() => onRemove(t.alias)} className="rounded-sm p-0.5 text-ink-700 hover:bg-surface-hover hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>}
                  </div>
                  <ul className="max-h-48 overflow-auto py-1">
                    {cols.map((c) => {
                      const row = mine.find((r) => r.column === c.column)
                      const key = isKey(joins, t.alias, c.column)
                      return (
                        <li key={c.column} data-cell={`${t.alias}.${c.column}`} className={`flex items-center gap-1.5 px-2.5 py-0.5 font-mono ${key ? 'font-semibold text-brand-800' : row?.use ? 'text-ink-900' : 'text-ink-300'}`}>
                          <input type="checkbox" aria-label={`Field ${c.column} of ${t.table}`} checked={Boolean(row?.use)} disabled={!c.mappable} onChange={(e) => onToggle(t.alias, c.column, e.target.checked)} className="h-3 w-3 accent-brand-600" />
                          <span className="truncate">{c.column}</span>{key && <span aria-label="key" className="ml-auto">⚷</span>}
                        </li>
                      )
                    })}
                    {cols.length === 0 && <li className="px-2.5 py-1 text-ink-700">Reading the columns</li>}
                  </ul>
                  <div className="border-t border-line-subtle px-2.5 py-1 text-[11px] text-ink-700">
                    {mine.filter((r) => r.use).length} of {cols.length} as fields{canJoin && <> · <button type="button" className="text-brand-800 hover:underline" onClick={() => onJoinTo(t.alias)}>Join to this</button></>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function AddJoinDialog({ connectionId, source, tables, joins, columnsByTable, sources, to: initialTo, onClose, onAdd }: {
  connectionId: string; source: string; tables: TableRef[]; joins: DatasetJoin[]; columnsByTable: Record<string, Columns>; sources: SourceInfo[]; to: string
  onClose: () => void; onAdd: (join: DatasetJoin, columns: Columns) => void
}) {
  const [to, setTo] = useState(initialTo)
  const [table, setTable] = useState('')
  const [type, setType] = useState<'left' | 'inner'>('left')
  const [pairs, setPairs] = useState<[string, string][]>([['', '']])
  const [check, setCheck] = useState<JoinCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const parentTable = tables.find((t) => t.alias === to)?.table ?? source
  const parentColumns = columnsByTable[parentTable] ?? []
  const other = useQuery({ queryKey: ['workspace', 'report-database', connectionId, 'source', table], queryFn: ({ signal }) => api.get<SourceColumns>(`/workspace/report-databases/${connectionId}/sources/${table}/`, undefined, signal), enabled: Boolean(table) })
  const otherColumns = other.data?.columns ?? []
  useEffect(() => {                                   // a first key pair suggested from matching names
    if (!other.data || pairs.some(([a, b]) => a && b)) return
    const guess = suggestKey(parentTable, parentColumns.map((c) => c.column), other.data.columns.map((c) => c.column), table)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (guess) setPairs([guess])
  }, [other.data])     // eslint-disable-line react-hooks/exhaustive-deps
  const alias = `t${joins.length + 1}`
  const join = (): DatasetJoin => ({ alias, table, type, to, on: pairs.filter(([a, b]) => a && b) })
  const complete = Boolean(table) && join().on.length > 0
  const checkJoin = useMutation({
    mutationFn: () => api.post<JoinCheck>(`/workspace/report-databases/${connectionId}/join-check/`, { source, joins: [...joins, join()] }),
    onSuccess: (got) => { setCheck(got); setError(null) },
    onError: (e) => { setCheck(null); setError(e instanceof ApiError ? e.message : 'The join could not be checked.') },
  })
  const submit = (event: FormEvent) => { event.preventDefault(); if (complete && other.data) onAdd(join(), other.data.columns) }
  return (
    <Modal title="Add a Join" subtitle="Bring another table's columns into this dataset." onClose={onClose} size="lg"
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><Button variant="secondary" disabled={!complete} loading={checkJoin.isPending} onClick={() => checkJoin.mutate()}>Check the Join</Button><button type="submit" form="join-form" className={buttonPrimary} disabled={!complete || !other.data}>Add</button></>}>
      <form id="join-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Join to" hint="The base table, or a table already joined: a chain.">{({ id: fid, describedBy }) => <Select id={fid} describedBy={describedBy} value={to} onChange={(e) => { setTo(e.target.value); setPairs([['', '']]); setCheck(null) }}>{tables.map((t) => <option key={t.alias} value={t.alias}>{t.table}{t.alias === 't0' ? ' (the base)' : ' (already in the dataset)'}</option>)}</Select>}</Field>
        <Field label="Table" required>{({ id: fid, describedBy }) => <Select id={fid} describedBy={describedBy} value={table} onChange={(e) => { setTable(e.target.value); setPairs([['', '']]); setCheck(null) }}><option value="">Choose a table or view</option>{sources.filter((s) => s.name !== source).map((s) => <option key={s.name} value={s.name}>{s.name} · {s.columns} columns{s.rows != null ? ` · ${compact(s.rows)} rows` : ''}</option>)}</Select>}</Field>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold text-ink-900">Keep</legend>
          {([['left', `Every row of ${parentTable} (Left)`, `A ${parentTable} row with no match still shows, with the joined fields empty.`], ['inner', 'Only rows that match (Inner)', `A ${parentTable} row with no match drops out of the dataset.`]] as const).map(([value, title, words]) => (
            <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm ${type === value ? 'border-brand-600 bg-brand-100/40' : 'border-line'}`}>
              <input type="radio" name="join-type" value={value} checked={type === value} onChange={() => { setType(value); setCheck(null) }} className="mt-0.5" />
              <span><span className="block font-semibold text-ink-900">{title}</span><span className="block text-xs text-ink-800">{words}</span></span>
            </label>
          ))}
        </fieldset>
        <div>
          <p className="mb-1 text-sm font-semibold text-ink-900">On <span className="font-normal text-ink-800">· the columns that are equal</span></p>
          {table && other.isPending ? <Spinner size="sm" /> : pairs.map(([a, b], i) => (
            <div key={i} className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-ink-800">{parentTable}</span>
              <Select aria-label={`Key ${i + 1} of ${parentTable}`} value={a} onChange={(e) => { const next = pairs.map((p, k) => (k === i ? [e.target.value, p[1]] as [string, string] : p)); setPairs(next); setCheck(null) }} className="!mt-0 h-8 w-44"><option value="">column</option>{parentColumns.map((c) => <option key={c.column} value={c.column}>{c.column}</option>)}</Select>
              <span>=</span>
              <span className="font-mono text-xs text-ink-800">{table || 'table'}</span>
              <Select aria-label={`Key ${i + 1} of ${table || 'the table'}`} value={b} disabled={!table} onChange={(e) => { const next = pairs.map((p, k) => (k === i ? [p[0], e.target.value] as [string, string] : p)); setPairs(next); setCheck(null) }} className="!mt-0 h-8 w-44"><option value="">column</option>{otherColumns.map((c) => <option key={c.column} value={c.column}>{c.column}</option>)}</Select>
              {pairs.length > 1 && <button type="button" aria-label={`Remove key ${i + 1}`} onClick={() => setPairs(pairs.filter((_, k) => k !== i))} className="text-ink-700 hover:text-ink-900"><X size={14} strokeWidth={1.5} aria-hidden /></button>}
            </div>
          ))}
          {pairs.length < 4 && <button type="button" className="text-xs text-brand-800 hover:underline" onClick={() => setPairs([...pairs, ['', '']])}>+ another pair</button>}
        </div>
        {check && (
          <p className={`rounded-md border px-3 py-2 text-sm ${check.multiplies ? 'border-warning-text bg-warning-bg text-warning-text' : 'border-line bg-surface-subtle text-ink-900'}`} role="status">
            {formatNumber(check.base_rows)} {parentTable} rows, {formatNumber(check.matched_rows)} with a match{check.multiplies ? `; each row matches ${check.factor} on average, so totals will count ${parentTable} rows more than once` : ''}.
          </p>
        )}
        {error && <p className="text-sm text-danger-text" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

/** a first guess at the key: table_id = id, or the same column name on both sides */
function suggestKey(parent: string, parentColumns: string[], otherColumns: string[], other: string): [string, string] | null {
  const singular = other.replace(/^(dim_|tbl_)/, '').replace(/s$/, '')
  const fk = parentColumns.find((c) => c === `${singular}_id` || c === `${other}_id`)
  if (fk && otherColumns.includes('id')) return [fk, 'id']
  const parentSingular = parent.replace(/^(dim_|tbl_)/, '').replace(/s$/, '')
  const back = otherColumns.find((c) => c === `${parentSingular}_id` || c === `${parent}_id`)
  if (back && parentColumns.includes('id')) return ['id', back]
  const shared = parentColumns.find((c) => c !== 'id' && otherColumns.includes(c) && /(_id|_code|sku|key)$/i.test(c))
  return shared ? [shared, shared] : null
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
