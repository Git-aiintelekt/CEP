/**
 * Step 2: which contact lists the campaign sends to, and which ones keep their people out. The estimate on the
 * right is asked from the API for the lists as they are picked here, saved or not: merged, counted once per
 * person, exclusions removed, then today's governance check. The real Campaign List is frozen when a send starts.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonSecondary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { CreateListWizard } from '@/features/contact-lists/CreateListWizard'
import { api } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { CampaignAudience, ContactList, Page } from '@/lib/types'

import { AudiencePicture } from '../AudiencePicture'
import { Panel } from '../parts'
import type { CampaignFormValues } from '../schema'

type Role = 'INCLUDE' | 'EXCLUDE' | 'NONE'

function RolePicker({ list, role, onChange }: { list: ContactList; role: Role; onChange: (role: Role) => void }) {
  const option = (value: Role, label: string) => (
    <button type="button" role="radio" aria-checked={role === value} aria-label={`${label}: ${list.name}`} onClick={() => onChange(role === value ? 'NONE' : value)}
      className={`h-8 px-2.5 text-xs font-semibold transition-colors ${role === value ? (value === 'EXCLUDE' ? 'bg-warning-bg text-warning-text' : 'bg-callout-bg text-brand-800') : 'bg-surface text-ink-700 hover:bg-surface-subtle'}`}>
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label={`Use of ${list.name}`} className="inline-flex divide-x divide-line overflow-hidden rounded-sm border border-line">
      {option('INCLUDE', 'Send to')}
      {option('EXCLUDE', 'Exclude')}
    </div>
  )
}

export function StepAudience({ onChangeType }: { onChangeType: () => void }) {
  const { can } = useAuth()
  const { watch, setValue, formState: { errors } } = useFormContext<CampaignFormValues>()
  const included = watch('contact_lists')
  const excluded = watch('excluded_lists')
  const channel = watch('channel')
  const purpose = watch('solicitation_type')
  const isReceipt = watch('campaign_type') === 'E_RECEIPT'

  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [environment, setEnvironment] = useState('')
  const [wizard, setWizard] = useState(false)
  /** a list made here from an upload: file data is not checked upstream, so it waits for the operator to attach it */
  const [uploaded, setUploaded] = useState<ContactList | null>(null)
  const [notice, setNotice] = useState('')

  const lists = useQuery({
    queryKey: ['contact-lists', 'options'],
    queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { status: 'ACTIVE', page_size: 200 }, signal),
  })
  const estimate = useQuery({
    queryKey: ['campaigns', 'audience-estimate', [...included].sort().join(','), [...excluded].sort().join(','), channel, purpose],
    queryFn: ({ signal }) =>
      api.get<CampaignAudience>('/campaigns/audience-estimate/', { include: included.join(','), exclude: excluded.join(','), channel: channel === 'MMS' ? 'SMS' : channel === 'MULTI' ? 'EMAIL' : channel, solicitation_type: purpose }, signal),
    enabled: included.length > 0,
    placeholderData: keepPreviousData,
  })

  if (isReceipt) {
    return (
      <Panel title="This is an E-Receipt campaign, so there is no contact list to attach">
        <p className="max-w-3xl text-sm text-ink-700">
          An e-receipt goes to the customer of each purchase: the point of sale or the web shop asks for every receipt, one at a time. Contact lists are for campaigns
          that are sent to an audience. To attach existing lists or upload a new one, the campaign type has to be Regular Marketing, Drip or Other.
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonSecondary} onClick={onChangeType}>Change the campaign type</button>
          <span className="text-sm text-ink-500">Keeping E-Receipt: continue to the next step.</span>
        </p>
      </Panel>
    )
  }

  function setRole(list: ContactList, role: Role) {
    const touch = { shouldDirty: true, shouldValidate: true }
    setValue('contact_lists', role === 'INCLUDE' ? [...included.filter((item) => item !== list.id), list.id] : included.filter((item) => item !== list.id), touch)
    setValue('excluded_lists', role === 'EXCLUDE' ? [...excluded.filter((item) => item !== list.id), list.id] : excluded.filter((item) => item !== list.id), touch)
  }
  const roleOf = (list: ContactList): Role => (included.includes(list.id) ? 'INCLUDE' : excluded.includes(list.id) ? 'EXCLUDE' : 'NONE')

  const all = lists.data?.results ?? []
  const needle = search.trim().toLowerCase()
  const shown = all.filter((item) => item.name.toLowerCase().includes(needle) && (source === '' || (source === 'BI' ? ['BI', 'EXTRACTION', 'SEGMENT'].includes(item.source_type) : item.source_type === source))
    && (environment === '' || item.list_environment === environment))
  const testPicked = all.filter((item) => included.includes(item.id) && item.list_environment === 'TEST')
  const control = 'h-10 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink-900'

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel
        title="Contact lists"
        description="The same list can serve any number of campaigns. Overlapping lists never cause duplicate messages: each person is counted once."
        actions={can('list.edit') && <button type="button" className={buttonSecondary} onClick={() => setWizard(true)}>Create a list</button>}
      >
        {notice && <p role="status" className="mb-3 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>}
        {uploaded && !included.includes(uploaded.id) && (
          <div role="group" aria-label="Uploaded list waiting to be attached" className="mb-3 rounded-lg border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
            <p><strong>{uploaded.name}</strong> ({formatNumber(uploaded.member_count)} contacts) came from an uploaded file. File data is not checked upstream, so it is not attached until you confirm.</p>
            <p className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={buttonSecondary} onClick={() => { setRole(uploaded, 'INCLUDE'); setNotice(`“${uploaded.name}” is attached.`); setUploaded(null) }}>I have checked it: attach to this campaign</button>
              <a className={buttonSecondary} href={`/contact-lists/${uploaded.id}`} target="_blank" rel="noreferrer">Open the list</a>
              <button type="button" className={buttonSecondary} onClick={() => setUploaded(null)}>Not now</button>
            </p>
          </div>
        )}
        {(errors.contact_lists?.message || errors.excluded_lists?.message) && <p role="alert" className="mb-3 text-xs font-medium text-danger-text">{errors.contact_lists?.message ?? errors.excluded_lists?.message}</p>}

        {lists.isPending ? (
          <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading contact lists</p>
        ) : lists.isError ? (
          <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
        ) : all.length === 0 ? (
          <p className="text-sm text-ink-500">No active contact lists yet. {can('list.edit') ? 'Use “Create a list” above.' : <Link to="/contact-lists" className="font-medium text-brand-800 underline">See contact lists</Link>}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lists" aria-label="Search contact lists" className={`${control} w-full sm:w-64`} />
              <select aria-label="Source" value={source} onChange={(event) => setSource(event.target.value)} className={control}>
                <option value="">All sources</option><option value="UPLOAD">Upload</option><option value="BI">BI / Extraction</option><option value="CLONE">Clone</option>
              </select>
              <select aria-label="Test or Production" value={environment} onChange={(event) => setEnvironment(event.target.value)} className={control}>
                <option value="">Test / Production</option><option value="PRODUCTION">Production</option><option value="TEST">Test</option>
              </select>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-lg border border-line">
              <table className="min-w-full divide-y divide-line text-sm">
                <caption className="sr-only">Contact lists to send to or to exclude</caption>
                <thead className="sticky top-0 bg-surface-subtle">
                  <tr>
                    {['List name', 'Source', 'Contacts', 'Updated', 'Use'].map((header, index) => (
                      <th key={header} scope="col" className={`h-10 px-3 text-xs font-semibold text-ink-700 ${index === 2 ? 'text-right' : 'text-left'}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((item) => {
                    const role = roleOf(item)
                    return (
                      <tr key={item.id} className={role === 'INCLUDE' ? 'bg-callout-bg' : role === 'EXCLUDE' ? 'bg-row-flagged' : ''}>
                        <td className="max-w-xs px-3 py-2">
                          <p className="truncate font-medium text-ink-900">{item.name}</p>
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                            {item.list_environment === 'TEST' && <Tag>Test: not for production sends</Tag>}
                            {(item.live_campaigns ?? 0) > 0 && <span>on {item.live_campaigns} live campaign{item.live_campaigns === 1 ? '' : 's'}</span>}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-ink-700">{item.source_label ?? item.list_kind}</td>
                        <td className="cep-num px-3 py-2 text-right text-ink-700">{formatNumber(item.member_count)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink-700">{formatDate(item.updated_at)}</td>
                        <td className="px-3 py-2"><RolePicker list={item} role={role} onChange={(next) => setRole(item, next)} /></td>
                      </tr>
                    )
                  })}
                  {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-sm text-ink-500">No list matches these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-ink-500" aria-live="polite">
              {included.length === 0 ? 'No list attached yet. A draft can be saved without one; publishing needs at least one.' : `${included.length} list${included.length === 1 ? '' : 's'} to send to`}
              {excluded.length > 0 && `, ${excluded.length} excluded`}
            </p>
            {testPicked.length > 0 && (
              <p className="mt-2 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
                Marked as Test: {testPicked.map((item) => item.name).join(', ')}. Fine for a test publish; a production publish is refused until the list is changed to Production or detached.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Audience estimate" className="self-start">
        {included.length === 0 ? (
          <p className="text-sm text-ink-500">Choose “Send to” on at least one list to see how many people the campaign would reach.</p>
        ) : estimate.isError ? (
          <ErrorState title="The estimate could not be worked out" error={estimate.error} onRetry={() => void estimate.refetch()} />
        ) : !estimate.data ? (
          <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Counting</p>
        ) : (
          <div className={estimate.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}><AudiencePicture audience={estimate.data} /></div>
        )}
      </Panel>

      {wizard && (
        <CreateListWizard
          inCampaign
          onClose={() => setWizard(false)}
          onCreated={(created) => {
            void lists.refetch()
            if (created.vetted) {
              // an audience or a clone is already vetted: it joins this campaign without asking
              setRole(created, 'INCLUDE')
              setNotice(`“${created.name}” is attached: it comes from ${created.source_type === 'CLONE' ? 'a list you already had' : 'a vetted audience'}.`)
            } else {
              setUploaded(created)
              setNotice('')
            }
          }}
        />
      )}
    </div>
  )
}
