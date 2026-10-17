/**
 * Query a Database (Option Q1 of docs/mockups/report-databases.html, section 6): one surface, two modes. The schema the account can
 * read on the left (tables, views, columns; click to insert). Visual builds the query from tables and joins, columns with their
 * calculations, filters, group by and order by, and shows the SQL it writes; SQL is the same window as text, to write, paste or
 * correct, with Write It for Me through the AI assistant. Run previews the rows under the read-only session and the limits. From New
 * Report, Create Report makes a dataset from the result and opens the report in the editor; from Settings, Use as Dataset makes the
 * dataset and opens its fields. The guard rails are the server's: one SELECT, no write or file words, run wrapped with the limit.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Play, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { insightsApi, keys, useAssistant } from '../api'
import { AiPill } from '../components/AskForReport'
import { starterDefinition } from '../starter'
import type { CatalogDataset, QueryRun, QueryTarget, ReportDataset, SourceColumns, SourceInfo } from '../types'
import { CALC, EMPTY_VISUAL, OPS, visualSql, type Op, type Visual, type VisualColumn, type VisualJoin } from './queryBuilder'

type Mode = 'visual' | 'sql'
const MODES: SegmentOption<Mode>[] = [{ value: 'visual', label: 'Visual' }, { value: 'sql', label: 'SQL' }]
export function QueryBuilderPage({ settings = false }: { settings?: boolean }) {
  const { dbId, datasetId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const targets = useQuery({ queryKey: ['workspace', 'report-databases', 'targets'], queryFn: ({ signal }) => api.get<{ databases: QueryTarget[] }>('/workspace/report-databases/targets/', undefined, signal) })
  const sources = useQuery({ queryKey: ['workspace', 'report-database', dbId, 'sources'], queryFn: ({ signal }) => api.get<{ sources: SourceInfo[] }>(`/workspace/report-databases/${dbId}/sources/`, undefined, signal), enabled: Boolean(dbId) })
  const existing = useQuery({ queryKey: ['workspace', 'report-dataset', datasetId], queryFn: ({ signal }) => api.get<ReportDataset>(`/workspace/report-databases/datasets/${datasetId}/`, undefined, signal), enabled: Boolean(datasetId) })
  const assistant = useAssistant()
  const db = targets.data?.databases.find((d) => d.id === dbId)
  const quote = useMemo(() => (db?.engine === 'postgresql' ? (n: string) => `"${n}"` : (n: string) => `\`${n}\``), [db?.engine])
  const [mode, setMode] = useState<Mode>('visual')
  const [visual, setVisual] = useState<Visual>(EMPTY_VISUAL)
  const [sql, setSql] = useState<string | null>(null)                  // null: the window shows what Visual writes; a string: edited by hand
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [columnsByTable, setColumnsByTable] = useState<Record<string, SourceColumns['columns']>>({})
  const [result, setResult] = useState<QueryRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string | null>(null)
  const [name, setName] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {                                   // a saved query opens in the window
    if (!existing.data || loaded) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(true); setSql(existing.data.query_sql ?? ''); setMode('sql'); setName(existing.data.label)
  }, [existing.data, loaded])
  const text = sql ?? visualSql(visual, quote)
  const readColumns = (table: string) => {
    if (columnsByTable[table] || !dbId) return
    void api.get<SourceColumns>(`/workspace/report-databases/${dbId}/sources/${table}/`).then((got) => setColumnsByTable((all) => ({ ...all, [table]: got.columns })))
  }
  const toggle = (table: string) => { setOpen((o) => ({ ...o, [table]: !o[table] })); readColumns(table) }
  const insert = (snippet: string) => {
    if (mode !== 'sql') { setMode('sql') }
    const el = box.current
    const current = sql ?? text
    if (el && document.activeElement === el) {
      const start = el.selectionStart ?? current.length
      setSql(current.slice(0, start) + snippet + current.slice(el.selectionEnd ?? start))
    } else setSql(current ? `${current}${current.endsWith(' ') || current.endsWith('\n') ? '' : ' '}${snippet}` : snippet)
  }
  const run = useMutation({
    mutationFn: () => api.post<QueryRun>(`/workspace/report-databases/${dbId}/query/run/`, { sql: text }),
    onMutate: () => setError(null),
    onSuccess: (got) => setResult(got),
    onError: (e) => { setResult(null); setError(e instanceof ApiError ? e.fieldErrors.sql ?? e.message : 'The query did not run.') },
  })
  const write = useMutation({
    mutationFn: () => api.post<{ sql: string | null; note: string; message: string | null }>(`/workspace/report-databases/${dbId}/query/write/`, { prompt: prompt.trim(), model: model ?? assistant.data?.default_model }),
    onSuccess: (got) => { if (got.sql) { setSql(got.sql); setMode('sql'); setResult(null); setError(null); if (got.note) toast.success('The query is in the window', got.note) } else setError(got.message ?? 'The model did not write a query.') },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'The query was not written.'),
  })
  const create = useMutation({
    mutationFn: async () => {
      const label = name.trim() || (visual.base ? titleCase(visual.base) : 'Query')
      if (existing.data) return { dataset: await api.put<ReportDataset>(`/workspace/report-databases/datasets/${existing.data.id}/`, { label, sql: text, fields: existing.data.fields, row_version: existing.data.row_version }), report: null }
      const dataset = await api.post<ReportDataset>(`/workspace/report-databases/${dbId}/query/dataset/`, { label, sql: text })
      if (settings) return { dataset, report: null }
      const catalog = await insightsApi.catalog()
      const found = catalog.datasets.find((d) => d.key === dataset.key) as CatalogDataset
      const report = await insightsApi.create({ name: label, dataset: dataset.key, definition: starterDefinition(found) })
      return { dataset, report }
    },
    onSuccess: ({ dataset, report }) => {
      void queryClient.invalidateQueries({ queryKey: keys.catalog }); void queryClient.invalidateQueries({ queryKey: ['workspace', 'report-databases'] })
      if (report) { toast.success(`${report.name} is ready`, 'Built on your query; the editor takes it from here.'); navigate(`/insights/reports/${report.id}/edit`, { replace: true }) }
      else { toast.success(existing.data ? 'The query was saved' : `${dataset.label} is a dataset`, existing.data ? undefined : 'Name its fields next.'); navigate(existing.data ? '/settings/report-databases' : `/settings/report-databases/${dbId}/map/${dataset.id}`) }
    },
    onError: (e) => setError(e instanceof ApiError ? e.fieldErrors.sql ?? e.fieldErrors.label ?? e.message : 'The dataset was not created.'),
  })

  if (targets.isPending || (datasetId && existing.isPending)) return <Spinner label="Loading the databases" />
  if (targets.isError) return <ErrorState title="The databases could not be loaded" error={targets.error} onRetry={() => void targets.refetch()} />
  if (!db) return <EmptyState title="No database to query" hint="Connect a database with a SELECT-only account under Settings → Report Databases first." action={<Link to="/settings/report-databases" className={buttonSecondary}>Report Databases</Link>} />
  const list = (sources.data?.sources ?? []).filter((s) => s.mappable && (!q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())))
  const handEdited = sql !== null && sql !== visualSql(visual, quote)
  const tables = [visual.base, ...visual.joins.map((j) => j.table)].filter(Boolean)
  const columnOptions = tables.flatMap((t, i) => (columnsByTable[t] ?? []).map((c) => ({ value: `${i === 0 ? 'b' : `j${i}`}.${c.column}`, label: `${t}.${c.column}` })))
  const finish = existing.data ? 'Save Query' : settings ? 'Use as Dataset' : 'Create Report'

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={existing.data ? `${existing.data.label} · Query` : `Query · ${db.name}`} help={<PageHelp chapter="report-databases" />}
        description={`${db.engine_name} · ${db.database_name}${db.engine === 'postgresql' ? ` · ${db.schema_name}` : ''} · one SELECT · read-only. ${settings ? 'Use as Dataset names its columns and puts it in New Report.' : 'Create Report builds the report on the result and opens the editor.'}`}
        actions={<Link to={settings ? '/settings/report-databases' : '/insights/reports/new'} className={buttonSecondary}>{settings ? 'Back to Report Databases' : 'Back to New Report'}</Link>} />
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside aria-label="Tables and columns" className="flex flex-col gap-2">
          <label className="relative">
            <span className="sr-only">Search tables and columns</span>
            <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tables and columns" className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
          </label>
          {sources.isError ? <ErrorState error={sources.error} onRetry={() => void sources.refetch()} /> : sources.isPending ? <Spinner label="Reading the tables" /> : (
            <div className="max-h-[520px] overflow-auto rounded-md border border-line bg-surface text-xs">
              {list.map((s) => (
                <div key={s.name}>
                  <div className="flex items-center border-b border-line-subtle bg-surface-subtle">
                    <button type="button" aria-expanded={Boolean(open[s.name])} onClick={() => toggle(s.name)} className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left font-mono font-semibold text-ink-900 hover:bg-surface-hover">
                      {open[s.name] ? <ChevronDown size={12} strokeWidth={1.5} aria-hidden /> : <ChevronRight size={12} strokeWidth={1.5} aria-hidden />}<span className="truncate">{s.name}</span>
                    </button>
                    <span className="px-2 text-[11px] whitespace-nowrap text-ink-800">{s.kind === 'view' ? 'view · ' : ''}{s.columns} columns</span>
                    <button type="button" aria-label={`Use ${s.name}`} onClick={() => { if (!visual.base) { setVisual((v) => ({ ...v, base: s.name })); readColumns(s.name); setSql(null); setMode('visual') } else insert(s.name) }} className="px-2 py-1 text-[11px] font-semibold text-brand-800 hover:underline">{visual.base ? 'Insert' : 'From'}</button>
                  </div>
                  {open[s.name] && (
                    <ul>
                      {(columnsByTable[s.name] ?? []).map((c) => (
                        <li key={c.column} className="flex items-center gap-2 border-b border-line-subtle px-2 py-0.5 pl-6 font-mono text-[11px] text-ink-900">
                          <button type="button" onClick={() => insert(`${s.name}.${c.column}`)} className="truncate hover:underline">{c.column}</button>
                          <span className="ml-auto font-sans text-ink-700">{c.column_type}</span>
                        </li>
                      ))}
                      {!columnsByTable[s.name] && <li className="px-6 py-1 text-ink-700">Reading the columns</li>}
                    </ul>
                  )}
                </div>
              ))}
              {list.length === 0 && <p className="px-3 py-4 text-ink-800">Nothing matches.</p>}
            </div>
          )}
          <p className="text-xs text-ink-800">Click a table or column to put its name at the cursor. Only what the account can read is listed.</p>
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl label="Mode" options={MODES} value={mode} onChange={(next) => { if (next === 'visual' && handEdited && !window.confirm('The query was edited by hand. Visual shows the query the builder wrote; your edits stay in SQL until you start over. Switch?')) return; setMode(next) }} />
            <span className="text-xs text-ink-800">{db.engine_name} · one SELECT · read-only</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {handEdited && mode === 'sql' && <Button variant="secondary" size="sm" onClick={() => { if (window.confirm('Drop the hand-written query and start over visually?')) { setSql(null); setVisual(EMPTY_VISUAL); setResult(null); setMode('visual') } }}>Start Over</Button>}
              <Button variant="primary" size="sm" loading={run.isPending} disabled={!text.trim()} onClick={() => run.mutate()}><Play size={14} strokeWidth={1.5} aria-hidden />Run</Button>
            </div>
          </div>

          {mode === 'visual' ? (
            <VisualBuilder visual={visual} onChange={(v) => { setVisual(v); setSql(null); setResult(null) }} tables={(sources.data?.sources ?? []).filter((s) => s.mappable).map((s) => s.name)} columnOptions={columnOptions} columnsByTable={columnsByTable} readColumns={readColumns} handEdited={handEdited} />
          ) : null}
          <div>
            <label className="sr-only" htmlFor="query-sql">SQL</label>
            <textarea id="query-sql" ref={box} value={text} readOnly={mode === 'visual'} onChange={(e) => { setSql(e.target.value); setResult(null) }} spellCheck={false} rows={mode === 'visual' ? 6 : 12}
              placeholder="SELECT …" className={`w-full rounded-md border px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink-900 ${mode === 'visual' ? 'border-line bg-surface-subtle' : 'border-line-control bg-surface focus-visible:border-focus focus-visible:outline-none'} ${error ? '!border-danger-text' : ''}`} />
            <p className="mt-1 text-xs text-ink-800">{mode === 'visual' ? 'Written by the builder; switch to SQL to edit it by hand.' : 'One SELECT. The engine runs it wrapped, SELECT * FROM (…) AS q with the limit, on the read-only session.'}</p>
          </div>
          {error && <p role="alert" className="rounded-md border border-danger-text bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>}

          {assistant.data?.enabled && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-subtle px-3 py-2" aria-label="Write It for Me">
              <AiPill />
              <TextInput aria-label="What should the query give?" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Net sales and units by store and day since September, paid lines only" className="!mt-0 h-8 min-w-60 flex-1" maxLength={1000} />
              <Select aria-label="Model" value={model ?? assistant.data.default_model ?? ''} onChange={(e) => setModel(e.target.value)} className="!mt-0 h-8 w-48">{assistant.data.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
              <Button variant="secondary" size="sm" loading={write.isPending} disabled={!prompt.trim()} onClick={() => write.mutate()}>Write It for Me</Button>
              <span className="basis-full text-xs text-ink-800">Sends the request and the table and column names, never rows. The SQL lands in the window for you to read and run. Counts as one prompt.</span>
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <p className="text-xs text-ink-800"><span className="font-semibold text-ink-900">{formatNumber(result.rows.length)}{result.truncated ? '+' : ''} row{result.rows.length === 1 ? '' : 's'}</span> in {result.ms} ms · {result.columns.length} columns: {result.columns.map((c) => `${c.column} ${c.type}${c.mappable ? '' : ' (not a field: name it)'}`).join(' · ')}{result.truncated ? ` · the first ${result.rows.length} shown` : ''}</p>
              <div className="max-h-80 overflow-auto rounded-md border border-line bg-surface">
                <table className="w-full text-xs" aria-label="Result">
                  <thead><tr className="text-left font-semibold text-ink-800">{result.columns.map((c, i) => <th key={i} className="px-2 py-1.5 font-mono">{c.column}</th>)}</tr></thead>
                  <tbody>{result.rows.map((row, i) => <tr key={i} className="border-t border-line-subtle">{row.map((v, j) => <td key={j} className="px-2 py-1 text-ink-900">{v == null ? '' : String(v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle pt-3">
            <label className="flex items-center gap-2 text-sm text-ink-900"><span>{settings ? 'Dataset name' : 'Report name'}</span><TextInput aria-label={settings ? 'Dataset name' : 'Report name'} value={name} onChange={(e) => setName(e.target.value)} placeholder={visual.base ? titleCase(visual.base) : 'From the query'} className="!mt-0 h-8 w-64" maxLength={100} /></label>
            <button type="button" className={buttonPrimary} disabled={!result || create.isPending} onClick={() => create.mutate()}>{finish}</button>
          </div>
          {!result && <p className="text-right text-xs text-ink-800">Run the query first; {finish} works on what came back.</p>}
        </section>
      </div>
    </div>
  )
}

function VisualBuilder({ visual, onChange, tables, columnOptions, columnsByTable, readColumns, handEdited }: {
  visual: Visual; onChange: (v: Visual) => void; tables: string[]; columnOptions: { value: string; label: string }[]; columnsByTable: Record<string, SourceColumns['columns']>; readColumns: (table: string) => void; handEdited: boolean
}) {
  const set = (patch: Partial<Visual>) => onChange({ ...visual, ...patch })
  const aliasOf = (i: number) => (i === 0 ? 'b' : `j${i}`)
  const tableAt = (i: number) => (i === 0 ? visual.base : visual.joins[i - 1]?.table)
  const colsOf = (i: number) => (columnsByTable[tableAt(i)] ?? []).map((c) => ({ value: `${aliasOf(i)}.${c.column}`, label: `${tableAt(i)}.${c.column}` }))
  const selectClass = '!mt-0 h-8'
  if (handEdited) return <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-800">The query was edited by hand, so Visual cannot show it. Keep working in SQL, or Start Over to build visually.</p>
  if (!visual.base) return <EmptyState title="Pick a table to start from" hint="Press From beside a table on the left, or switch to SQL and write the query yourself." />
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3 text-sm" role="group" aria-label="Visual builder">
      <Row label="From">
        <span className="inline-flex h-8 items-center rounded-control-md bg-fill-subtle px-2 font-mono text-xs text-ink-900">{visual.base} b</span>
        {visual.joins.map((j, i) => (
          <span key={i} className="inline-flex flex-wrap items-center gap-1 rounded-control-md border border-line px-1.5 py-0.5 text-xs">
            <Select aria-label={`Join ${i + 1} type`} value={j.type} onChange={(e) => set({ joins: visual.joins.map((x, k) => (k === i ? { ...x, type: e.target.value as VisualJoin['type'] } : x)) })} className={selectClass}><option value="JOIN">join</option><option value="LEFT JOIN">left join</option></Select>
            <Select aria-label={`Join ${i + 1} table`} value={j.table} onChange={(e) => { readColumns(e.target.value); set({ joins: visual.joins.map((x, k) => (k === i ? { ...x, table: e.target.value, right: '' } : x)) }) }} className={selectClass}><option value="">table</option>{tables.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
            <span>on</span>
            <Select aria-label={`Join ${i + 1} left key`} value={j.left} onChange={(e) => set({ joins: visual.joins.map((x, k) => (k === i ? { ...x, left: e.target.value } : x)) })} className={selectClass}><option value="">column</option>{Array.from({ length: i + 1 }, (_, k) => colsOf(k)).flat().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <span>=</span>
            <Select aria-label={`Join ${i + 1} right key`} value={j.right} onChange={(e) => set({ joins: visual.joins.map((x, k) => (k === i ? { ...x, right: e.target.value } : x)) })} className={selectClass}><option value="">column</option>{colsOf(i + 1).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <button type="button" aria-label={`Remove join ${i + 1}`} onClick={() => set({ joins: visual.joins.filter((_, k) => k !== i) })} className="text-ink-700 hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>
          </span>
        ))}
        {visual.joins.length < 5 && <button type="button" className="h-8 rounded-control-md border border-dashed border-line-control px-2 text-xs text-ink-800 hover:bg-surface-hover" onClick={() => set({ joins: [...visual.joins, { table: '', alias: `j${visual.joins.length + 1}`, type: 'LEFT JOIN', left: '', right: '' }] })}>+ join</button>}
      </Row>
      <Row label="Columns">
        {visual.columns.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-control-md border border-line px-1.5 py-0.5 text-xs">
            <Select aria-label={`Column ${i + 1}`} value={c.expr} onChange={(e) => set({ columns: visual.columns.map((x, k) => (k === i ? { ...x, expr: e.target.value, alias: x.alias || e.target.value.split('.').pop() || '' } : x)) })} className={selectClass}><option value="">column</option><option value="*">* (every row)</option>{columnOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <Select aria-label={`Column ${i + 1} calculation`} value={c.calc} onChange={(e) => set({ columns: visual.columns.map((x, k) => (k === i ? { ...x, calc: e.target.value as VisualColumn['calc'] } : x)) })} className={selectClass}>{(Object.keys(CALC) as (keyof typeof CALC)[]).map((k) => <option key={k} value={k}>{CALC[k]}</option>)}</Select>
            <span>→</span>
            <TextInput aria-label={`Column ${i + 1} alias`} value={c.alias} onChange={(e) => set({ columns: visual.columns.map((x, k) => (k === i ? { ...x, alias: e.target.value.replace(/[^A-Za-z0-9_]/g, '_') } : x)) })} placeholder="alias" className="!mt-0 h-8 w-32" />
            <button type="button" aria-label={`Remove column ${i + 1}`} onClick={() => set({ columns: visual.columns.filter((_, k) => k !== i) })} className="text-ink-700 hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>
          </span>
        ))}
        <button type="button" className="h-8 rounded-control-md border border-dashed border-line-control px-2 text-xs text-ink-800 hover:bg-surface-hover" onClick={() => set({ columns: [...visual.columns, { expr: '', calc: '', alias: '' }] })}>+ column</button>
      </Row>
      <Row label="Where">
        {visual.where.map((w, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-control-md border border-line px-1.5 py-0.5 text-xs">
            <Select aria-label={`Condition ${i + 1} column`} value={w.expr} onChange={(e) => set({ where: visual.where.map((x, k) => (k === i ? { ...x, expr: e.target.value } : x)) })} className={selectClass}><option value="">column</option>{columnOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <Select aria-label={`Condition ${i + 1} operator`} value={w.op} onChange={(e) => set({ where: visual.where.map((x, k) => (k === i ? { ...x, op: e.target.value as Op } : x)) })} className={selectClass}>{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
            {w.op !== 'IS NULL' && w.op !== 'IS NOT NULL' && <TextInput aria-label={`Condition ${i + 1} value`} value={w.value} onChange={(e) => set({ where: visual.where.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} placeholder="value" className="!mt-0 h-8 w-36" />}
            <button type="button" aria-label={`Remove condition ${i + 1}`} onClick={() => set({ where: visual.where.filter((_, k) => k !== i) })} className="text-ink-700 hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>
          </span>
        ))}
        <button type="button" className="h-8 rounded-control-md border border-dashed border-line-control px-2 text-xs text-ink-800 hover:bg-surface-hover" onClick={() => set({ where: [...visual.where, { expr: '', op: '=', value: '' }] })}>+ condition</button>
      </Row>
      <Row label="Group by"><span className="text-xs text-ink-800">{visual.columns.some((c) => c.calc) ? (visual.columns.filter((c) => !c.calc && c.expr && c.expr !== '*').map((c) => c.expr).join(', ') || 'nothing: every row totalled together') + ' · set from the columns without a calculation' : 'No calculation yet, so no grouping.'}</span></Row>
      <Row label="Order by">
        {visual.order.map((o, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-control-md border border-line px-1.5 py-0.5 text-xs">
            <Select aria-label={`Sort ${i + 1}`} value={o.expr} onChange={(e) => set({ order: visual.order.map((x, k) => (k === i ? { ...x, expr: e.target.value } : x)) })} className={selectClass}><option value="">column</option>{visual.columns.filter((c) => c.alias).map((c) => <option key={c.alias} value={c.alias}>{c.alias}</option>)}{columnOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
            <Select aria-label={`Sort ${i + 1} direction`} value={o.dir} onChange={(e) => set({ order: visual.order.map((x, k) => (k === i ? { ...x, dir: e.target.value as 'ASC' | 'DESC' } : x)) })} className={selectClass}><option value="ASC">↑ ascending</option><option value="DESC">↓ descending</option></Select>
            <button type="button" aria-label={`Remove sort ${i + 1}`} onClick={() => set({ order: visual.order.filter((_, k) => k !== i) })} className="text-ink-700 hover:text-ink-900"><X size={12} strokeWidth={1.5} aria-hidden /></button>
          </span>
        ))}
        <button type="button" className="h-8 rounded-control-md border border-dashed border-line-control px-2 text-xs text-ink-800 hover:bg-surface-hover" onClick={() => set({ order: [...visual.order, { expr: '', dir: 'DESC' }] })}>+ sort</button>
      </Row>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2"><span className="pt-1.5 text-xs font-semibold text-ink-800">{label}</span><div className="flex flex-wrap items-center gap-1.5">{children}</div></div>
}

function titleCase(name: string): string {
  return name.replace(/^v_/, '').replace(/[_\s]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
}
