/** Contact Lists landing: three numbers, search + Type / Source filters, the table, and the ways to make a list. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreVertical, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { Field, TextInput, buttonDanger, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'

import { CHANNEL_LABEL } from './uploadTemplate'
import { iconButtonClass } from '@/components/buttonStyles'
import { MenuRow } from '@/components/MenuRow'
import { useFieldRules } from '@/lib/fieldRules'
import { api } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { ContactList, ListReach, ListStats } from '@/lib/types'
import { useCursorList } from '@/lib/useCursorList'

import { CreateListWizard } from './CreateListWizard'
import { problemText } from './problem'

import { PageHelp } from '@/help/HelpPanel'

export function TypeBadge({ environment }: { environment: string }) {
  return <StatusBadge status={environment} label={environment === 'TEST' ? 'Test' : 'Production'} />
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="text-xs font-semibold text-ink-800">{label}</dt>
      <dd className="cep-num mt-1 font-display text-2xl font-semibold text-ink-900">{value === undefined ? '–' : formatNumber(value)}</dd>
    </div>
  )
}

function RowMenu({ list, onAction }: { list: ContactList; onAction: (action: 'open' | 'clone' | 'archive' | 'restore' | 'delete') => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const pick = (action: Parameters<typeof onAction>[0]) => () => {
    setOpen(false)
    onAction(action)
  }
  return (
    <div ref={box} className="relative inline-block" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${list.name}`} onClick={() => setOpen((value) => !value)}
        className={iconButtonClass({ pressed: open })}>
        <MoreVertical size={18} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-line bg-surface shadow-menu">
          <MenuRow role="menuitem" divider={false} title="Open" onClick={pick('open')} />
          <MenuRow role="menuitem" divider={false} title="Clone" onClick={pick('clone')} />
          <MenuRow role="menuitem" divider={false} title={list.status === 'ARCHIVED' ? 'Restore' : 'Archive'} onClick={pick(list.status === 'ARCHIVED' ? 'restore' : 'archive')} />
          <MenuRow role="menuitem" divider={false} tone="error" title="Delete" onClick={pick('delete')} />
        </div>
      )}
    </div>
  )
}

export function CloneDialog({ source, onClose, onCloned }: { source: ContactList; onClose: () => void; onCloned: (list: ContactList) => void }) {
  const [name, setName] = useState(`${source.name} (copy)`)
  const rule = useFieldRules('new_contact_list')
  const clone = useMutation({
    mutationFn: () => api.post<ContactList>(`/contact-lists/${source.id}/clone/`, { name, list_environment: source.list_environment }),
    onSuccess: onCloned,
  })
  return (
    <Modal
      title="Clone This List"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={name.trim() === '' || clone.isPending} onClick={() => clone.mutate()}>Create the Copy</button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-800">
        The copy starts with the {formatNumber(source.member_count)} contacts that are in “{source.name}” now. It is a snapshot: the two lists are independent from here on.
      </p>
      <Field label="Name of the Copy" required error={clone.isError ? problemText(clone.error) : undefined} limit={{ used: name.length, max: rule('name')?.max ?? 200 }}>
        {(ids) => (
          <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} maxLength={rule('name')?.max ?? 200} autoFocus />
        )}
      </Field>
    </Modal>
  )
}

/** How many of the list a marketing send could reach today, by channel: the figure the audience build computes for a campaign. */
function ReachCell({ list }: { list: ContactList }) {
  const reach = useQuery({
    queryKey: ['contact-lists', list.id, 'reach', list.member_count],
    queryFn: ({ signal }) => api.get<ListReach>(`/contact-lists/${list.id}/reach/`, undefined, signal),
    staleTime: 5 * 60_000,
    enabled: list.member_count > 0 && list.status !== 'DRAFT',
  })
  if (list.member_count === 0 || list.status === 'DRAFT') return <span className="text-ink-300">—</span>
  if (reach.isPending) return <span className="text-ink-300">…</span>
  if (reach.isError) return <span className="text-ink-300" title="The reach could not be counted">—</span>
  const { email, sms } = reach.data
  return (
    <span className="cep-num inline-flex flex-col items-end text-xs leading-4" data-reach title={`Email: ${formatNumber(email.sendable)} of ${formatNumber(email.total)} · Texts: ${formatNumber(sms.sendable)} of ${formatNumber(sms.total)}`}>
      <span><span className="text-ink-800">Email </span><span className="font-medium text-ink-900">{formatNumber(email.sendable)}</span></span>
      <span><span className="text-ink-800">SMS </span><span className="font-medium text-ink-900">{formatNumber(sms.sendable)}</span></span>
    </span>
  )
}

export function ContactListsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [source, setSource] = useState('')
  // ?new=1 (Home's Create New) opens the wizard straight away
  const [params, setParams] = useSearchParams()
  const [wizard, setWizard] = useState(() => params.get('new') === '1')
  const [cloning, setCloning] = useState<ContactList | null>(null)
  const [deleting, setDeleting] = useState<ContactList | null>(null)
  const [notice, setNotice] = useState('')

  const stats = useQuery({ queryKey: ['contact-lists', 'stats'], queryFn: ({ signal }) => api.get<ListStats>('/contact-lists/stats/', undefined, signal) })
  const list = useCursorList<ContactList>('contact-lists', { search: search.trim() || undefined, list_environment: type || undefined, source: source || undefined, ordering: '-updated_at' })
  const filtered = search.trim() !== '' || type !== '' || source !== ''
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['contact-lists'] })

  const setStatus = useMutation({
    mutationFn: ({ target, status }: { target: ContactList; status: string }) => api.patch<ContactList>(`/contact-lists/${target.id}/`, { status }),
    onSuccess: (saved) => {
      setNotice(saved.status === 'ARCHIVED' ? `“${saved.name}” is archived. Campaigns can no longer pick it.` : `“${saved.name}” is active again.`)
      refresh()
    },
    onError: (error) => setNotice(problemText(error)),
  })
  const remove = useMutation({
    mutationFn: (target: ContactList) => api.delete(`/contact-lists/${target.id}/`),
    onSuccess: (_, target) => {
      setDeleting(null)
      setNotice(`“${target.name}” was deleted.`)
      refresh()
    },
  })

  const editable = can('list.edit')
  const columns: Column<ContactList>[] = [
    {
      key: 'name', header: 'Name', className: 'max-w-sm',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.name}{row.status === 'ARCHIVED' && <span className="ml-2 align-middle"><Tag>Archived</Tag></span>}</p>
          {row.description && <p className="truncate text-xs text-ink-800">{row.description}</p>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (row) => <TypeBadge environment={row.list_environment} /> },
    { key: 'for', header: 'For', render: (row) => <Tag>{CHANNEL_LABEL[row.channel] ?? 'Email'}</Tag> },
    { key: 'source', header: 'Source', render: (row) => <Tag>{row.source_label ?? row.source_type}</Tag> },
    { key: 'contacts', header: 'Contacts', align: 'right', render: (row) => formatNumber(row.member_count) },
    { key: 'reach', header: 'Can Reach', align: 'right', render: (row) => <ReachCell list={row} /> },
    {
      key: 'campaigns', header: 'Campaigns', align: 'right',
      render: (row) => (row.live_campaigns ? <span title="attached to a live campaign">{row.attached_campaigns} · {row.live_campaigns} live</span> : formatNumber(row.attached_campaigns ?? 0)),
    },
    { key: 'updated', header: 'Updated', align: 'right', render: (row) => formatDate(row.updated_at) },
    ...(editable
      ? [{
          key: 'actions', header: '', align: 'right' as const,
          render: (row: ContactList) => (
            <RowMenu list={row} onAction={(action) => {
              if (action === 'open') navigate(`/contact-lists/${row.id}`)
              else if (action === 'clone') setCloning(row)
              else if (action === 'delete') { remove.reset(); setDeleting(row) }
              else setStatus.mutate({ target: row, status: action === 'archive' ? 'ARCHIVED' : 'ACTIVE' })
            }} />
          ),
        }]
      : []),
  ]

  return (
    <section>
      <PageHeader
        title="Contact Lists"
        help={<PageHelp chapter="contact-lists" />}
        description="Reusable audiences. A campaign freezes its own copy at send time, so changing a list never changes a send that was already built."
        actions={
          <span className="flex flex-wrap gap-2">
            <Link to="/contact-lists/uploads" className={buttonSecondary}>Uploads</Link>
            {editable && (
              <button type="button" className={buttonPrimary} onClick={() => setWizard(true)}>
                <Plus size={16} strokeWidth={2} aria-hidden /> Create List
              </button>
            )}
          </span>
        }
      />

      <dl className="mb-4 grid gap-3 sm:grid-cols-3" aria-label="Contact List Totals">
        <StatCard label="Total Lists" value={stats.data?.total_lists} />
        <StatCard label="Total Contacts" value={stats.data?.total_contacts} />
        <StatCard label="Attached to Live Campaigns" value={stats.data?.attached_to_live_campaigns} />
      </dl>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lists" aria-label="Search lists"
          className="h-10 w-full rounded-control-lg border border-line-control bg-surface px-3 text-sm sm:w-64" />
        <label className="flex items-center gap-2 text-sm text-ink-800">
          Type
          <select value={type} onChange={(event) => setType(event.target.value)} className="h-10 rounded-control-lg border border-line-control bg-surface px-3 text-sm text-ink-900">
            <option value="">All</option>
            <option value="PRODUCTION">Production</option>
            <option value="TEST">Test</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-800">
          Source
          <select value={source} onChange={(event) => setSource(event.target.value)} className="h-10 rounded-control-lg border border-line-control bg-surface px-3 text-sm text-ink-900">
            <option value="">All</option>
            <option value="UPLOAD">Upload</option>
            <option value="BI">BI / Extraction</option>
            <option value="CLONE">Cloned</option>
          </select>
        </label>
        {list.isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>
      )}

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-10 text-sm text-ink-800"><Spinner /> Loading contact lists</div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={filtered ? 'Nothing matches these filters' : 'No contact lists yet'} hint={filtered ? undefined : 'Create the first one from a file, an audience your data team defined, or an existing list.'} />
      ) : (
        <>
          <DataTable columns={columns} rows={list.rows} rowKey={(row) => row.id} onRowClick={(row) => navigate(`/contact-lists/${row.id}`)} caption="Contact Lists" />
          <div className="mt-3 flex items-center justify-between gap-2 text-sm text-ink-800">
            <span>{list.rows.length} list{list.rows.length === 1 ? '' : 's'} shown</span>
            {(list.hasNext || list.hasPrevious) && (
              <span className="flex gap-2">
                <button type="button" className={buttonSecondary} disabled={!list.hasPrevious} onClick={list.goPrevious}>Previous</button>
                <button type="button" className={buttonSecondary} disabled={!list.hasNext} onClick={list.goNext}>Next</button>
              </span>
            )}
          </div>
        </>
      )}

      {wizard && editable && (
        <CreateListWizard onClose={() => {
          setWizard(false)
          if (params.has('new')) setParams((current) => { current.delete('new'); return current }, { replace: true })
        }} onCreated={refresh} />
      )}
      {cloning && (
        <CloneDialog source={cloning} onClose={() => setCloning(null)} onCloned={(copy) => { setCloning(null); refresh(); navigate(`/contact-lists/${copy.id}`) }} />
      )}
      {deleting && (
        <Modal
          title="Delete this list?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setDeleting(null)}>Keep It</button>
              <button type="button" className={buttonDanger} disabled={remove.isPending} onClick={() => remove.mutate(deleting)}>Delete List</button>
            </>
          }
        >
          <p className="text-sm text-ink-800">“{deleting.name}” and its {formatNumber(deleting.member_count)} memberships are removed. The people stay in CEP. Sends that were already built are not affected.</p>
          {remove.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-plain">{problemText(remove.error)}</p>}
        </Modal>
      )}
    </section>
  )
}
