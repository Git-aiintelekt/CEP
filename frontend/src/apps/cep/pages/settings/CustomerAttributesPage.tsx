/**
 * Settings → Customer Attributes (docs/mockups/customer-attributes.html, option 1): the workspace's own customer fields, where each
 * comes from and how fresh it is, and the Sources they come from (a Report Database table, a file, the API). Tags read an attribute by
 * its key; the send looks at the list entry first, then the customer's attributes, then the customer record, then the tag's default.
 * Changing them needs Manage Customer Attributes (attribute.edit); everyone may look.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Plus, RefreshCw } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { DataTable, type Column } from '@/components/DataTable'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { Tabs } from '@/components/Tabs'
import { useToast } from '@/components/Toast'
import { buttonClass } from '@/components/buttonStyles'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { saveFailure } from '@/lib/saveFeedback'
import type { AttributeDatabase, AttributeRefresh, AttributeRun, AttributeSource, AttributeSourceKind, AttributeType, CustomerAttribute, CustomerAttributes } from '@/lib/types'

const KEY = ['customer-attributes']
const SOURCES_KEY = ['customer-attributes', 'sources']
const TYPES: { value: AttributeType; label: string }[] = [{ value: 'TEXT', label: 'Text' }, { value: 'NUMBER', label: 'Number' }, { value: 'DATE', label: 'Date' }, { value: 'BOOLEAN', label: 'Yes or No' }]
const KINDS: { value: AttributeSourceKind; label: string; text: string }[] = [
  { value: 'DATABASE', label: 'Report Database', text: 'A table or view read by the person’s ID, nightly or when a list is imported.' },
  { value: 'API', label: 'API', text: 'The other system sends values to C360 when they change.' },
  { value: 'FILE', label: 'File', text: 'Columns of the files uploaded into contact lists.' },
]
const REFRESH: Record<AttributeSourceKind, { value: AttributeRefresh; label: string }[]> = {
  DATABASE: [{ value: 'NIGHTLY', label: 'Nightly' }, { value: 'ON_IMPORT', label: 'On Import' }],
  API: [{ value: 'ON_CHANGE', label: 'On Change' }],
  FILE: [{ value: 'ON_IMPORT', label: 'On Import' }],
}
const ATTRIBUTE_FIELDS = ['key', 'label', 'data_type', 'scope', 'source', 'source_field', 'default_value']
const SOURCE_FIELDS = ['name', 'system', 'kind', 'report_connection_id', 'table_name', 'id_column']

const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1').slice(0, 60)
const running = (run: AttributeRun | null | undefined) => Boolean(run && (run.status === 'QUEUED' || run.status === 'RUNNING'))

/** a Report Database's tables, a table's columns, a column's first values */
function useCatalogue(database: string, table: string, field: string) {
  const tables = useQuery({
    queryKey: ['customer-attributes', 'tables', database],
    queryFn: ({ signal }) => api.get<{ tables: { name: string; kind: string }[] }>('/customer-attributes/databases/', { id: database }, signal),
    enabled: Boolean(database), staleTime: 5 * 60_000, retry: false,
  })
  const columns = useQuery({
    queryKey: ['customer-attributes', 'columns', database, table],
    queryFn: ({ signal }) => api.get<{ columns: { name: string; type: string | null; key: boolean }[] }>('/customer-attributes/databases/', { id: database, table }, signal),
    enabled: Boolean(database && table), staleTime: 5 * 60_000, retry: false,
  })
  const sample = useQuery({
    queryKey: ['customer-attributes', 'sample', database, table, field],
    queryFn: ({ signal }) => api.get<{ sample: string[] }>('/customer-attributes/databases/', { id: database, table, field }, signal),
    enabled: Boolean(database && table && field), staleTime: 5 * 60_000, retry: false,
  })
  return { tables, columns, sample }
}

// ---------------------------------------------------------------------------------------------------- Add Attribute
function AttributeForm({ attribute, sources, onClose }: { attribute: CustomerAttribute | null; sources: AttributeSource[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [label, setLabel] = useState(attribute?.label ?? '')
  const [key, setKey] = useState(attribute?.key ?? '')
  const [keyEdited, setKeyEdited] = useState(Boolean(attribute))
  const [dataType, setDataType] = useState<AttributeType>(attribute?.data_type ?? 'TEXT')
  const [scope, setScope] = useState(attribute?.scope ?? 'CUSTOMER')
  const [sourceId, setSourceId] = useState(attribute?.source?.id ?? '')
  const [field, setField] = useState(attribute?.source_field ?? '')
  const [refresh, setRefresh] = useState<AttributeRefresh>(attribute?.refresh ?? 'NIGHTLY')
  const [defaultValue, setDefaultValue] = useState(attribute?.default_value ?? '')
  const [pii, setPii] = useState(attribute?.is_pii ?? false)
  const [makeTag, setMakeTag] = useState(true)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const source = sources.find((item) => item.id === sourceId)
  const database = source?.kind === 'DATABASE' ? source.report_connection_id ?? '' : ''
  const { columns, sample } = useCatalogue(database, source?.table_name ?? '', field)
  const refreshes = source ? REFRESH[source.kind] : []
  const chooseSource = (id: string) => {
    const next = sources.find((item) => item.id === id)
    setSourceId(id)
    setField('')
    if (next && !REFRESH[next.kind].some((item) => item.value === refresh)) setRefresh(REFRESH[next.kind][0].value)
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { label: label.trim(), data_type: dataType, scope, source: sourceId || null, source_field: field.trim() || null, refresh, default_value: defaultValue.trim() || null, is_pii: pii }
      return attribute ? api.patch<CustomerAttribute>(`/customer-attributes/${attribute.id}/`, body)
        : api.post<CustomerAttribute>('/customer-attributes/', { ...body, key: key.trim(), make_tag: makeTag })
    },
    onSuccess: async (saved) => {
      toast.success('Attribute saved', `Tags can read ${saved.label} as {{${saved.key}}}.`)
      await queryClient.invalidateQueries({ queryKey: KEY })
      await queryClient.invalidateQueries({ queryKey: ['personalization-tags'] })
      onClose()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) setErrors(saveFailure(error, 'The attribute was not saved', ATTRIBUTE_FIELDS).fields)
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!label.trim()) found.label = 'Give the attribute a name.'
    if (!attribute && !/^[a-z][a-z0-9_]{0,59}$/.test(key.trim())) found.key = 'Lower-case letters, digits and underscores, starting with a letter.'
    if (source?.kind === 'DATABASE' && !field) found.source_field = 'Choose the column the value is read from.'
    if (source?.kind === 'DATABASE' && scope === 'LIST') found.scope = 'A database value belongs to the customer.'
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate()
  }

  return (
    <Modal size="lg" title={attribute ? `Edit ${attribute.label}` : 'Add Attribute'} onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="attribute-form" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}{attribute ? 'Save Attribute' : 'Add Attribute'}</button>
      </>}>
      <form id="attribute-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {save.isError && <ErrorState title="The attribute was not saved" error={save.error} shownFields={ATTRIBUTE_FIELDS} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label" required error={errors.label} limit={{ used: label.length, max: 120 }}>
            {(ids) => <TextInput {...ids} value={label} maxLength={120} placeholder="e.g. Points Balance" data-autofocus
              onChange={(event) => { setLabel(event.target.value); if (!keyEdited) setKey(keyOf(event.target.value)) }} />}
          </Field>
          <Field label="Key" required error={errors.key} hint={attribute ? 'Fixed once saved: tags and templates use it.' : `What tags use: {{${key || 'key'}}}. Fixed once saved.`}>
            {(ids) => <TextInput {...ids} value={key} maxLength={60} disabled={Boolean(attribute)} className="font-mono" onChange={(event) => { setKey(event.target.value); setKeyEdited(true) }} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" error={errors.data_type}>
            {(ids) => <Select {...ids} value={dataType} onChange={(event) => setDataType(event.target.value as AttributeType)}>{TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>}
          </Field>
          <Field label="Belongs To" error={errors.scope} hint={scope === 'LIST' ? 'A value for one upload, such as an offer code: kept with each list entry.' : 'One value a person, used by every campaign.'}>
            {(ids) => (
              <Select {...ids} value={scope} onChange={(event) => setScope(event.target.value as 'CUSTOMER' | 'LIST')}>
                <option value="CUSTOMER">The Customer</option>
                <option value="LIST">One List Entry</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Comes From" error={errors.source} hint={sources.length === 0 ? 'Add a source first to read values from a database or the API.' : undefined}>
            {(ids) => (
              <Select {...ids} value={sourceId} onChange={(event) => chooseSource(event.target.value)}>
                <option value="">Nowhere Yet</option>
                {sources.map((item) => <option key={item.id} value={item.id}>{item.name}{item.table_name ? ` · ${item.table_name}` : ''}</option>)}
              </Select>
            )}
          </Field>
          {source?.kind === 'DATABASE' ? (
            <Field label="Field" required error={errors.source_field}
              hint={sample.data?.sample.length ? `Sample: ${sample.data.sample.join(' · ')}` : columns.isError ? undefined : `A column of ${source.table_name}.`}>
              {(ids) => (
                <Select {...ids} value={field} onChange={(event) => { setField(event.target.value); setErrors((now) => ({ ...now, source_field: undefined })) }} disabled={columns.isPending}>
                  <option value="">{columns.isPending ? 'Reading the columns' : 'Choose a column'}</option>
                  {(columns.data?.columns ?? []).filter((item) => item.name !== source.id_column).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                  {field && !(columns.data?.columns ?? []).some((item) => item.name === field) && <option value={field}>{field}</option>}
                </Select>
              )}
            </Field>
          ) : source ? (
            <Field label={source.kind === 'API' ? 'Field in the Push' : 'File Column'} error={errors.source_field}
              hint={source.kind === 'API' ? `The name the other system sends. Empty: ${key || 'the key'}.` : 'Optional. The column of an upload that holds it.'}>
              {(ids) => <TextInput {...ids} value={field} maxLength={128} onChange={(event) => setField(event.target.value)} />}
            </Field>
          ) : null}
        </div>
        {columns.isError && <p role="alert" className="text-helper text-danger-text">{saveFailure(columns.error, 'The columns could not be read').title}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {source && (
            <Field label="Refresh" hint={source.kind === 'DATABASE' ? 'Nightly reads every customer; On Import reads the people of each upload that uses it.' : undefined}>
              {(ids) => <Select {...ids} value={refresh} onChange={(event) => setRefresh(event.target.value as AttributeRefresh)} disabled={refreshes.length < 2}>
                {refreshes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>}
            </Field>
          )}
          <Field label="Default Value" error={errors.default_value} hint="What a person without a value gets, when a tag has no default of its own.">
            {(ids) => <TextInput {...ids} value={defaultValue} maxLength={500} onChange={(event) => setDefaultValue(event.target.value)} />}
          </Field>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-subtle p-3">
          <Checkbox label="Personal data: left out of exports unless asked, removed with the person" checked={pii} onChange={(event) => setPii(event.target.checked)} />
          {!attribute && <Checkbox label={`Make a tag {{${key || 'key'}}} that reads it`} checked={makeTag} onChange={(event) => setMakeTag(event.target.checked)} />}
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- Add Source
function SourceForm({ source, onClose }: { source: AttributeSource | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(source?.name ?? '')
  const [system, setSystem] = useState(source?.system ?? '')
  const [kind, setKind] = useState<AttributeSourceKind>(source?.kind ?? 'DATABASE')
  const [database, setDatabase] = useState(source?.report_connection_id ?? '')
  const [table, setTable] = useState(source?.table_name ?? '')
  const [idColumn, setIdColumn] = useState(source?.id_column ?? '')
  const [active, setActive] = useState(source?.is_active ?? true)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const databases = useQuery({
    queryKey: ['customer-attributes', 'databases'],
    queryFn: ({ signal }) => api.get<{ databases: AttributeDatabase[] }>('/customer-attributes/databases/', undefined, signal),
    enabled: kind === 'DATABASE', staleTime: 60_000,
  })
  const { tables, columns } = useCatalogue(kind === 'DATABASE' ? database : '', table, '')

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), system: system.trim(), kind, report_connection_id: kind === 'DATABASE' ? database : null,
        table_name: kind === 'DATABASE' ? table : null, id_column: kind === 'DATABASE' ? idColumn : null, is_active: active }
      return source ? api.patch<AttributeSource>(`/customer-attributes/sources/${source.id}/`, body) : api.post<AttributeSource>('/customer-attributes/sources/', body)
    },
    onSuccess: async (saved) => {
      toast.success('Source saved', saved.kind === 'DATABASE' ? 'Add the attributes it gives, then Sync Now.' : 'Add the attributes it gives.')
      await queryClient.invalidateQueries({ queryKey: KEY })
      onClose()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) setErrors(saveFailure(error, 'The source was not saved', SOURCE_FIELDS).fields)
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!name.trim()) found.name = 'Give the source a name.'
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(system.trim())) found.system = 'Letters, digits and underscores, starting with a letter.'
    if (kind === 'DATABASE' && !database) found.report_connection_id = 'Choose the Report Database.'
    else if (kind === 'DATABASE' && !table) found.table_name = 'Choose the table or view.'
    else if (kind === 'DATABASE' && !idColumn) found.id_column = 'Choose the column that holds the person’s ID.'
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate()
  }

  return (
    <Modal size="lg" title={source ? `Edit ${source.name}` : 'Add Source'} onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="source-form" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}{source ? 'Save Source' : 'Add Source'}</button>
      </>}>
      <form id="source-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {save.isError && <ErrorState title="The source was not saved" error={save.error} shownFields={SOURCE_FIELDS} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            {(ids) => <TextInput {...ids} value={name} maxLength={120} placeholder="e.g. CITI iCRM" data-autofocus onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label="System" required error={errors.system} hint="Its short name. People are matched by their ID in this system; ICRM also uses the IDs C360 already keeps.">
            {(ids) => <TextInput {...ids} value={system} maxLength={40} className="font-mono uppercase" placeholder="ICRM" onChange={(event) => setSystem(event.target.value.toUpperCase())} />}
          </Field>
        </div>
        <fieldset>
          <legend className="text-label font-medium text-ink-800">How Values Arrive</legend>
          <div role="radiogroup" aria-label="How values arrive" className="mt-1.5 grid gap-2 sm:grid-cols-3">
            {KINDS.map((item) => (
              <button key={item.value} type="button" role="radio" aria-checked={kind === item.value} disabled={Boolean(source) && source?.kind !== item.value} onClick={() => setKind(item.value)}
                className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-60 ${kind === item.value ? 'border-link bg-brand-100' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                <span className={`text-sm font-semibold ${kind === item.value ? 'text-brand-800' : 'text-ink-900'}`}>{item.label}</span>
                <span className="text-helper text-ink-800">{item.text}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {kind === 'DATABASE' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Report Database" required error={errors.report_connection_id}
              hint={databases.data && databases.data.databases.length === 0 ? 'None yet: add a MySQL or PostgreSQL one under Settings → Report Databases.' : undefined}>
              {(ids) => (
                <Select {...ids} value={database} onChange={(event) => { setDatabase(event.target.value); setTable(''); setIdColumn('') }}>
                  <option value="">Choose a database</option>
                  {(databases.data?.databases ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Table" required error={errors.table_name}>
              {(ids) => (
                <Select {...ids} value={table} disabled={!database || tables.isPending} onChange={(event) => { setTable(event.target.value); setIdColumn('') }}>
                  <option value="">{database && tables.isPending ? 'Reading the tables' : 'Choose a table'}</option>
                  {(tables.data?.tables ?? []).map((item) => <option key={item.name} value={item.name}>{item.name}{item.kind === 'view' ? ' (view)' : ''}</option>)}
                  {table && !(tables.data?.tables ?? []).some((item) => item.name === table) && <option value={table}>{table}</option>}
                </Select>
              )}
            </Field>
            <Field label="ID Column" required error={errors.id_column} hint="Holds the person’s ID in the system.">
              {(ids) => (
                <Select {...ids} value={idColumn} disabled={!table || columns.isPending} onChange={(event) => setIdColumn(event.target.value)}>
                  <option value="">{table && columns.isPending ? 'Reading the columns' : 'Choose a column'}</option>
                  {(columns.data?.columns ?? []).map((item) => <option key={item.name} value={item.name}>{item.name}{item.key ? ' (key)' : ''}</option>)}
                  {idColumn && !(columns.data?.columns ?? []).some((item) => item.name === idColumn) && <option value={idColumn}>{idColumn}</option>}
                </Select>
              )}
            </Field>
          </div>
        )}
        {(tables.isError || columns.isError) && <p role="alert" className="text-helper text-danger-text">{saveFailure(tables.error ?? columns.error, 'The database could not be read').title}</p>}
        {kind === 'API' && (
          <Notice tone="info" layout="banner">
            <p>The other system sends <span className="font-mono">POST /api/v1/customer-attributes/values/</span> with an API key that has the scope <span className="font-mono">attributes:write</span> (Settings → API Keys): {'{"system": "'}{system || 'SHOPIFY'}{'", "people": [{"id": "…", "values": {"field": "value"}}]}'}. Up to 1,000 people a call.</p>
          </Notice>
        )}
        {source && <Checkbox label="Active: read and accepted" checked={active} onChange={(event) => setActive(event.target.checked)} />}
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- the page
function RunLine({ run, at }: { run: AttributeRun | null; at: string | null }) {
  if (!run) return <span className="text-ink-800">Never read</span>
  if (running(run)) return <span className="flex items-center gap-2 text-ink-900"><Spinner size="sm" />{run.status === 'QUEUED' ? 'Waiting to be read' : `Reading · ${formatNumber(run.people_read)} so far`}</span>
  if (run.status === 'FAILED') return <span className="flex flex-col gap-0.5"><span><StatusBadge status="FAILED" label="Failed" /></span><span className="text-helper text-danger-text">{run.error}</span></span>
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-ink-900">{run.trigger_label} · {formatDateTime(run.finished_at ?? at)}</span>
      <span className="cep-num text-helper text-ink-800">{formatNumber(run.people_read)} read, {formatNumber(run.people_matched)} matched{run.params.capped_at ? ` · stopped at ${formatNumber(run.params.capped_at)}` : ''}</span>
    </span>
  )
}

function MatchesBy({ source }: { source: AttributeSource }) {
  if (source.kind === 'DATABASE') return <span className="text-ink-900"><span className="font-mono text-helper">{source.table_name}.{source.id_column}</span> → {source.system} ID</span>
  if (source.kind === 'API') return <span className="text-ink-900">{source.system}’s ID, sent with each value</span>
  return <span className="text-ink-900">The list’s own matching</span>
}

export function CustomerAttributesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'attributes' | 'sources'>('attributes')
  const [editing, setEditing] = useState<CustomerAttribute | 'new' | null>(null)
  const [editingSource, setEditingSource] = useState<AttributeSource | 'new' | null>(null)
  const [removing, setRemoving] = useState<{ kind: 'attribute'; item: CustomerAttribute } | { kind: 'source'; item: AttributeSource } | null>(null)
  const list = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<CustomerAttributes>('/customer-attributes/', undefined, signal) })
  const sources = useQuery({
    queryKey: SOURCES_KEY,
    queryFn: ({ signal }) => api.get<{ available: boolean; sources: AttributeSource[] }>('/customer-attributes/sources/', undefined, signal),
    refetchInterval: (query) => (Array.isArray(query.state.data?.sources) && query.state.data.sources.some((item) => running(item.last_run)) ? 3000 : false),
  })
  const sync = useMutation({
    mutationFn: (source: AttributeSource) => api.post<AttributeRun>(`/customer-attributes/sources/${source.id}/sync/`),
    onSuccess: () => { toast.success('Reading the source', 'It runs in the background; the row shows the progress.'); void queryClient.invalidateQueries({ queryKey: SOURCES_KEY }) },
  })
  const remove = useMutation({
    mutationFn: (target: NonNullable<typeof removing>) => api.delete(target.kind === 'attribute' ? `/customer-attributes/${target.item.id}/` : `/customer-attributes/sources/${target.item.id}/`),
    onSuccess: () => { toast.success('Removed'); setRemoving(null); void queryClient.invalidateQueries({ queryKey: KEY }) },
  })
  const allSources = useMemo(() => (Array.isArray(sources.data?.sources) ? sources.data.sources : []), [sources.data])
  const canEdit = Boolean(list.data?.can_edit)

  if (list.isError) return <ErrorState title="Customer attributes could not be loaded" error={list.error} onRetry={() => void list.refetch()} />
  if (list.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = list.data
  if (!data.available) {
    return <EmptyState title="Customer Attributes are not set up on this server yet" hint="The platform team applies database patch 0100. Until then tags read the customer record and the list, as before." />
  }
  const attributes = data.attributes
  const empty = attributes.length === 0 && allSources.length === 0

  const attributeColumns: Column<CustomerAttribute>[] = [
    { key: 'attribute', header: 'Attribute', render: (item) => (
      <div>
        <p className="flex items-center gap-2 font-semibold text-ink-900">{item.label}{item.is_pii && <Tag>Personal</Tag>}{!item.is_active && <Tag>Off</Tag>}</p>
        <p className="text-helper text-ink-800"><span className="font-mono">{item.key}</span> · {item.data_type_label}{item.scope === 'LIST' ? ' · List entry' : ''}</p>
      </div>
    ) },
    { key: 'from', header: 'Comes From', render: (item) => item.scope === 'LIST' && !item.source ? <span className="text-ink-800">A file column, kept with each list entry</span> : item.source ? (
      <div title={item.source.table_name ? `${item.source.table_name} · ${item.source_field ?? ''}` : undefined}>
        <p className="text-ink-900">{item.source.name}</p>
        {item.source_field && <p className="font-mono text-helper text-ink-800">{item.source_field}</p>}
      </div>
    ) : <span className="text-ink-800">Nowhere yet</span> },
    { key: 'refresh', header: 'Refresh', className: 'whitespace-nowrap', render: (item) => <span className="text-ink-900">{item.source ? item.refresh_label : '—'}</span> },
    { key: 'people', header: 'People With a Value', align: 'right', className: 'whitespace-nowrap', render: (item) => <span className="cep-num text-ink-900">{item.people_with_value === null ? 'By list' : formatNumber(item.people_with_value)}</span> },
    { key: 'used', header: 'Used By', render: (item) => item.tags.length ? <span className="flex flex-wrap gap-1">{item.tags.map((tag) => <Tag key={tag} tone="brand">{`{{${tag}}}`}</Tag>)}</span> : <span className="text-ink-800">No tag yet</span> },
    ...(canEdit ? [{ key: 'actions', header: '', align: 'right' as const, render: (item: CustomerAttribute) => (
      <span className="flex justify-end gap-2">
        <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => setEditing(item)}>Edit</button>
        <button type="button" className={buttonClass({ variant: 'danger', size: 'sm' })} onClick={() => setRemoving({ kind: 'attribute', item })}>Remove</button>
      </span>
    ) }] : []),
  ]
  const sourceColumns: Column<AttributeSource>[] = [
    { key: 'source', header: 'Source', render: (item) => (
      <div>
        <p className="flex items-center gap-2 font-semibold text-ink-900">{item.name}{!item.is_active && <Tag>Off</Tag>}</p>
        <p className="text-helper text-ink-800">{item.kind_label}{item.kind === 'DATABASE' ? ` · ${item.database_name ?? 'database removed'}` : ''} · {item.attribute_count === 1 ? '1 attribute' : `${item.attribute_count} attributes`}</p>
      </div>
    ) },
    { key: 'match', header: 'Matches People By', render: (item) => <MatchesBy source={item} /> },
    { key: 'last', header: 'Last Sync', render: (item) => <RunLine run={item.last_run} at={item.last_sync_at} /> },
    ...(canEdit ? [{ key: 'actions', header: '', align: 'right' as const, render: (item: AttributeSource) => (
      <span className="flex justify-end gap-2">
        {item.kind === 'DATABASE' && (
          <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} disabled={running(item.last_run) || sync.isPending || item.attribute_count === 0 || !item.is_active}
            title={item.attribute_count === 0 ? 'Add an attribute that reads it first' : undefined} onClick={() => sync.mutate(item)}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />Sync Now
          </button>
        )}
        <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => setEditingSource(item)}>Edit</button>
        <button type="button" className={buttonClass({ variant: 'danger', size: 'sm' })} onClick={() => setRemoving({ kind: 'source', item })}>Remove</button>
      </span>
    ) }] : []),
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">Customer Attributes</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-800">Your own customer fields, where each comes from, and how fresh it is. Tags read them by key: the send looks at the list entry first, then these, then the customer record.</p>
        </div>
        {canEdit && !empty && (
          <span className="flex gap-2">
            <button type="button" className={buttonSecondary} onClick={() => { setTab('sources'); setEditingSource('new') }}><Database size={16} strokeWidth={1.5} aria-hidden />Add Source</button>
            <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}><Plus size={16} strokeWidth={1.5} aria-hidden />Add Attribute</button>
          </span>
        )}
      </div>

      {empty ? (
        <EmptyState title="No customer attributes yet" hint="Add a source (a Report Database, a file or an API) and the fields you want from it. Until then tags read the customer record and the list."
          action={canEdit ? (
            <span className="flex flex-wrap justify-center gap-2">
              <button type="button" className={buttonSecondary} onClick={() => { setTab('sources'); setEditingSource('new') }}>Add a Source</button>
              <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}>Add Attribute</button>
            </span>
          ) : undefined} />
      ) : (
        <>
          <div className="border-b border-line">
            <Tabs label="Customer attributes" idPrefix="attributes" value={tab} onChange={setTab}
              tabs={[{ id: 'attributes', label: 'Attributes', count: attributes.length }, { id: 'sources', label: 'Sources', count: allSources.length }]} />
          </div>
          {sync.isError && <ErrorState title="The source was not read" error={sync.error} />}
          {remove.isError && <ErrorState title="That was not removed" error={remove.error} />}
          {tab === 'attributes' ? (
            attributes.length === 0 ? <EmptyState title="No attributes yet" hint="Add the fields you want from your sources." />
              : <div role="tabpanel" id="attributes-panel-attributes" aria-labelledby="attributes-tab-attributes"><DataTable columns={attributeColumns} rows={attributes} rowKey={(item) => item.id} caption="Customer attributes" /></div>
          ) : sources.isError ? <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
            : allSources.length === 0 ? <EmptyState title="No sources yet" hint="A source is where values come from: a Report Database table, a file, or the API." />
            : (
              <div role="tabpanel" id="attributes-panel-sources" aria-labelledby="attributes-tab-sources" className="flex flex-col gap-3">
                <DataTable columns={sourceColumns} rows={allSources} rowKey={(item) => item.id} caption="Attribute sources" />
                <p className="text-helper text-ink-800">A new system (Salesforce, a POS, a loyalty app) is a new source: a database it can be read from, a file it exports, or the API it can push to. No table or code changes per system.</p>
              </div>
            )}
        </>
      )}

      {editing !== null && <AttributeForm attribute={editing === 'new' ? null : editing} sources={allSources} onClose={() => setEditing(null)} />}
      {editingSource !== null && <SourceForm source={editingSource === 'new' ? null : editingSource} onClose={() => setEditingSource(null)} />}
      {removing && (
        <Modal title={removing.kind === 'attribute' ? `Remove ${removing.item.label}?` : `Remove ${removing.item.name}?`} onClose={() => setRemoving(null)}
          footer={<>
            <button type="button" className={buttonSecondary} onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" className={buttonClass({ variant: 'danger' })} disabled={remove.isPending} onClick={() => remove.mutate(removing)}>{remove.isPending && <Spinner size="sm" />}Remove</button>
          </>}>
          <p className="text-sm text-ink-800">
            {removing.kind === 'attribute'
              ? 'Tags can no longer read it. The values already kept stay with each customer until a source writes them again.'
              : 'The values it brought go with it, and its attributes keep reading nothing until they get another source. This cannot be undone.'}
          </p>
        </Modal>
      )}
    </div>
  )
}
