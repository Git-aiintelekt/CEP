/**
 * Add Contact List: tick lists the workspace already has, upload a new one, or make one from an audience or a clone
 * (the Contact lists page's own wizard, drawn inside this pop-up). Leaving a list out uses the same pop-up with the
 * existing lists only.
 */
import { List as ListIcon, Search, Upload, Users, type LucideIcon } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { buttonPrimary } from '@/components/Form'
import { InputGroup } from '@/components/InputGroup'
import { Modal } from '@/components/Modal'
import { Tag } from '@/components/StatusBadge'
import { CreateListWizard } from '@/apps/cep/features/contact-lists/CreateListWizard'
import { sourceLabel } from '@/apps/cep/features/contact-lists/sourceLabel'
import { formatDate, formatNumber } from '@/lib/format'
import type { ContactList, ListChannel } from '@/lib/types'

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

interface WayIn { value: Tab; label: string; note: string; icon: LucideIcon }
const EXISTING: WayIn = { value: 'existing', label: 'Existing Lists', note: 'Pick from lists already in this workspace.', icon: ListIcon }
const UPLOAD: WayIn = { value: 'upload', label: 'Upload New', note: 'Bring in a file of contacts from your computer.', icon: Upload }
const MAKE: WayIn = { value: 'make', label: 'Audience or Clone', note: 'Build from a saved audience, or copy a list.', icon: Users }

/** the ways to add a list as three cards; a radio group like the segmented control: one tab stop, arrow keys move and choose */
function WayInCards({ value, onChange, options }: { value: Tab; onChange: (tab: Tab) => void; options: WayIn[] }) {
  const refs = useRef(new Map<Tab, HTMLButtonElement | null>())
  const current = Math.max(0, options.findIndex((option) => option.value === value))
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current === last ? 0 : current + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current === 0 ? last : current - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1
    if (next === -1) return
    event.preventDefault()
    onChange(options[next].value)
    refs.current.get(options[next].value)?.focus()
  }
  return (
    <div role="radiogroup" aria-label="How to add a list" className="grid gap-3 sm:grid-cols-3">
      {options.map((option, index) => {
        const selected = index === current
        const Icon = option.icon
        return (
          <button key={option.value} ref={(node) => { refs.current.set(option.value, node) }} type="button" role="radio" aria-checked={selected} aria-label={option.label}
            tabIndex={selected ? 0 : -1} onClick={() => onChange(option.value)} onKeyDown={onKeyDown}
            className={`flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors duration-fast ease-standard ${selected ? 'border-link bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-800 hover:bg-surface-hover'}`}>
            <span className={`flex items-center gap-2 text-sm font-semibold ${selected ? 'text-brand-800' : 'text-ink-900'}`}>
              <Icon size={16} strokeWidth={1.5} aria-hidden />{option.label}
            </span>
            <span className="text-helper">{option.note}</span>
          </button>
        )
      })}
    </div>
  )
}

interface AddListDialogProps {
  /** send: the lists the campaign goes to; leave-out: lists whose people are left out */
  purpose: 'send' | 'leave-out'
  lists: ContactList[]
  /** already sent to, and already left out: shown ticked or marked, never picked twice */
  sendTo: string[]
  leftOut: string[]
  /** may make lists (list.edit): the Upload New and Audience or Clone tabs */
  canMake: boolean
  /** the campaign's channel: what "Use for" starts on when a list is uploaded or made here */
  campaignChannel?: string
  /** "Review List" on the last screen: the page brings the new list into view */
  onReview?: (list: ContactList) => void
  onAdd: (ids: string[]) => void
  onCreated: (list: ContactList) => void
  onClose: () => void
}

const listChannelOf = (channel?: string): ListChannel | undefined => (channel === 'EMAIL' ? 'EMAIL' : channel === 'SMS' || channel === 'MMS' ? 'SMS' : undefined)

export function AddListDialog({ purpose, lists, sendTo, leftOut, canMake, campaignChannel, onReview, onAdd, onCreated, onClose }: AddListDialogProps) {
  const [tab, setTabNow] = useState<Tab>('existing')
  /** the wizard is on its first screen with nothing started: the way-in cards show; from the next step they would discard the upload */
  const [atStart, setAtStart] = useState(true)
  const [done, setDone] = useState(false)
  const setTab = (next: Tab) => { setAtStart(true); setTabNow(next) }
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
  const tabs: WayIn[] = [
    EXISTING,
    ...(sending && canMake ? [UPLOAD, MAKE] : []),
  ]

  const footer = tab === 'existing' && (
    <>
      <button type="button" className={buttonPrimary} disabled={picked.length === 0} onClick={() => { onAdd(picked); onClose() }}>
        {sending ? 'Add' : 'Exclude'} {picked.length === 0 ? 'Lists' : `${formatNumber(picked.length)} ${picked.length === 1 ? 'List' : 'Lists'}`}
      </button>
    </>
  )

  return (
    <Modal title={done ? 'List Created' : sending ? 'Add Contact List' : 'Exclude a List'} onClose={onClose} size="picker" scrollBody footer={footer || undefined}>
      {tabs.length > 1 && (tab === 'existing' || atStart) && <div className="mb-4"><WayInCards value={tab} onChange={setTab} options={tabs} /></div>}
      {tab === 'existing' && (
        <div className="flex flex-col gap-4">
          <InputGroup controlSize="md" type="search" aria-label="Search contact lists" placeholder="Search lists by name" value={search}
            onChange={(event) => setSearch(event.target.value)} start={<Search size={16} strokeWidth={1.5} aria-hidden />} autoFocus />
          <div role="group" aria-label="Filter lists" className="flex flex-wrap gap-2">
            <Chip pressed={environment === '' && source === ''} onClick={() => { setEnvironment(''); setSource('') }}>All</Chip>
            {ENVIRONMENTS.map((item) => <Chip key={item.value} pressed={environment === item.value} onClick={() => setEnvironment(environment === item.value ? '' : item.value)}>{item.label}</Chip>)}
            {SOURCES.map((item) => <Chip key={item.value} pressed={source === item.value} onClick={() => setSource(source === item.value ? '' : item.value)}>{item.label}</Chip>)}
          </div>

          {lists.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-800">
              No active contact lists yet.{' '}
              {canMake && sending ? 'Upload one with Upload New, or make one from an audience.' : <Link to="/contact-lists" className="font-semibold text-brand-800 hover:underline">See Contact Lists</Link>}
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
                        <span className="cep-num w-20 shrink-0 text-right text-sm font-semibold text-ink-900">{formatNumber(list.member_count)}</span>
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
        <CreateListWizard embedded inCampaign initialSource="UPLOAD" sources={['UPLOAD']} defaultChannel={listChannelOf(campaignChannel)} onAtStart={setAtStart} onDone={setDone} onReview={(list) => { onReview?.(list); onClose() }} onClose={onClose} onCreated={onCreated} />
      )}
      {tab === 'make' && (
        <CreateListWizard embedded inCampaign initialSource="BI" sources={['BI', 'CLONE']} defaultChannel={listChannelOf(campaignChannel)} onAtStart={setAtStart} onDone={setDone} onReview={(list) => { onReview?.(list); onClose() }} onClose={onClose} onCreated={onCreated} />
      )}
    </Modal>
  )
}
