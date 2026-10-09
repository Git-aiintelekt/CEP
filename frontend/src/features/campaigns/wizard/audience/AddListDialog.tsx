/**
 * Add Contact List: tick lists the workspace already has, upload a new one, or make one from an audience or a clone
 * (the Contact lists page's own wizard, drawn inside this pop-up). Leaving a list out uses the same pop-up with the
 * existing lists only.
 */
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { buttonPrimary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Tag } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { CreateListWizard } from '@/features/contact-lists/CreateListWizard'
import { sourceLabel } from '@/features/contact-lists/sourceLabel'
import { formatDate, formatNumber } from '@/lib/format'
import type { ContactList } from '@/lib/types'

type Tab = 'existing' | 'upload' | 'make'
type Environment = '' | 'PRODUCTION' | 'TEST'
type Source = '' | 'UPLOAD' | 'BI' | 'CLONE'

const ENVIRONMENTS: { value: Environment; label: string }[] = [{ value: 'PRODUCTION', label: 'Production' }, { value: 'TEST', label: 'Test' }]
const SOURCES: { value: Source; label: string }[] = [{ value: 'UPLOAD', label: 'Upload' }, { value: 'BI', label: 'BI / Extraction' }, { value: 'CLONE', label: 'Clone' }]
const fromSource = (list: ContactList, source: Source) =>
  source === '' || (source === 'BI' ? ['BI', 'EXTRACTION', 'SEGMENT'].includes(list.source_type) : list.source_type === source)

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`h-8 rounded-control-md border px-3 text-helper font-semibold transition-colors duration-fast ease-standard ${pressed ? 'border-link bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-800 hover:bg-surface-hover'}`}>
      {children}
    </button>
  )
}

interface AddListDialogProps {
  /** send: the lists the campaign goes to; leave-out: lists whose people are left out */
  purpose: 'send' | 'leave-out'
  lists: ContactList[]
  /** already sent to, and already left out: shown ticked or marked, never picked twice */
  sendTo: string[]
  leftOut: string[]
  /** may make lists (list.edit): the Upload New and From an Audience or a Clone tabs */
  canMake: boolean
  onAdd: (ids: string[]) => void
  onCreated: (list: ContactList) => void
  onClose: () => void
}

export function AddListDialog({ purpose, lists, sendTo, leftOut, canMake, onAdd, onCreated, onClose }: AddListDialogProps) {
  const [tab, setTab] = useState<Tab>('existing')
  const [search, setSearch] = useState('')
  const [environment, setEnvironment] = useState<Environment>('')
  const [source, setSource] = useState<Source>('')
  const [picked, setPicked] = useState<string[]>([])
  const sending = purpose === 'send'
  const mine = sending ? sendTo : leftOut
  const other = sending ? leftOut : sendTo

  const needle = search.trim().toLowerCase()
  const shown = lists.filter((list) => list.name.toLowerCase().includes(needle) && (environment === '' || list.list_environment === environment) && fromSource(list, source))
  const pickable = shown.filter((list) => !mine.includes(list.id) && !other.includes(list.id))
  const allPicked = pickable.length > 0 && pickable.every((list) => picked.includes(list.id))
  const toggle = (id: string, on: boolean) => setPicked((now) => (on ? [...new Set([...now, id])] : now.filter((item) => item !== id)))
  const tabs = [
    { value: 'existing' as const, label: 'Existing Lists' },
    ...(sending && canMake ? [{ value: 'upload' as const, label: 'Upload New' }, { value: 'make' as const, label: 'From an Audience or a Clone' }] : []),
  ]

  const footer = tab === 'existing' && (
    <>
      <button type="button" className={buttonClass({ variant: 'ghost' })} onClick={onClose}>Cancel</button>
      <button type="button" className={buttonPrimary} disabled={picked.length === 0} onClick={() => { onAdd(picked); onClose() }}>
        {sending ? 'Add' : 'Leave Out'} {picked.length === 0 ? 'Lists' : `${formatNumber(picked.length)} ${picked.length === 1 ? 'List' : 'Lists'}`}
      </button>
    </>
  )

  return (
    <Modal title={sending ? 'Add Contact List' : 'Leave Out a List'} onClose={onClose} size="picker" scrollBody footer={footer || undefined}
      toolbar={tabs.length > 1 ? <SegmentedControl label="How to add a list" value={tab} onChange={setTab} options={tabs} /> : undefined}>
      {tab === 'existing' && (
        <div className="flex flex-col gap-4">
          <label className="flex h-10 items-center gap-2 rounded-control-lg bg-surface-sunken px-3 focus-within:bg-surface focus-within:shadow-focus">
            <Search size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lists by name" aria-label="Search contact lists"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300" autoFocus />
          </label>
          <div role="group" aria-label="Filter lists" className="flex flex-wrap gap-2">
            <Chip pressed={environment === '' && source === ''} onClick={() => { setEnvironment(''); setSource('') }}>All</Chip>
            {ENVIRONMENTS.map((item) => <Chip key={item.value} pressed={environment === item.value} onClick={() => setEnvironment(environment === item.value ? '' : item.value)}>{item.label}</Chip>)}
            {SOURCES.map((item) => <Chip key={item.value} pressed={source === item.value} onClick={() => setSource(source === item.value ? '' : item.value)}>{item.label}</Chip>)}
          </div>

          {lists.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-800">
              No active contact lists yet.{' '}
              {canMake && sending ? 'Upload one on the Upload New tab, or make one from an audience.' : <Link to="/contact-lists" className="font-semibold text-brand-800 hover:underline">See Contact Lists</Link>}
            </p>
          ) : (
            <div className="rounded-lg border border-line">
              <label className="flex items-center gap-3 border-b border-line bg-surface-subtle px-4 py-2.5 text-xs font-semibold text-ink-800">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allPicked} disabled={pickable.length === 0}
                  onChange={(event) => setPicked((now) => (event.target.checked ? [...new Set([...now, ...pickable.map((list) => list.id)])] : now.filter((id) => !pickable.some((list) => list.id === id))))}
                  aria-label="Select every list shown" />
                <span className="flex-1">List</span>
                <span className="w-20 text-right">Contacts</span>
                <span className="hidden w-28 sm:block">Updated</span>
              </label>
              <ul aria-label="Contact Lists" className="max-h-80 divide-y divide-line-subtle overflow-y-auto">
                {shown.map((list) => {
                  const already = mine.includes(list.id)
                  const elsewhere = other.includes(list.id)
                  return (
                    <li key={list.id}>
                      <label className={`flex items-start gap-3 px-4 py-3 ${already || elsewhere ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-hover'}`}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" aria-label={list.name}
                          checked={already || picked.includes(list.id)} disabled={already || elsewhere} onChange={(event) => toggle(list.id, event.target.checked)} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className={`truncate text-sm font-semibold ${already || elsewhere ? 'text-ink-800' : 'text-ink-900'}`}>{list.name}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-helper text-ink-800">
                            <Tag>{sourceLabel(list.source_type)}</Tag>
                            {list.list_environment === 'TEST' && <Tag tone="warning">Test</Tag>}
                            {already && <Tag>{sending ? 'Added' : 'Left Out'}</Tag>}
                            {elsewhere && <Tag>{sending ? 'Left Out' : 'Sent To'}</Tag>}
                            {(list.live_campaigns ?? 0) > 0 && <span>on {list.live_campaigns} live campaign{list.live_campaigns === 1 ? '' : 's'}</span>}
                          </span>
                        </span>
                        <span className="cep-num w-20 shrink-0 text-right text-sm text-ink-800">{formatNumber(list.member_count)}</span>
                        <span className="cep-num hidden w-28 shrink-0 text-sm text-ink-800 sm:block">{formatDate(list.updated_at)}</span>
                      </label>
                    </li>
                  )
                })}
                {shown.length === 0 && (
                  <li className="px-4 py-6 text-center">
                    <p className="text-sm font-semibold text-ink-900">Nothing left to add</p>
                    <p className="text-helper text-ink-800">Clear the search or filters to see more.</p>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
      {tab === 'upload' && (
        <CreateListWizard embedded inCampaign initialSource="UPLOAD" sources={['UPLOAD']} onClose={onClose} onCreated={onCreated} />
      )}
      {tab === 'make' && (
        <CreateListWizard embedded inCampaign initialSource="BI" sources={['BI', 'CLONE']} onClose={onClose} onCreated={onCreated} />
      )}
    </Modal>
  )
}
