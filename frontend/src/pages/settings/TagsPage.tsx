/**
 * Settings -> Tags: the workspace's personalization tags. A tag from the platform catalogue is listed and read here and changed in the
 * back-office; the workspace's own tags are made, changed and removed here. The form offers every data point the renderer can read.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonPrimary, buttonSecondary, Field, Select, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SegmentedControl } from '@/components/SegmentedControl'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { useFieldRules } from '@/lib/fieldRules'
import { api, ApiError } from '@/lib/api'
import type { Page, PersonalizationTag, TagDataPoints } from '@/lib/types'

const CHANNELS = [{ value: 'EMAIL', label: 'Email' }, { value: 'E_RECEIPT', label: 'E-Receipt' }, { value: 'SMS', label: 'SMS' }, { value: 'MMS', label: 'MMS' }]
const CHANNEL_FILTER = [{ value: 'ALL', label: 'All' }, ...CHANNELS]
const DATA_TYPES = [{ value: 'STRING', label: 'Text' }, { value: 'NUMBER', label: 'Number' }, { value: 'DATE', label: 'Date' }, { value: 'BOOLEAN', label: 'Yes / No' }]
const STATIC = 'STATIC'

interface Draft {
  tag_key: string
  label: string
  source: string
  point: string
  key: string
  static_value: string
  default_value: string
  sample_value: string
  data_type: string
  channels: string[]
  description: string
}

const EMPTY: Draft = { tag_key: '', label: '', source: 'CUSTOMER_MASTER', point: '', key: '', static_value: '', default_value: '', sample_value: '', data_type: 'STRING', channels: CHANNELS.map((c) => c.value), description: '' }

/** a saved tag as the form shows it: a prefix point ("custom_attributes.") is split into the point and the key typed after it */
function draftOf(tag: PersonalizationTag, points: TagDataPoints | undefined): Draft {
  const source = tag.resolution_source ?? 'CUSTOMER_MASTER'
  const path = tag.source_path ?? ''
  const known = points?.sources.find((item) => item.key === source)?.points ?? []
  const prefix = known.find((item) => item.prefix && path.startsWith(item.path))
  return {
    tag_key: tag.tag_key, label: tag.label, source, point: prefix ? prefix.path : path, key: prefix ? path.slice(prefix.path.length) : '',
    static_value: tag.static_value ?? '', default_value: tag.default_value ?? '', sample_value: tag.sample_value ?? '', data_type: tag.data_type,
    channels: tag.applies_to_channels, description: tag.description ?? '',
  }
}

function bodyOf(draft: Draft) {
  const isStatic = draft.source === STATIC
  const path = isStatic ? null : draft.point.endsWith('.') ? draft.point + draft.key.trim() : draft.point
  return {
    tag_key: draft.tag_key.trim(), label: draft.label.trim(), tag_kind: 'CUSTOM', source_system: 'CEP', resolution_source: draft.source, source_path: path,
    static_value: isStatic ? draft.static_value : null, default_value: draft.default_value.trim() || null, sample_value: draft.sample_value.trim() || null,
    data_type: draft.data_type, applies_to_channels: draft.channels, description: draft.description.trim() || null, is_active: true,
  }
}

function TagForm({ tag, points, onClose }: { tag: PersonalizationTag | null; points: TagDataPoints | undefined; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => (tag ? draftOf(tag, points) : EMPTY))
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const source = points?.sources.find((item) => item.key === draft.source)
  const chosen = source?.points.find((item) => item.path === draft.point)
  const rule = useFieldRules('personalization_tag')

  const save = useMutation({
    mutationFn: () => (tag ? api.patch<PersonalizationTag>(`/personalization-tags/${tag.id}/`, bodyOf(draft)) : api.post<PersonalizationTag>('/personalization-tags/', bodyOf(draft))),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['personalization-tags'] }); onClose() },
    onError: (error) => error instanceof ApiError && error.status === 400 && setErrors(error.fieldErrors),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    const key = draft.tag_key.trim()
    if (!/^[a-z][a-z0-9_.]*$/.test(key)) found.tag_key = 'Lower-case letters, digits and underscores, starting with a letter: the word inside {{ }}.'
    if (draft.label.trim().length < 2) found.label = 'Give the tag a name people will recognise in the picker.'
    if (draft.source === STATIC && !draft.static_value.trim()) found.static_value = 'Type the value this tag always carries.'
    if (draft.source !== STATIC && !draft.point) found.source_path = 'Choose the data point this tag reads.'
    if (draft.source !== STATIC && draft.point.endsWith('.') && !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(draft.key.trim())) found.source_path = 'After the prefix comes a key: letters, digits and underscores only.'
    if (draft.channels.length === 0) found.channels = 'Offer the tag in at least one channel.'
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate()
  }
  const other = save.isError && !(save.error instanceof ApiError && save.error.status === 400) ? save.error : null

  return (
    <Modal size="lg" title={tag ? `Edit {{${tag.tag_key}}}` : 'New Tag'} onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="tag-form" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}{tag ? 'Save Tag' : 'Add Tag'}</button>
      </>}>
      <form id="tag-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {other !== null && <ErrorState title="Could not save the tag" error={other} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tag Key" required error={errors.tag_key} help="The word typed inside the braces in a template. Fixed once created: templates keep the token, so a renamed key would leave them pointing at nothing." hint="The word inside {{ }}: lower-case letters, digits and underscores." limit={{ used: draft.tag_key.length, max: rule('tag_key')?.max ?? 100 }}>
            {(ids) => <TextInput {...ids} value={draft.tag_key} maxLength={rule('tag_key')?.max ?? 100} disabled={Boolean(tag)} onChange={(event) => set({ tag_key: event.target.value })} />}
          </Field>
          <Field label="Label" required error={errors.label} hint="What the tag picker shows." limit={{ used: draft.label.length, max: rule('label')?.max ?? 150 }}>
            {(ids) => <TextInput {...ids} value={draft.label} maxLength={rule('label')?.max ?? 150} onChange={(event) => set({ label: event.target.value })} />}
          </Field>
        </div>
        <Field label="Reads From" required hint="Where the value comes from when a message is sent.">
          {(ids) => (
            <Select {...ids} value={draft.source} onChange={(event) => set({ source: event.target.value, point: '', key: '' })}>
              {(points?.sources ?? []).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              <option value={STATIC}>{points?.static.label ?? 'Static value'}</option>
            </Select>
          )}
        </Field>
        {draft.source === STATIC ? (
          <Field label="Static Value" required error={errors.static_value} hint="The same text for everyone.">
            {(ids) => <TextArea {...ids} rows={2} value={draft.static_value} onChange={(event) => set({ static_value: event.target.value })} />}
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data Point" required error={errors.source_path}>
              {(ids) => (
                <Select {...ids} value={draft.point} onChange={(event) => { const next = source?.points.find((item) => item.path === event.target.value); set({ point: event.target.value, key: '', data_type: next && !next.prefix ? next.data_type : draft.data_type }) }}>
                  <option value="">Choose a data point</option>
                  {(source?.points ?? []).map((item) => <option key={item.path} value={item.path}>{item.label}</option>)}
                </Select>
              )}
            </Field>
            {chosen?.prefix && (
              <Field label="Key" required hint={`Completes ${chosen.path}`}>
                {(ids) => <TextInput {...ids} value={draft.key} maxLength={100} onChange={(event) => set({ key: event.target.value })} />}
              </Field>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type">
            {(ids) => <Select {...ids} value={draft.data_type} onChange={(event) => set({ data_type: event.target.value })}>{DATA_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>}
          </Field>
          <Field label="Default Value" hint="Used when the source is empty.">
            {(ids) => <TextInput {...ids} value={draft.default_value} onChange={(event) => set({ default_value: event.target.value })} />}
          </Field>
          <Field label="Sample Value" hint="Shown in previews and test sends.">
            {(ids) => <TextInput {...ids} value={draft.sample_value} onChange={(event) => set({ sample_value: event.target.value })} />}
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">Offered In</legend>
          {errors.channels && <p role="alert" className="mt-1 text-xs font-medium text-danger-text">{errors.channels}</p>}
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {CHANNELS.map((channel) => (
              <li key={channel.value}>
                <label className="flex items-center gap-2 text-sm text-ink-900">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={draft.channels.includes(channel.value)}
                    onChange={(event) => set({ channels: event.target.checked ? [...draft.channels, channel.value] : draft.channels.filter((item) => item !== channel.value) })} />
                  {channel.label}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Field label="Description" hint="Optional. A line for whoever picks it.">
          {(ids) => <TextInput {...ids} value={draft.description} onChange={(event) => set({ description: event.target.value })} />}
        </Field>
      </form>
    </Modal>
  )
}

const SOURCE_WORD: Record<string, string> = {
  CUSTOMER_MASTER: 'Customer', CAMPAIGN_LIST_MEMBER: 'List upload', CAMPAIGN: 'Campaign', CAMPAIGN_RUN: 'Campaign run', SYSTEM: 'System', RECEIPT: 'Receipt',
  STORE: 'Store', TRANSACTION: 'Transaction', STATIC: 'Static', INNER_TEMPLATE: 'Content block',
}

export function TagsPage() {
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState('ALL')
  const [editing, setEditing] = useState<PersonalizationTag | null | 'new'>(null)
  const list = useQuery({ queryKey: ['personalization-tags', 'all'], queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal) })
  const points = useQuery({ queryKey: ['personalization-tags', 'data-points'], queryFn: ({ signal }) => api.get<TagDataPoints>('/personalization-tags/data-points/', undefined, signal), staleTime: 10 * 60_000 })
  const remove = useMutation({ mutationFn: (tag: PersonalizationTag) => api.delete(`/personalization-tags/${tag.id}/`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['personalization-tags'] }) })

  const rows = (list.data?.results ?? []).filter((tag) => channel === 'ALL' || tag.applies_to_channels.length === 0 || tag.applies_to_channels.includes(channel))
    .sort((a, b) => a.tag_key.localeCompare(b.tag_key))
  const columns: Column<PersonalizationTag>[] = [
    { key: 'tag', header: 'Tag', render: (tag) => <div><p className="cep-num font-medium text-ink-900">{`{{${tag.tag_key}}}`}</p><p className="text-xs text-ink-800">{tag.label}</p></div> },
    { key: 'source', header: 'Reads From', render: (tag) => tag.resolution_source === STATIC
      ? <span className="text-sm text-ink-900">Static: <span className="cep-num">{tag.static_value}</span></span>
      : <span className="text-sm text-ink-900">{SOURCE_WORD[tag.resolution_source ?? ''] ?? tag.resolution_source}{tag.source_path ? <span className="cep-num text-ink-800"> · {tag.source_path}</span> : null}</span> },
    { key: 'type', header: 'Type', render: (tag) => DATA_TYPES.find((item) => item.value === tag.data_type)?.label ?? tag.data_type },
    { key: 'channels', header: 'Offered In', render: (tag) => <span className="flex flex-wrap gap-1">{(tag.applies_to_channels.length ? tag.applies_to_channels : ['Every channel']).map((item) => <Tag key={item}>{CHANNELS.find((c) => c.value === item)?.label ?? item}</Tag>)}</span> },
    { key: 'sample', header: 'Sample', phoneOptional: true, render: (tag) => <span className="text-ink-800">{tag.sample_value ?? '—'}</span> },
    { key: 'origin', header: 'Origin', render: (tag) => (tag.platform_tag_id ? <Tag>Platform</Tag> : <Tag tone="success">Workspace</Tag>) },
    { key: 'actions', header: '', align: 'right', render: (tag) => tag.platform_tag_id
      ? <span className="text-xs text-ink-800">Changed in the back-office</span>
      : <span className="flex justify-end gap-2">
          <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => setEditing(tag)}>Edit</button>
          <button type="button" className={buttonClass({ variant: 'danger', size: 'sm' })} disabled={remove.isPending}
            onClick={() => window.confirm(`Remove {{${tag.tag_key}}}? Templates that use it will show the tag unfilled.`) && remove.mutate(tag)}>Remove</button>
        </span> },
  ]

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-800">The words templates fill in for each person: {'{{first_name}}'}, {'{{store_name}}'}. Tags from the platform catalogue are the same in every workspace; this workspace's own are added here.</p>
        <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}>Add Tag</button>
      </div>
      <SegmentedControl label="Offered In" variant="outline" options={CHANNEL_FILTER} value={channel} onChange={setChannel} />
      {remove.isError && <ErrorState title="Could not remove the tag" error={remove.error} />}
      {list.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading tags</p>
        : rows.length === 0 ? <EmptyState title="No tags here yet" hint="Add one, or choose another channel." />
        : <DataTable columns={columns} rows={rows} rowKey={(tag) => tag.id} caption="Personalization tags" />}
      {editing !== null && <TagForm tag={editing === 'new' ? null : editing} points={points.data} onClose={() => setEditing(null)} />}
    </div>
  )
}
