/** One contact list: who is in it, when and how each was added, where it is used, and the ways to fix it. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ClearFiltersLink, SelectFilter } from '@/components/FilterChip'
import { buttonDanger, buttonPrimary, buttonSecondary, Field, Select, TextArea, TextInput } from '@/components/Form'
import { SearchField } from '@/components/SearchField'
import { Modal } from '@/components/Modal'
import { ErrorState, FullPageSpinner, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatDateTime, formatNumber, titleize } from '@/lib/format'
import { saveFailure } from '@/lib/saveFeedback'
import type { ComplianceRecord, ContactList, ListGovernance, ListMembersPage, ListUsage, ManualAddResult } from '@/lib/types'

import { CloneDialog, TypeBadge } from './ContactListsPage'
import { problemText } from './problem'
import { GovernanceLines } from './UploadReport'

const PAGE_SIZE = 50
const MEMBER_SOURCE: Record<string, string> = { UPLOAD: 'Upload', MANUAL: 'Manual', SEGMENT: 'Audience', CLONE: 'Cloned', RULE: 'Rule' }
const DETAILS_FIELDS = ['name', 'description']
const DETAILS_FAILED = 'The details were not saved'

function EditDetails({ list, onClose, onSaved }: { list: ContactList; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(list.name)
  const [description, setDescription] = useState(list.description ?? '')
  const [environment, setEnvironment] = useState(list.list_environment)
  const [channel, setChannel] = useState(list.channel || 'EMAIL')
  const save = useMutation({
    mutationFn: () => api.patch<ContactList>(`/contact-lists/${list.id}/`, { name, description, list_environment: environment, channel }),
    onSuccess: onSaved,
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? saveFailure(save.error, DETAILS_FAILED, DETAILS_FIELDS).fields : {}
  return (
    <Modal
      title="Edit Details"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={name.trim() === '' || save.isPending} onClick={() => save.mutate()}>Save</button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && <ErrorState title={DETAILS_FAILED} error={save.error} shownFields={DETAILS_FIELDS} />}
        <Field label="List Name" required error={errors.name}>
          {(ids) => (
            <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} maxLength={200} autoFocus />
          )}
        </Field>
        <Field label="Description" error={errors.description}>
          {(ids) => (
            <TextArea {...ids} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          )}
        </Field>
        <Field label="List Type" hint="Production lists can go out in production sends. A Test list is for test sends only: publishing a campaign to production with a Test list attached is refused.">
          {(ids) => (
            <Select {...ids} value={environment} onChange={(event) => setEnvironment(event.target.value)}>
              <option value="PRODUCTION">Production</option>
              <option value="TEST">Test</option>
            </Select>
          )}
        </Field>
        <Field label="What the List Is For" hint="Decides which column an upload must have: the address for email, the mobile number for texts, both for both.">
          {(ids) => (
            <Select {...ids} value={channel} onChange={(event) => setChannel(event.target.value)}>
              <option value="EMAIL">Email</option>
              <option value="SMS">Texts</option>
              <option value="BOTH">Email and Texts</option>
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
      title="Add Contacts"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={lines.length === 0 || add.isPending} onClick={() => add.mutate()}>
            Add {lines.length > 0 ? formatNumber(lines.length) : ''} Contact{lines.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <Field label="Email Addresses" hint="One per line. Optionally add first and last name after commas: ana@example.com, Ana, Lopez. Up to 500 at a time; for more, make a list from a file."
        error={add.isError ? problemText(add.error) : undefined}>
          {(ids) => (
            <TextArea {...ids} value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder={'ana@example.com, Ana, Lopez\nben@example.com'} autoFocus />
          )}
      </Field>
      <p className="mt-3 text-xs text-ink-800">Someone C360 already knows is linked to their existing record. Anyone new is added to C360 without a consent answer, so marketing sends leave them out until they opt in.</p>
    </Modal>
  )
}

/** the marketing-email verdicts the people can be filtered by, as the API names them */
const CONSENT_FILTERS = [
  { value: '', label: 'Any Consent State' }, { value: 'SENDABLE', label: 'Can Receive' }, { value: 'NOT_SENDABLE', label: 'Cannot Receive' }, { value: 'UNSUBSCRIBED', label: 'Unsubscribed' },
  { value: 'NO_CONSENT', label: 'No Consent on Record' }, { value: 'HARD_BOUNCE', label: 'Bounced' }, { value: 'COMPLAINT', label: 'Complained' }, { value: 'BLOCKED', label: 'Blocked' },
  { value: 'INVALID_ADDRESS', label: 'Invalid Address' }, { value: 'SUPPRESSED', label: 'Suppressed' },
]

const APPROVAL_TAG: Record<string, { label: string; tone: 'warning' | 'success' | 'error' }> = {
  AWAITING: { label: 'Awaiting Approval', tone: 'warning' }, APPROVED: { label: 'Approved', tone: 'success' }, REFUSED: { label: 'Refused', tone: 'error' },
}

function ApprovalCard({ list, canDecide, pending, error, onDecide }: { list: ContactList; canDecide: boolean; pending: boolean; error: unknown; onDecide: (approved: boolean, note: string) => void }) {
  const [note, setNote] = useState('')
  const status = list.approval_status ?? 'AWAITING'
  const tag = APPROVAL_TAG[status] ?? APPROVAL_TAG.AWAITING
  return (
    <section aria-label="Approval" className="mb-4 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="text-card-title font-semibold text-ink-900">Approval</h2>
        <Tag tone={tag.tone}>{tag.label}</Tag>
      </div>
      <div className="p-4">
        {status === 'AWAITING' ? (
          <p className="text-sm text-ink-800">
            The workspace's consent policy asks for approval before the first send. Campaigns can be built with this list, but none will send to it until someone with Consent · Edit approves it.
          </p>
        ) : (
          <p className="text-sm text-ink-800">
            {status === 'APPROVED' ? 'Approved' : 'Refused'}{list.approved_by_name ? ` by ${list.approved_by_name}` : ''}{list.approved_at ? ` on ${formatDateTime(list.approved_at)}` : ''}.
            {list.approval_note ? ` “${list.approval_note}”` : ''}
            {status === 'REFUSED' ? ' No campaign sends to it. Approving it later lifts that.' : ''}
          </p>
        )}
        {canDecide && status !== 'APPROVED' && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-0 grow">
              <Field label="Note" hint="Optional. Kept on the compliance record." limit={{ used: note.length, max: 300 }}>
                {(ids) => <TextInput {...ids} value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />}
              </Field>
            </div>
            {status === 'AWAITING' && <button type="button" className={buttonSecondary} disabled={pending} onClick={() => onDecide(false, note)}>Refuse</button>}
            <button type="button" className={buttonPrimary} disabled={pending} onClick={() => onDecide(true, note)}>Approve List</button>
          </div>
        )}
        {error ? <div className="mt-3"><ErrorState title="The decision was not saved" error={error} /></div> : null}
      </div>
    </section>
  )
}

const HELD_BACK_LABEL: Record<string, string> = { NO_CONSENT_DATE: 'refused: no consent date', NO_TEXT_CONSENT_DATE: 'refused: no text consent date' }

function ComplianceCard({ record }: { record: ComplianceRecord }) {
  const [open, setOpen] = useState(false)
  const latest = record.uploads[record.uploads.length - 1]
  const policy = record.policy
  const policyWords = [policy.without_consent === 'REFUSE' ? 'Refuse without consent' : 'Hold back without consent', policy.texts_need_date ? 'Texts need a date' : null,
    policy.approval_before_send ? 'Approval before first send' : null, `Lifetime ${policy.lifetime_months % 12 === 0 ? `${policy.lifetime_months / 12} year${policy.lifetime_months === 12 ? '' : 's'}` : `${policy.lifetime_months} months`}`].filter(Boolean).join(' · ')
  const channelLabel = (code: string) => (code === 'SMS' ? 'Texts' : 'Email')
  return (
    <section aria-label="Compliance Record" className="mb-4 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="text-card-title font-semibold text-ink-900">Compliance Record</h2>
        <button type="button" className={buttonSecondary} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide Details' : 'Show Details'}</button>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-800">Source</dt><dd className="text-ink-900">{record.inherited ? `${record.list.source_type === 'CLONE' ? 'Copy of a list' : 'Audience'}${record.list.source_reference ? `, ${record.list.source_reference}` : ''}` : latest ? `Upload ${latest.file_name}${latest.completed_at ? `, ${formatDateTime(latest.completed_at)}` : ''}` : 'No upload yet'}</dd>
          <dt className="text-ink-800">Consent basis</dt><dd className="text-ink-900">{record.inherited ? "Inherited from each person's own records" : latest?.basis_label ?? 'Not declared'}</dd>
          {!record.inherited && latest?.collected_at && <><dt className="text-ink-800">Collected at</dt><dd className="text-ink-900">{latest.collected_at}</dd></>}
          {!record.inherited && latest?.attested_by_name && <><dt className="text-ink-800">Attested by</dt><dd className="text-ink-900">{latest.attested_by_name}{latest.attested_at ? `, ${formatDateTime(latest.attested_at)}` : ''}</dd></>}
          <dt className="text-ink-800">Approval</dt>
          <dd className="text-ink-900">{record.approval.status === 'NOT_REQUIRED' ? (record.inherited ? 'Not required for audiences and copies' : 'Not required') : `${APPROVAL_TAG[record.approval.status]?.label ?? record.approval.status}${record.approval.by_name ? ` by ${record.approval.by_name}` : ''}${record.approval.at ? `, ${formatDateTime(record.approval.at)}` : ''}`}</dd>
          <dt className="text-ink-800">Policy today</dt><dd className="text-ink-900">{policyWords}</dd>
        </dl>
        <table className="w-full text-sm">
          <caption className="sr-only">Consent today</caption>
          <thead className="text-xs font-semibold text-ink-900"><tr><th scope="col" className="py-1 text-left">Consent today</th>{record.consent.map((line) => <th key={line.channel} scope="col" className="py-1 text-right">{channelLabel(line.channel)}</th>)}</tr></thead>
          <tbody className="divide-y divide-line-subtle">
            {([['Opted in (from the file)', 'opted_in_from_file'], ['Confirmed since', 'confirmed_since'], ['No consent on record', 'no_consent'], ['Unsubscribed', 'unsubscribed']] as const).map(([label, key]) => (
              <tr key={key} data-consent-line={key}><td className="py-1 text-ink-800">{label}</td>{record.consent.map((line) => <td key={line.channel} className="cep-num py-1 text-right text-ink-900">{formatNumber(line[key])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="border-t border-line-subtle px-4 py-3 text-sm">
          <p className="mb-2 text-xs font-semibold text-ink-800">Attestation wording</p>
          <p className="mb-3 text-ink-900">{policy.attestation}</p>
          {record.uploads.length > 0 && (
            <>
              <p className="mb-1 text-xs font-semibold text-ink-800">Uploads</p>
              <ul className="divide-y divide-line-subtle">
                {record.uploads.map((upload) => (
                  <li key={upload.id} className="py-1.5 text-ink-800">
                    <span className="font-medium text-ink-900">{upload.file_name}</span>{upload.completed_at ? ` · ${formatDateTime(upload.completed_at)}` : ''} · {formatNumber(upload.rows)} rows, {formatNumber(upload.applied)} added, {formatNumber(upload.consents_recorded)} consents recorded
                    {upload.basis_label ? ` · ${upload.basis_label}` : ''}{upload.attested_by_name ? ` · attested by ${upload.attested_by_name}` : ''}
                    {Object.entries(upload.held_back).map(([code, count]) => ` · ${formatNumber(count)} ${HELD_BACK_LABEL[code] ?? code}`).join('')}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-2 text-xs text-ink-800">The consent figures are rebuilt from consent records each time this page opens; the attestation and the approval never change. Generated {formatDateTime(record.generated_at)}.</p>
        </div>
      )}
    </section>
  )
}

export function ContactListDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { can } = useAuth()
  const editable = can('list.edit')
  const [search, setSearch] = useState('')
  const [consent, setConsent] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<'edit' | 'add' | 'clone' | 'remove' | null>(null)
  const [notice, setNoticeOnly] = useState('')
  // a failed action: what failed and why, drawn as an error rather than beside the notices
  const [problem, setProblemOnly] = useState<{ title: string; error: unknown } | null>(null)
  const setNotice = (text: string) => { setNoticeOnly(text); setProblemOnly(null) }
  const setProblem = (title: string, error: unknown) => { setProblemOnly({ title, error }); setNoticeOnly('') }

  const list = useQuery({ queryKey: ['contact-lists', id], queryFn: ({ signal }) => api.get<ContactList>(`/contact-lists/${id}/`, undefined, signal) })
  const usage = useQuery({ queryKey: ['contact-lists', id, 'usage'], queryFn: ({ signal }) => api.get<ListUsage>(`/contact-lists/${id}/usage/`, undefined, signal) })
  const governance = useQuery({ queryKey: ['contact-lists', id, 'governance'], queryFn: ({ signal }) => api.get<ListGovernance>(`/contact-lists/${id}/governance/`, undefined, signal) })
  const compliance = useQuery({ queryKey: ['contact-lists', id, 'compliance'], queryFn: ({ signal }) => api.get<ComplianceRecord>(`/contact-lists/${id}/compliance/`, undefined, signal) })
  const decide = useMutation({
    mutationFn: ({ approved, note }: { approved: boolean; note: string }) => api.post<ContactList>(`/contact-lists/${id}/${approved ? 'approve' : 'refuse'}/`, { note }),
    onSuccess: (next, { approved }) => {
      if (approved) toast.success('List approved', `Campaigns can send to “${next.name}” now.`)
      else toast.success('List refused', `No campaign sends to “${next.name}”.`)
      queryClient.setQueryData(['contact-lists', id], next)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists', id, 'compliance'] })
      void queryClient.invalidateQueries({ queryKey: ['contact-lists'] })
    },
  })
  const members = useQuery({
    queryKey: ['contact-lists', id, 'members', search.trim(), consent, page],
    queryFn: ({ signal }) => api.get<ListMembersPage>(`/contact-lists/${id}/members/`, { search: search.trim() || undefined, status: consent || undefined, page, page_size: PAGE_SIZE }, signal),
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
      setNotice(`${formatNumber(result.removed)} contact${result.removed === 1 ? '' : 's'} removed from this list. They are still in C360.`)
      refreshAll()
    },
  })
  const sync = useMutation({
    mutationFn: () => api.post<{ added: number; removed: number }>(`/contact-lists/${id}/refresh/`),
    onSuccess: (result) => {
      setNotice(`In line with its audience: ${formatNumber(result.added)} added, ${formatNumber(result.removed)} removed.`)
      refreshAll()
    },
    onError: (error) => setProblem('The list was not brought up to date', error),
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
      setProblem('The contacts were not exported', error)
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
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-800">
        <Link to="/contact-lists" className="font-medium text-brand-800 hover:underline">Contact Lists</Link> <span aria-hidden>/</span> {data.name}
      </nav>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-page-title font-semibold text-ink-900">{data.name}</h1>
          {data.description && <p className="mt-1 max-w-2xl text-sm text-ink-800">{data.description}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <TypeBadge environment={data.list_environment} />
            <Tag>{data.source_label ?? data.source_type}</Tag>
            {archived && <StatusBadge status="ARCHIVED" />}
            {data.source_reference && <span className="text-xs text-ink-800">from {data.source_reference}</span>}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {followsAudience && (
              <button type="button" className={buttonSecondary} onClick={() => sync.mutate()} disabled={sync.isPending || archived}>
                <RefreshCw size={16} strokeWidth={1.5} aria-hidden /> Refresh Now
              </button>
            )}
            <button type="button" className={buttonSecondary} onClick={() => setDialog('clone')}>Clone</button>
            <button type="button" className={buttonSecondary} onClick={() => setDialog('edit')}>Edit Details</button>
            <button type="button" className={buttonPrimary} onClick={() => setDialog('add')} disabled={archived}>
              <Plus size={16} strokeWidth={2} aria-hidden /> Add Contacts
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
        {([['Contacts', data.member_count], ['Added This Week', usage.data?.added_this_week], ['Attached Campaigns', usage.data?.attached_campaigns]] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
            <dt className="text-xs font-semibold text-ink-800">{label}</dt>
            <dd className="cep-num mt-1 font-display text-kpi font-semibold text-ink-900">{value === undefined ? '–' : formatNumber(value)}</dd>
          </div>
        ))}
      </dl>

      {attached > 0 && (
        <section aria-label="Attached Campaigns" className="mb-4 rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-2 text-card-title font-semibold text-ink-900">Attached Campaigns</h2>
          <ul className="divide-y divide-line-subtle">
            {usage.data?.campaigns.map((campaign) => (
              <li key={campaign.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <Link to={`/campaigns/${campaign.id}`} className="min-w-0 grow truncate font-medium text-brand-800 hover:underline">{campaign.name}</Link>
                <Tag>{campaign.channel}</Tag>
                <StatusBadge status={campaign.status} />
                {campaign.live && <span className="text-xs font-semibold text-success-text">Live</span>}
                {campaign.frozen_lists > 0 && <span className="text-xs text-ink-800">{campaign.frozen_lists} Campaign List{campaign.frozen_lists === 1 ? '' : 's'} already built</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.approval_status && data.approval_status !== 'NOT_REQUIRED' && (
        <ApprovalCard list={data} canDecide={can('consent.edit')} pending={decide.isPending} error={decide.isError ? decide.error : null}
          onDecide={(approved, note) => decide.mutate({ approved, note })} />
      )}

      {compliance.data && <ComplianceCard record={compliance.data} />}

      {governance.data && governance.data.total > 0 && (
        <section aria-label="Governance Check" className="mb-4 rounded-lg border border-line bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-card-title font-semibold text-ink-900">Governance Check · Marketing Email, as of Today</h2>
            <p className="cep-num text-sm text-ink-800">{formatNumber(governance.data.sendable)} of {formatNumber(governance.data.total)} can receive it</p>
          </div>
          <div className="max-w-xl"><GovernanceLines statuses={governance.data.statuses} total={governance.data.total} sendable={governance.data.sendable} /></div>
          <p className="mt-2 text-xs text-ink-800">Unsubscribes, bounces, complaints, blocked and invalid addresses, suppression and consent, with the rules a send uses. Transactional campaigns ignore consent, not blocked or invalid addresses.</p>
        </section>
      )}

      {notice && <p role="status" className="mb-4 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>}
      {problem && <div className="mb-4"><ErrorState title={problem.title} error={problem.error} /></div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField label="Search contacts" value={search} onChange={(next) => { setSearch(next); setPage(1) }} />
        <SelectFilter label="Consent" options={CONSENT_FILTERS} value={consent} menuWidth={260} onChange={(next) => { setConsent(next); setPage(1); setSelected([]) }} />
        {(search || consent) && <ClearFiltersLink onClick={() => { setSearch(''); setConsent(''); setPage(1); setSelected([]) }} />}
        <span className="text-sm text-ink-800" aria-live="polite">{selected.length === 0 ? 'No contacts selected' : `${formatNumber(selected.length)} selected`}</span>
        {members.isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Contacts in {data.name}</caption>
            <thead className="text-sm font-semibold whitespace-nowrap text-ink-900">
              <tr className="h-12 border-b border-line">
                <th scope="col" className="w-10 pr-2 pl-6">
                  <input type="checkbox" aria-label="Select everyone on this page" checked={allOnPage} disabled={rows.length === 0}
                    onChange={() => setSelected(allOnPage ? selected.filter((value) => !rows.some((row) => row.id === value)) : [...new Set([...selected, ...rows.map((row) => row.id)])])}
                    className="h-4 w-4 accent-brand-600" />
                </th>
                <th scope="col" className="px-2">Email</th>
                <th scope="col" className="px-2">First Name</th>
                <th scope="col" className="px-2">Last Name</th>
                <th scope="col" className="px-2 text-right">Added On</th>
                <th scope="col" className="px-2">Source</th>
                <th scope="col" className="pr-6 pl-2">Marketing Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((row) => (
                <tr key={row.id} className={`h-[72px] transition-colors duration-fast ease-standard ${selected.includes(row.id) ? 'bg-callout-bg' : 'hover:bg-surface-hover'}`}>
                  <td className="py-3 pr-2 pl-6">
                    <input type="checkbox" aria-label={`Select ${row.email ?? row.party_id}`} checked={selected.includes(row.id)}
                      onChange={() => setSelected(selected.includes(row.id) ? selected.filter((value) => value !== row.id) : [...selected, row.id])} className="h-4 w-4 accent-brand-600" />
                  </td>
                  <td className="px-2 py-3 text-card-title font-semibold text-ink-900">
                    {row.known ? <Link to={`/customers/${encodeURIComponent(row.party_id)}`} className="hover:underline">{row.email ?? row.party_id}</Link>
                      : row.email ?? <span className="font-normal text-ink-800">no email on file · {row.party_id}</span>}
                  </td>
                  <td className="px-2 py-3 text-ink-800">{row.first_name ?? '—'}</td>
                  <td className="px-2 py-3 text-ink-800">{row.last_name ?? '—'}</td>
                  <td className="cep-num px-2 py-3 text-right text-ink-800">{formatDate(row.added_at)}</td>
                  <td className="px-2 py-3"><Tag>{MEMBER_SOURCE[row.source] ?? titleize(row.source)}</Tag></td>
                  <td className="py-3 pr-6 pl-2">
                    {row.email_status_label && (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${row.sendable ? 'text-success-text' : 'text-warning-text'}`}>
                        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${row.sendable ? 'bg-success' : 'bg-warning'}`} />
                        {row.sendable ? 'Can Receive' : row.email_status_label}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-800">{members.isPending ? 'Loading contacts' : search.trim() || consent ? 'No contact matches this search.' : 'Nobody is in this list yet.'}</td></tr>
              )}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 text-sm text-ink-800">
            <span className="cep-num">Showing {formatNumber(rows.length)} of {formatNumber(total)}</span>
            <span className="flex flex-wrap items-center gap-2">
              {pages > 1 && (
                <>
                  <button type="button" className={buttonSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <span className="cep-num">Page {page} of {formatNumber(pages)}</span>
                  <button type="button" className={buttonSecondary} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
                </>
              )}
              <button type="button" className={buttonSecondary} onClick={() => void exportSelected()} disabled={total === 0}>{selected.length > 0 ? 'Export Selected' : 'Export All'}</button>
              {editable && <button type="button" className={buttonDanger} disabled={selected.length === 0 || archived} onClick={() => { remove.reset(); setDialog('remove') }}>Remove from List</button>}
            </span>
          </div>
        </div>
      )}

      {dialog === 'edit' && <EditDetails list={data} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice('Details saved.'); refreshAll() }} />}
      {dialog === 'add' && (
        <AddContacts list={data} onClose={() => setDialog(null)} onAdded={(result) => {
          setDialog(null)
          const parts = [`${formatNumber(result.added)} added`]
          if (result.new_people) parts.push(`${formatNumber(result.new_people)} new to C360`)
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
              <button type="button" className={buttonSecondary} onClick={() => setDialog(null)}>Keep Them</button>
              <button type="button" className={buttonDanger} disabled={remove.isPending} onClick={() => remove.mutate()}>Remove {formatNumber(selected.length)}</button>
            </>
          }
        >
          <p className="text-sm text-ink-800">
            {formatNumber(selected.length)} contact{selected.length === 1 ? '' : 's'} leave{selected.length === 1 ? 's' : ''} “{data.name}”. They stay in C360 and in every other list.
            {followsAudience && ' Someone who still qualifies for the audience comes back at the next refresh.'}
          </p>
          {remove.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-plain">{problemText(remove.error)}</p>}
        </Modal>
      )}
    </section>
  )
}
