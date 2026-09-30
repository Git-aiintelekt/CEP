/**
 * Settings → Preference Centre: the switch (off = only the unsubscribe link, as before), the topics people can choose, the words on the
 * public page, the tag to put in templates and the last 30 days' figures. Topics and words are kept while the centre is off.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { DataTable, type Column } from '@/components/DataTable'
import { buttonDanger, buttonPrimary, buttonSecondary, Field, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { PreferenceCenterSettings, SubscriptionTopic, SubscriptionTopicInput, SubscriptionTopicList } from '@/lib/types'

const KEY = ['workspace', 'preference-center']
const TOPICS = ['subscription-topics']
const CHANNELS: { code: 'EMAIL' | 'SMS'; label: string }[] = [{ code: 'EMAIL', label: 'Email' }, { code: 'SMS', label: 'Texts' }]
const WORDS = ['brand_name', 'heading', 'email_description', 'sms_description', 'footer', 'privacy_url'] as const
type Words = Pick<PreferenceCenterSettings, (typeof WORDS)[number] | 'allow_opt_in'>

export function PreferenceCenterPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<PreferenceCenterSettings>('/workspace/preference-center/', undefined, signal) })
  const topics = useQuery({ queryKey: TOPICS, queryFn: ({ signal }) => api.get<SubscriptionTopicList>('/subscription-topics/', undefined, signal) })
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.put<PreferenceCenterSettings>('/workspace/preference-center/', { enabled }),
    onSuccess: (next) => { queryClient.setQueryData(KEY, next); void queryClient.invalidateQueries({ queryKey: TOPICS }) },
  })

  if (settings.isError) return <ErrorState title="The preference centre settings could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = settings.data

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Preference Centre</h2>
        <p className="mt-0.5 text-sm text-ink-800">A page where people choose which channels and topics they receive, reached from a link in your email. Off, the unsubscribe link is the only way out, as before.</p>
      </div>

      <section className="max-w-3xl rounded-lg border border-line bg-surface p-5">
        <Switch checked={data.enabled} disabled={toggle.isPending} onChange={(next) => toggle.mutate(next)} label="Offer a Preference Centre" describedBy="pc-help" />
        <p id="pc-help" className="mt-2 text-sm text-ink-800">
          {data.enabled
            ? 'On. {{preference_url}} in a template opens the page, the unsubscribe confirmation offers it, and a marketing campaign is filed under a topic so people who unticked that topic are left out.'
            : 'Off. Only the unsubscribe link exists; {{preference_url}} in a template resolves to it, so no email carries a dead link. Topics and the page\'s words below are kept for when it is switched on.'}
        </p>
        {toggle.isError && <div className="mt-3"><ErrorState title="The setting was not changed" error={toggle.error} /></div>}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <TopicsCard enabled={data.enabled} topics={topics} />
          <WordsCard data={data} onSaved={(next) => queryClient.setQueryData(KEY, next)} />
        </div>
        <div className="space-y-5">
          <section className="rounded-lg border border-line bg-surface p-5">
            <h3 className="font-display text-card-heading font-semibold text-ink-900">In Your Templates</h3>
            <p className="mt-1 text-sm text-ink-800">Put the tag where the link should appear. It is filled per recipient at send time, like the unsubscribe link, which stays required in marketing email.</p>
            <CopyTag tag={data.tag} />
          </section>
          <section className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line-subtle px-4 py-3"><h3 className="font-display text-card-heading font-semibold text-ink-900">Last {data.stats.days} Days</h3></div>
            <dl className="divide-y divide-line-subtle">
              {([['Page opened', data.stats.opened], ['Topics unticked', data.stats.topics_unticked], ['Unsubscribed from the page', data.stats.unsubscribed], ['Opted in again', data.stats.opted_in]] as const).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm"><dt className="text-ink-800">{label}</dt><dd className="cep-num font-semibold text-ink-900">{formatNumber(value)}</dd></div>
              ))}
            </dl>
            <p className="border-t border-line-subtle px-4 py-3 text-xs text-ink-800">Channel changes made on the page are listed under Suppressions with the source Preference Centre.</p>
          </section>
        </div>
      </div>
    </div>
  )
}

function CopyTag({ tag }: { tag: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-subtle px-3 py-2">
      <code className="text-sm text-ink-900">{tag}</code>
      <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => void navigator.clipboard?.writeText(tag).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------- topics
function TopicsCard({ enabled, topics }: { enabled: boolean; topics: ReturnType<typeof useQuery<SubscriptionTopicList>> }) {
  const [editing, setEditing] = useState<SubscriptionTopic | 'new' | null>(null)
  const rows = topics.data?.results ?? []
  const columns: Column<SubscriptionTopic>[] = [
    { key: 'name', header: 'Topic', render: (row) => <span><span className="block font-semibold text-ink-900">{row.name}</span>{row.description && <span className="block text-xs text-ink-800">{row.description}</span>}</span> },
    { key: 'channels', header: 'Channels', render: (row) => row.channels.map((code) => CHANNELS.find((c) => c.code === code)?.label ?? code).join(', '), phoneOptional: true },
    { key: 'opted_out', header: 'Opted Out', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.opted_out)}</span> },
    { key: 'shown', header: 'Shown to Customers', render: (row) => row.is_shown ? <Tag tone="success">Shown</Tag> : <Tag tone="warning">Hidden</Tag>, phoneOptional: true },
    { key: 'edit', header: '', align: 'right', render: (row) => <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => setEditing(row)}>Edit</button> },
  ]
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
        <h3 className="font-display text-card-heading font-semibold text-ink-900">Topics</h3>
        <button type="button" className={buttonSecondary} onClick={() => setEditing('new')}>Add Topic</button>
      </div>
      <p className="px-4 pt-3 text-sm text-ink-800">What a person can choose to receive. Every marketing campaign is filed under one topic; people who unticked it are left out of that campaign's audience. Receipts and service messages have no topic.</p>
      <div className="p-4">
        {topics.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
        : topics.isError ? <ErrorState error={topics.error} onRetry={() => void topics.refetch()} />
        : rows.length === 0 ? <EmptyState title="No Topics Yet" hint={enabled ? 'Until a topic exists the page offers the channels only, and campaigns need no topic.' : 'Add the topics people will choose from; they wait here until the centre is switched on.'} variant="plain" />
        : <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption="Topics" inset="card" />}
      </div>
      <p className="border-t border-line-subtle px-4 py-3 text-xs text-ink-800">Opted Out counts people who unticked the topic on the page. A channel opt-out (unsubscribe, STOP) is under Suppressions and applies to every topic.</p>
      {editing && <TopicForm topic={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function TopicForm({ topic, onClose }: { topic: SubscriptionTopic | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SubscriptionTopicInput>({ name: topic?.name ?? '', description: topic?.description ?? '', channels: topic?.channels ?? ['EMAIL', 'SMS'], is_shown: topic?.is_shown ?? true })
  const done = () => { void queryClient.invalidateQueries({ queryKey: TOPICS }); void queryClient.invalidateQueries({ queryKey: KEY }); onClose() }
  const save = useMutation({
    mutationFn: () => topic ? api.patch<SubscriptionTopic>(`/subscription-topics/${topic.id}/`, form) : api.post<SubscriptionTopic>('/subscription-topics/', form),
    onSuccess: done,
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/subscription-topics/${topic?.id}/`), onSuccess: done })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : remove.isError ? remove.error : null
  const setChannel = (code: 'EMAIL' | 'SMS', on: boolean) => setForm((current) => ({ ...current, channels: on ? [...current.channels.filter((c) => c !== code), code] : current.channels.filter((c) => c !== code) }))

  return (
    <Modal title={topic ? 'Edit Topic' : 'Add Topic'} subtitle="Shown on the preference page in these words." onClose={onClose}
      footer={<div className="flex flex-wrap items-center justify-between gap-2">
        <span>{topic && <button type="button" className={buttonDanger} disabled={remove.isPending}
          onClick={() => window.confirm(topic.campaigns ? `Remove “${topic.name}”? ${formatNumber(topic.campaigns)} campaign${topic.campaigns === 1 ? ' is' : 's are'} filed under it and will need another topic before publishing.` : `Remove “${topic.name}”?`) && remove.mutate()}>Remove</button>}</span>
        <span className="flex gap-2"><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" form="topic-form" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save</button></span>
      </div>}>
      <form id="topic-form" className="space-y-4" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
        <Field label="Name" required error={errors.name} hint="e.g. Rewards and offers">
          {(ids) => <TextInput {...ids} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} />}
        </Field>
        <Field label="Description" error={errors.description} hint="One line under the name, e.g. Member offers, points balance and birthday rewards.">
          {(ids) => <TextInput {...ids} value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={200} />}
        </Field>
        <Field label="Offered On" required error={errors.channels}>
          {() => <span className="flex gap-4">{CHANNELS.map((channel) => <Checkbox key={channel.code} label={channel.label} checked={form.channels.includes(channel.code)} onChange={(event) => setChannel(channel.code, event.target.checked)} />)}</span>}
        </Field>
        <Switch checked={form.is_shown} onChange={(is_shown) => setForm({ ...form, is_shown })} label="Shown to Customers" describedBy="topic-shown-help" />
        <p id="topic-shown-help" className="-mt-2 text-xs text-ink-800">Hidden keeps the topic for campaigns without offering it on the page.</p>
        {other !== null && <ErrorState title="The topic was not saved" error={other} />}
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- the page's words
function WordsCard({ data, onSaved }: { data: PreferenceCenterSettings; onSaved: (next: PreferenceCenterSettings) => void }) {
  const [form, setForm] = useState<Words>({ brand_name: data.brand_name, heading: data.heading, email_description: data.email_description, sms_description: data.sms_description, footer: data.footer, privacy_url: data.privacy_url, allow_opt_in: data.allow_opt_in })
  const set = <K extends keyof Words>(key: K, value: Words[K]) => setForm((current) => ({ ...current, [key]: value }))
  const save = useMutation({ mutationFn: () => api.put<PreferenceCenterSettings>('/workspace/preference-center/', form), onSuccess: onSaved })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : null
  const text = (key: (typeof WORDS)[number], label: string, hint?: string, placeholder?: string) => (
    <Field key={key} label={label} error={errors[key]} hint={hint}>
      {(ids) => <TextInput {...ids} value={form[key]} placeholder={placeholder} onChange={(event) => set(key, event.target.value)} />}
    </Field>
  )
  return (
    <form className="rounded-lg border border-line bg-surface p-5" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
      <h3 className="font-display text-card-heading font-semibold text-ink-900">Page</h3>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {text('brand_name', 'Brand Name', 'Shown at the top of the page and in the confirmation.', data.workspace_name)}
        {text('heading', 'Heading')}
        {text('email_description', 'Email Description')}
        {text('sms_description', 'Text Messages Description')}
      </div>
      <div className="mt-4 grid gap-4">
        <Field label="Footer" error={errors.footer} hint="Your postal address here satisfies the sender-identification rule for marketing email.">
          {(ids) => <TextArea {...ids} rows={2} value={form.footer} onChange={(event) => set('footer', event.target.value)} />}
        </Field>
        {text('privacy_url', 'Privacy Notice Link', 'A full address, starting with https://.')}
      </div>
      <div className="mt-4 border-t border-line-subtle pt-4">
        <Switch checked={form.allow_opt_in} onChange={(allow_opt_in) => set('allow_opt_in', allow_opt_in)} label="Let People Opt In Again" describedBy="optin-help" />
        <p id="optin-help" className="mt-1 text-xs text-ink-800">Someone who unsubscribed can switch a channel back on from this page; the page is the evidence of consent. Off, a switched-off channel is shown locked with the date.</p>
      </div>
      {other !== null && <div className="mt-3"><ErrorState title="The page was not saved" error={other} /></div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save</button>
        <a href={data.preview_url} target="_blank" rel="noreferrer" className={buttonSecondary}>Open Preview</a>
        {save.isSuccess && <span role="status" className="text-sm text-success-text">Saved</span>}
      </div>
    </form>
  )
}
