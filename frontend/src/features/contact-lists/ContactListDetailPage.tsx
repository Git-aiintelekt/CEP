/** One contact list: who is in it, when and how each was added, where it is used, and the ways to fix it. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Field, Select, TextArea, TextInput, buttonDanger, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, FullPageSpinner, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDate, formatNumber, humanize } from '@/lib/format'
import type { ContactList, ListGovernance, ListMembersPage, ListUsage, ManualAddResult } from '@/lib/types'

import { CloneDialog, TypeBadge } from './ContactListsPage'
import { problemText } from './problem'
import { GovernanceLines } from './UploadReport'

const PAGE_SIZE = 50
const MEMBER_SOURCE: Record<string, string> = { UPLOAD: 'Upload', MANUAL: 'Manual', SEGMENT: 'Audience', CLONE: 'Cloned', RULE: 'Rule' }

function EditDetails({ list, onClose, onSaved }: { list: ContactList; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(list.name)
  const [description, setDescription] = useState(list.description ?? '')
  const [environment, setEnvironment] = useState(list.list_environment)
  const save = useMutation({
    mutationFn: () => api.patch<ContactList>(`/contact-lists/${list.id}/`, { name, description, list_environment: environment }),
    onSuccess: onSaved,
  })
  const errors = save.isError ? problemText(save.error) : undefined
  return (
    <Modal
      title="Edit details"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={name.trim() === '' || save.isPending} onClick={() => save.mutate()}>Save</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="List name" required error={errors}>
          {(ids) => (
            <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} maxLength={200} autoFocus />
          )}
        </Field>
        <Field label="Description">
          {(ids) => (
            <TextArea {...ids} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          )}
        </Field>
        <Field label="List type" hint="Production lists can go out in production sends. A Test list is for test sends only: publishing a campaign to production with a Test list attached is refused.">
          {(ids) => (
            <Select {...ids} value={environment} onChange={(event) => setEnvironment(event.target.value)}>
              <option value="PRODUCTION">Production</option>
              <option value="TEST">Test</option>
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  )
}

function AddContacts({ list, onClose, onAdded }: { list: ContactList; onClose: () => void; onAdded: (result: ManualAddResult) => void }) {
  const [text, setText] = useState('')
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const add = useMutation({
    mutationFn: () =>
      api.post<ManualAddResult>(`/contact-lists/${list.id}/members/`, {
        contacts: lines.map((line) => {
          const [email, first_name = '', last_name = ''] = line.split(/[,;\t]/).map((cell) => cell.trim())
          return { email, first_name, last_name }
        }),
      }),
    onSuccess: onAdded,
  })
  return (
    <Modal
      title="Add contacts"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={lines.length === 0 || add.isPending} onClick={() => add.mutate()}>
            Add {lines.length > 0 ? formatNumber(lines.length) : ''} contact{lines.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <Field label="Email addresses" hint="One per line. Optionally add first and last name after commas: ana@example.com, Ana, Lopez. Up to 500 at a time; for more, make a list from a file."
        error={add.isError ? problemText(add.error) : undefined}>
          {(ids) => (
            <TextArea {...ids} value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder={'ana@example.com, Ana, Lopez\nben@example.com'} autoFocus />
          )}
      </Field>
      <p className="mt-3 text-xs text-ink-500">Someone CEP already knows is linked to their existing record. Anyone new is added to CEP without a consent answer, so marketing sends leave them out until they opt in.</p>
    </Modal>
  )
}

export function ContactListDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const editable = can('list.edit')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<'edit' | 'add' | 'clone' | 'remove' | null>(null)
  const [notice, setNotice] = useState('')

  const list = useQuery({ queryKey: ['contact-lists', id], queryFn: ({ signal }) => api.get<ContactList>(`/contact-lists/${id}/`, undefined, signal) })
  const usage = useQuery({ queryKey: ['contact-lists', id, 'usage'], queryFn: ({ signal }) => api.get<ListUsage>(`/contact-lists/${id}/usage/`, undefined, signal) })
  const governance = useQuery({ queryKey: ['contact-lists', id, 'governance'], queryFn: ({ signal }) => api.get<ListGovernance>(`/contact-lists/${id}/governance/`, undefined, signal) })
  const members = useQuery({
    queryKey: ['contact-lists', id, 'members', search.trim(), page],
    queryFn: ({ signal }) => api.get<ListMembersPage>(`/contact-lists/${id}/members/`, { search: search.trim() || undefined, page, page_size: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  })
  const refreshAll = () => {
    setSelected([])
    void queryClient.invalidateQueries({ queryKey: ['contact-lists'] })
  }

  const remove = useMutation({
    mutationFn: () => api.post<{ removed: number }>(`/contact-lists/${id}/members/remove/`, { ids: selected }),
    onSuccess: (result) => {
      setDialog(null)
      setNotice(`${formatNumber(result.removed)} contact${result.removed === 1 ? '' : 's'} removed from this list. They are still in CEP.`)
      refreshAll()
    },
  })
  const sync = useMutation({
    mutationFn: () => api.post<{ added: number; removed: number }>(`/contact-lists/${id}/refresh/`),
    onSuccess: (result) => {
      setNotice(`In line with its audience: ${formatNumber(result.added)} added, ${formatNumber(result.removed)} removed.`)
      refreshAll()
    },
    onError: (error) => setNotice(problemText(error)),
  })
  const exportSelected = async () => {
    try {
      const blob = await api.download(`/contact-lists/${id}/members/export/`, selected.length > 0 ? { ids: selected.join(',') } : undefined)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${list.data?.name ?? 'contact-list'}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setNotice(problemText(error))
    }
  }

  if (list.isPending) return <FullPageSpinner label="Loading the list" />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} title="This list could not be opened" />

  const data = list.data
  const rows = members.data?.results ?? []
  const total = members.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allOnPage = rows.length > 0 && rows.every((row) => selected.includes(row.id))
  const live = usage.data?.live_campaigns ?? 0
  const attached = usage.data?.attached_campaigns ?? 0
  const archived = data.status === 'ARCHIVED'
  const followsAudience = data.list_kind === 'SEGMENT'

  return (
    <section>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-500">
        <Link to="/contact-lists" className="font-medium text-brand-800 hover:underline">Contact Lists</Link> <span aria-hidden>/</span> {data.name}
      </nav>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-semibold text-ink-900">{data.name}</h1>
          {data.description && <p className="mt-1 max-w-2xl text-sm text-ink-500">{data.description}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <TypeBadge environment={data.list_environment} />
            <Tag>{data.source_label ?? data.source_type}</Tag>
            {archived && <StatusBadge status="ARCHIVED" />}
            {data.source_reference && <span className="text-xs text-ink-500">from {data.source_reference}</span>}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {followsAudience && (
              <button type="button" className={buttonSecondary} onClick={() => sync.mutate()} disabled={sync.isPending || archived}>
                <RefreshCw size={16} strokeWidth={1.5} aria-hidden /> Refresh now
              </button>
            )}
            <button type="button" className={buttonSecondary} onClick={() => setDialog('clone')}>Clone</button>
            <button type="button" className={buttonSecondary} onClick={() => setDialog('edit')}>Edit details</button>
            <button type="button" className={buttonPrimary} onClick={() => setDialog('add')} disabled={archived}>
              <Plus size={16} strokeWidth={2} aria-hidden /> Add contacts
            </button>
          </div>
        )}
      </div>

      {/* what is safe to edit */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-callout-bg px-3 py-2 text-sm text-callout-text" role="note">
        <span className="mt-0.5 text-callout-icon"><Info size={16} strokeWidth={1.5} aria-hidden /></span>
        <p>
          {live > 0
            ? `This list is attached to ${live} live campaign${live === 1 ? '' : 's'}. You can still change it: a Campaign List that was already built from it stays as it is, only sends built after your change pick it up.`
            : attached > 0
              ? `This list is attached to ${attached} campaign${attached === 1 ? '' : 's'}, none of them live. Changes you make here are picked up when a campaign builds its Campaign List; one that was already built does not change.`
              : "This list isn't attached to a live campaign yet. If you attach it later, changes you make here won't change a Campaign List that was already built from it."}
          {followsAudience && ' It follows its audience every hour: people who no longer qualify leave, contacts added by hand stay.'}
        </p>
      </div>

      <dl className="mb-4 grid gap-3 sm:grid-cols-3">
        {([['Contacts', data.member_count], ['Added this week', usage.data?.added_this_week], ['Attached campaigns', usage.data?.attached_campaigns]] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
            <dt className="text-xs font-semibold text-ink-700">{label}</dt>
            <dd className="cep-num mt-1 font-display text-2xl font-semibold text-ink-900">{value === undefined ? '–' : formatNumber(value)}</dd>
          </div>
        ))}
      </dl>

      {attached > 0 && (
        <section aria-label="Attached campaigns" className="mb-4 rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-2 text-sm font-semibold text-ink-900">Attached campaigns</h2>
          <ul className="divide-y divide-line-subtle">
            {usage.data?.campaigns.map((campaign) => (
              <li key={campaign.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <Link to={`/campaigns/${campaign.id}`} className="min-w-0 grow truncate font-medium text-brand-800 hover:underline">{campaign.name}</Link>
                <Tag>{campaign.channel}</Tag>
                <StatusBadge status={campaign.status} />
                {campaign.live && <span className="text-xs font-semibold text-success-text">Live</span>}
                {campaign.frozen_lists > 0 && <span className="text-xs text-ink-500">{campaign.frozen_lists} Campaign List{campaign.frozen_lists === 1 ? '' : 's'} already built</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {governance.data && governance.data.total > 0 && (
        <section aria-label="Governance check" className="mb-4 rounded-lg border border-line bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-900">Governance check · marketing email, as of today</h2>
            <p className="cep-num text-sm text-ink-700">{formatNumber(governance.data.sendable)} of {formatNumber(governance.data.total)} can receive it</p>
          </div>
          <div className="max-w-xl"><GovernanceLines statuses={governance.data.statuses} total={governance.data.total} sendable={governance.data.sendable} /></div>
          <p className="mt-2 text-xs text-ink-500">Unsubscribes, bounces, complaints, blocked and invalid addresses, suppression and consent, with the rules a send uses. Transactional campaigns ignore consent, not blocked or invalid addresses.</p>
        </section>
      )}

      {notice && <p role="status" className="mb-4 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search contacts" aria-label="Search contacts"
          className="h-10 w-full rounded-sm border border-line bg-surface px-3 text-sm sm:w-64" />
        <span className="text-sm text-ink-500" aria-live="polite">{selected.length === 0 ? 'No contacts selected' : `${formatNumber(selected.length)} selected`}</span>
        {members.isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Contacts in {data.name}</caption>
            <thead className="border-b border-line bg-surface-subtle text-xs font-semibold text-ink-700">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label="Select everyone on this page" checked={allOnPage} disabled={rows.length === 0}
                    onChange={() => setSelected(allOnPage ? selected.filter((value) => !rows.some((row) => row.id === value)) : [...new Set([...selected, ...rows.map((row) => row.id)])])}
                    className="h-4 w-4 accent-brand-600" />
                </th>
                <th scope="col" className="px-3 py-2">Email</th>
                <th scope="col" className="px-3 py-2">First name</th>
                <th scope="col" className="px-3 py-2">Last name</th>
                <th scope="col" className="px-3 py-2 text-right">Added on</th>
                <th scope="col" className="px-3 py-2">Source</th>
                <th scope="col" className="px-3 py-2">Marketing email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((row) => (
                <tr key={row.id} className={selected.includes(row.id) ? 'bg-callout-bg' : undefined}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${row.email ?? row.party_id}`} checked={selected.includes(row.id)}
                      onChange={() => setSelected(selected.includes(row.id) ? selected.filter((value) => value !== row.id) : [...selected, row.id])} className="h-4 w-4 accent-brand-600" />
                  </td>
                  <td className="px-3 py-2 font-medium text-ink-900">{row.email ?? <span className="font-normal text-ink-500">no email on file · {row.party_id}</span>}</td>
                  <td className="px-3 py-2 text-ink-700">{row.first_name ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-700">{row.last_name ?? '—'}</td>
                  <td className="cep-num px-3 py-2 text-right text-ink-700">{formatDate(row.added_at)}</td>
                  <td className="px-3 py-2"><Tag>{MEMBER_SOURCE[row.source] ?? humanize(row.source)}</Tag></td>
                  <td className="px-3 py-2">
                    {row.email_status_label && (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${row.sendable ? 'text-success-text' : 'text-warning-text'}`}>
                        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${row.sendable ? 'bg-success' : 'bg-warning'}`} />
                        {row.sendable ? 'Can receive' : row.email_status_label}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-500">{members.isPending ? 'Loading contacts' : search.trim() ? 'No contact matches this search.' : 'Nobody is in this list yet.'}</td></tr>
              )}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 text-sm text-ink-500">
            <span className="cep-num">Showing {formatNumber(rows.length)} of {formatNumber(total)}</span>
            <span className="flex flex-wrap items-center gap-2">
              {pages > 1 && (
                <>
                  <button type="button" className={buttonSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <span className="cep-num">Page {page} of {formatNumber(pages)}</span>
                  <button type="button" className={buttonSecondary} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
                </>
              )}
              <button type="button" className={buttonSecondary} onClick={() => void exportSelected()} disabled={total === 0}>{selected.length > 0 ? 'Export selected' : 'Export all'}</button>
              {editable && <button type="button" className={buttonDanger} disabled={selected.length === 0 || archived} onClick={() => { remove.reset(); setDialog('remove') }}>Remove from list</button>}
            </span>
          </div>
        </div>
      )}

      {dialog === 'edit' && <EditDetails list={data} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice('Details saved.'); refreshAll() }} />}
      {dialog === 'add' && (
        <AddContacts list={data} onClose={() => setDialog(null)} onAdded={(result) => {
          setDialog(null)
          const parts = [`${formatNumber(result.added)} added`]
          if (result.new_people) parts.push(`${formatNumber(result.new_people)} new to CEP`)
          if (result.already_in_list) parts.push(`${formatNumber(result.already_in_list)} already in the list`)
          if (result.invalid.length) parts.push(`not valid and skipped: ${result.invalid.slice(0, 5).join(', ')}${result.invalid.length > 5 ? '…' : ''}`)
          setNotice(`${parts.join(' · ')}.`)
          setPage(1)
          refreshAll()
        }} />
      )}
      {dialog === 'clone' && <CloneDialog source={data} onClose={() => setDialog(null)} onCloned={(copy) => { setDialog(null); refreshAll(); navigate(`/contact-lists/${copy.id}`) }} />}
      {dialog === 'remove' && (
        <Modal
          title="Remove from this list?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setDialog(null)}>Keep them</button>
              <button type="button" className={buttonDanger} disabled={remove.isPending} onClick={() => remove.mutate()}>Remove {formatNumber(selected.length)}</button>
            </>
          }
        >
          <p className="text-sm text-ink-700">
            {formatNumber(selected.length)} contact{selected.length === 1 ? '' : 's'} leave{selected.length === 1 ? 's' : ''} “{data.name}”. They stay in CEP and in every other list.
            {followsAudience && ' Someone who still qualifies for the audience comes back at the next refresh.'}
          </p>
          {remove.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-plain">{problemText(remove.error)}</p>}
        </Modal>
      )}
    </section>
  )
}
