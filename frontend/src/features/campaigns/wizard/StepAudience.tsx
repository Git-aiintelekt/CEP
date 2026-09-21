/**
 * Step 2: tick the contact lists the campaign is sent to; optionally tick lists whose people are kept out. A new list
 * is made with the contact list wizard itself (the same CSV upload as in Contact Lists), never a second copy of it. The estimate on the
 * right is asked from the API for the lists as they are picked here, saved or not: merged, counted once per
 * person, exclusions removed, then today's governance check. The real Campaign List is frozen when a send starts.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
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
import type { CampaignAudience, ContactList, ListSource, Page } from '@/lib/types'

import { AudiencePicture } from '../AudiencePicture'
import { Panel } from '../parts'
import type { CampaignFormValues } from '../schema'

type Role = 'INCLUDE' | 'EXCLUDE' | 'NONE'

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
  /** the contact list wizard, opened on the way of making a list that was asked for */
  const [wizard, setWizard] = useState<ListSource | null>(null)
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
  function pickMany(items: ContactList[], picked: boolean) {
    const ids = items.map((item) => item.id)
    setValue('contact_lists', picked ? [...new Set([...included, ...ids])] : included.filter((item) => !ids.includes(item)), { shouldDirty: true, shouldValidate: true })
  }
  const roleOf = (list: ContactList): Role => (included.includes(list.id) ? 'INCLUDE' : excluded.includes(list.id) ? 'EXCLUDE' : 'NONE')

  const all = lists.data?.results ?? []
  const needle = search.trim().toLowerCase()
  const shown = all.filter((item) => item.name.toLowerCase().includes(needle) && (source === '' || (source === 'BI' ? ['BI', 'EXTRACTION', 'SEGMENT'].includes(item.source_type) : item.source_type === source))
    && (environment === '' || item.list_environment === environment))
  const pickable = shown.filter((item) => !excluded.includes(item.id))
  const allShownPicked = pickable.length > 0 && pickable.every((item) => included.includes(item.id))
  const excludable = all.filter((item) => !included.includes(item.id))
  const testPicked = all.filter((item) => included.includes(item.id) && item.list_environment === 'TEST')
  const control = 'h-10 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink-900'

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel
        title="Contact lists"
        description="Tick every list this campaign goes to. The same list can serve any number of campaigns, and overlapping lists never cause duplicate messages: each person is counted once."
        actions={can('list.edit') && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonSecondary} onClick={() => setWizard('UPLOAD')}><Upload size={16} strokeWidth={1.5} aria-hidden /> Upload a CSV file</button>
            <button type="button" className={buttonSecondary} onClick={() => setWizard('BI')}>From an audience or a clone</button>
          </div>
        )}
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
          <p className="text-sm text-ink-500">No active contact lists yet. {can('list.edit') ? 'Upload a CSV file, or make one from an audience, with the buttons above.' : <Link to="/contact-lists" className="font-medium text-brand-800 underline">See contact lists</Link>}</p>
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
            <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-line">
              <table className="w-full table-fixed divide-y divide-line text-sm">
                <caption className="sr-only">Contact lists this campaign is sent to</caption>
                <thead className="sticky top-0 z-10 bg-surface-subtle">
                  <tr>
                    <th scope="col" className="w-10 px-3">
                      <input type="checkbox" aria-label="Select every list shown" className="h-4 w-4 accent-brand-600" checked={allShownPicked} disabled={pickable.length === 0}
                        onChange={(event) => pickMany(pickable, event.target.checked)} />
                    </th>
                    <th scope="col" className="h-10 px-3 text-left text-xs font-semibold text-ink-700">List name</th>
                    <th scope="col" className="hidden h-10 w-32 px-3 text-left text-xs font-semibold text-ink-700 sm:table-cell">Source</th>
                    <th scope="col" className="h-10 w-24 px-3 text-right text-xs font-semibold text-ink-700">Contacts</th>
                    <th scope="col" className="hidden h-10 w-32 px-3 text-left text-xs font-semibold text-ink-700 md:table-cell">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((item) => {
                    const role = roleOf(item)
                    const boxId = `send-to-${item.id}`
                    return (
                      <tr key={item.id} className={role === 'INCLUDE' ? 'bg-brand-100' : 'hover:bg-surface-subtle'}>
                        <td className="px-3 py-2.5 align-top">
                          <input id={boxId} type="checkbox" aria-label={`Send to ${item.name}`} className="mt-0.5 h-4 w-4 accent-brand-600" checked={role === 'INCLUDE'} disabled={role === 'EXCLUDE'}
                            onChange={(event) => setRole(item, event.target.checked ? 'INCLUDE' : 'NONE')} />
                        </td>
                        <td className="px-3 py-2.5">
                          <label htmlFor={boxId} className={`block truncate font-medium text-ink-900 ${role === 'EXCLUDE' ? '' : 'cursor-pointer'}`}>{item.name}</label>
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                            {role === 'EXCLUDE' && <Tag>Excluded below</Tag>}
                            {item.list_environment === 'TEST' && <Tag>Test: not for production sends</Tag>}
                            {(item.live_campaigns ?? 0) > 0 && <span>on {item.live_campaigns} live campaign{item.live_campaigns === 1 ? '' : 's'}</span>}
                          </p>
                        </td>
                        <td className="hidden px-3 py-2.5 text-ink-700 sm:table-cell">{item.source_label ?? item.list_kind}</td>
                        <td className="cep-num px-3 py-2.5 text-right text-ink-700">{formatNumber(item.member_count)}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-ink-700 md:table-cell">{formatDate(item.updated_at)}</td>
                      </tr>
                    )
                  })}
                  {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-sm text-ink-500">No list matches these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-ink-700" aria-live="polite">
              {included.length === 0 ? 'No list selected yet. A draft can be saved without one; publishing needs at least one.'
                : `${included.length} list${included.length === 1 ? '' : 's'} selected, ${formatNumber(all.filter((item) => included.includes(item.id)).reduce((sum, item) => sum + item.member_count, 0))} contacts before duplicates and governance`}
            </p>

            <details className="mt-4 rounded-lg border border-line bg-surface-subtle px-4 py-3" open={excluded.length > 0}>
              <summary className="cursor-pointer text-sm font-medium text-ink-900">
                Keep people out of this campaign (optional){excluded.length > 0 && `: ${excluded.length} list${excluded.length === 1 ? '' : 's'} excluded`}
              </summary>
              <p className="mt-2 text-sm text-ink-500">Everyone in a list ticked here is left out, even when they are also in a list the campaign is sent to. Use it for a do-not-contact list, or for people who already bought.</p>
              {excludable.length === 0 ? <p className="mt-2 text-sm text-ink-500">Every list is selected above, so there is none left to exclude.</p> : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Lists to exclude">
                  {excludable.map((item) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-900">
                        <input type="checkbox" aria-label={`Exclude ${item.name}`} className="mt-0.5 h-4 w-4 accent-brand-600" checked={excluded.includes(item.id)}
                          onChange={(event) => setRole(item, event.target.checked ? 'EXCLUDE' : 'NONE')} />
                        <span className="min-w-0"><span className="block truncate">{item.name}</span><span className="cep-num text-xs text-ink-500">{formatNumber(item.member_count)} contacts</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </details>
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
          <p className="text-sm text-ink-500">Tick at least one list to see how many people the campaign would reach.</p>
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
          initialSource={wizard}
          onClose={() => setWizard(null)}
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
