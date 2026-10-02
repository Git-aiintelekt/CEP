/**
 * Audience: the lists the campaign is sent to (Send To), the lists whose people are left out (Don't Send To), and the
 * audience they make, live as lists change. Lists are added from the Add Contact List pop-up: existing ones, a CSV
 * upload, or one made from an audience or a clone (the Contact lists page's own wizard). An uploaded list waits as
 * Needs review until it is confirmed, because file data isn't checked upstream. The estimate is the API's, for the lists
 * as they are here, saved or not; the real Campaign List is frozen when a send starts.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { SkeletonLine } from '@/components/States'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignAudience, ContactList, Page } from '@/lib/types'

import { AudiencePicture } from '../AudiencePicture'
import { estimateSummary, useAudienceEstimate } from '../audienceNumbers'
import { AudienceSummary } from '../detail/AudienceSummary'
import { CardError, DetailCard, Fact } from '../parts'
import type { CampaignFormValues } from '../schema'
import { AddListDialog } from './audience/AddListDialog'
import { ListsTable, type ListRow } from './audience/ListsTable'

const plural = (count: number, word: string) => `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`

function ReceiptMessage({ onChangeType }: { onChangeType?: () => void }) {
  return (
    <DetailCard title="No Contact Lists for E-Receipts">
      <div className="flex flex-col gap-4">
        <Notice tone="info" layout="banner" title="This is an E-Receipt campaign, so there is no contact list to attach">
          <p>
            An e-receipt goes to the customer of each purchase: the point of sale or the web shop asks for every receipt, one at a time. Contact lists are for campaigns
            that are sent to an audience. To attach existing lists or upload a new one, the campaign type has to be Regular Marketing, Drip or Other.
          </p>
        </Notice>
        <p className="flex flex-wrap items-center gap-3">
          {onChangeType && <Button onClick={onChangeType}>Change the Campaign Type</Button>}
          <span className="text-sm text-ink-800">Keeping E-Receipt: continue to the next step.</span>
        </p>
      </div>
    </DetailCard>
  )
}

function SummaryCard({ included, pending, estimate }: { included: number; pending: number; estimate: ReturnType<typeof useAudienceEstimate> }) {
  const [open, setOpen] = useState(false)
  let body
  if (included === 0) body = <p className="text-sm text-ink-800">{pending > 0 ? 'Confirm the uploaded list to see how many people the campaign would reach.' : 'Add a contact list to see how many people the campaign would reach.'}</p>
  else if (estimate.isError) body = <CardError what="the estimate" error={estimate.error} onRetry={() => void estimate.refetch()} />
  else if (!estimate.data) body = <div aria-busy className="flex flex-col gap-3"><SkeletonLine width="45%" /><SkeletonLine width="100%" /><SkeletonLine width="70%" /></div>
  else {
    const data = estimate.data
    body = (
      <div className={`flex flex-col gap-5 transition-opacity duration-base ${estimate.isFetching ? 'opacity-60' : ''}`} aria-busy={estimate.isFetching || undefined}>
        <AudienceSummary numbers={estimateSummary(data)} />
        {topReason(data) && <p className="cep-num text-helper text-ink-800" data-testid="audience-reason">{topReason(data)}</p>}
        <dl className="grid grid-cols-1 gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3 lg:grid-cols-1">
          <Fact label="In Your Lists">{formatNumber(data.gross)}</Fact>
          <Fact label="Unique People" secondary="After duplicates and excluded lists">{formatNumber(data.after_exclusions)}</Fact>
          <Fact label="Estimated Recipients">{formatNumber(data.estimated_recipients)}</Fact>
        </dl>
        <div className="border-t border-line-subtle pt-4">
          <button type="button" aria-expanded={open} aria-controls="audience-breakdown" onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-control-sm text-sm font-semibold text-ink-900">
            {open ? <ChevronDown size={16} strokeWidth={1.5} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.5} aria-hidden />}
            How the Number Is Worked Out
          </button>
          {open && <div id="audience-breakdown" className="mt-3"><AudiencePicture audience={data} /></div>}
        </div>
      </div>
    )
  }
  return (
    <DetailCard title="Audience">
      {pending > 0 && <p className="mb-4 text-helper text-warning-text">{plural(pending, 'contact')} not counted until you confirm the uploaded list.</p>}
      {body}
    </DetailCard>
  )
}


interface StepAudienceProps {
  campaign?: Campaign
  onChangeType?: () => void
  /** uploads made here that wait for a confirmation (kept by the setup, which asks about them before moving on) */
  pending: ContactList[]
  onPendingChange: (lists: ContactList[]) => void
}

export function StepAudience({ campaign, onChangeType, pending, onPendingChange }: StepAudienceProps) {
  const { can, me } = useAuth()
  const zone = campaign?.send_timezone || me?.tenant.timezone || 'UTC'
  const { watch, setValue, formState: { errors } } = useFormContext<CampaignFormValues>()
  const included = watch('contact_lists')
  const excluded = watch('excluded_lists')
  const channel = watch('channel')
  const purpose = watch('solicitation_type')
  const isReceipt = watch('campaign_type') === 'E_RECEIPT'

  const [adding, setAdding] = useState<'send' | 'leave-out' | null>(null)
  // uploads made here: file data isn't checked upstream, so each waits for a confirmation before it counts
  const setPending = (change: (now: ContactList[]) => ContactList[]) => onPendingChange(change(pending))
  /** lists made here from an audience or a clone: attached at once */
  const [auto, setAuto] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  const lists = useQuery({
    queryKey: ['contact-lists', 'options'],
    queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { status: 'ACTIVE', page_size: 200 }, signal),
  })
  const estimate = useAudienceEstimate(included, excluded, channel, purpose)

  if (isReceipt) return <ReceiptMessage onChangeType={onChangeType} />

  const touch = { shouldDirty: true, shouldValidate: true }
  const all = lists.data?.results ?? []
  const stored = campaign?.contact_list_details ?? []
  function rowOf(id: string, state: ListRow['state']): ListRow | null {
    const list = all.find((item) => item.id === id) ?? pending.find((item) => item.id === id)
    const saved = stored.find((item) => item.id === id)
    if (!list && !saved) return null
    return {
      id, name: list?.name ?? saved!.name, source_type: list?.source_type ?? saved?.list_kind ?? '', list_environment: list?.list_environment ?? saved?.list_environment ?? 'PRODUCTION',
      channel: list?.channel ?? (saved as { channel?: string } | undefined)?.channel,
      approval_status: list?.approval_status ?? (saved as { approval_status?: string } | undefined)?.approval_status,
      member_count: list?.member_count ?? saved?.member_count ?? 0, updated_at: list?.updated_at ?? null, state, attachedAt: saved?.attached_at ?? null,
    }
  }
  const sendRows = [...included.map((id) => rowOf(id, auto.includes(id) ? 'auto' : 'attached')), ...pending.map((list) => rowOf(list.id, 'review'))].filter((row): row is ListRow => Boolean(row))
  const leaveOutRows = excluded.map((id) => rowOf(id, 'attached')).filter((row): row is ListRow => Boolean(row))
  const testPicked = sendRows.filter((row) => row.state !== 'review' && row.list_environment === 'TEST')
  const counted = sendRows.filter((row) => row.state !== 'review')
  const pendingContacts = pending.reduce((sum, list) => sum + list.member_count, 0)
  const nobody = included.length > 0 && estimate.data?.estimated_recipients === 0 && !estimate.isFetching
  const canMake = can('list.edit')
  const listError = errors.contact_lists?.message ?? errors.excluded_lists?.message

  const addButton = <Button size="sm" iconStart={Plus} onClick={() => setAdding('send')}>Add Contact List</Button>

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-first lg:sticky lg:top-6 lg:order-last" data-audience-summary>
          <SummaryCard included={included.length} pending={pending.length ? pendingContacts : 0} estimate={estimate} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <DetailCard title="Send To" actions={addButton} flush={sendRows.length > 0}>
            <div className={sendRows.length > 0 ? 'flex flex-col md:gap-0' : 'flex flex-col gap-4'}>
              {notice && <p role="status" className={`text-sm text-ink-900 ${sendRows.length > 0 ? 'px-0 pb-4 md:px-6 md:pt-4' : ''}`}>{notice}</p>}
              {pending.length > 0 && (
                <div className="pb-4 md:px-6 md:pt-4">
                  <Notice tone="warning" layout="banner"><p>File data isn’t checked upstream, so an uploaded list is only counted once you confirm it.</p></Notice>
                </div>
              )}
              {listError && <p role="alert" className="pb-4 text-helper font-medium text-danger-text md:px-6 md:pt-4">{listError}</p>}
              {lists.isPending && included.length > 0 ? (
                <div aria-busy className="flex flex-col gap-3 p-0 md:p-6"><SkeletonLine width="60%" /><SkeletonLine width="80%" /></div>
              ) : lists.isError ? (
                <div className="md:p-6"><CardError what="the contact lists" error={lists.error} onRetry={() => void lists.refetch()} /></div>
              ) : sendRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface-subtle px-6 py-10 text-center" data-empty="send-to">
                  <p className="text-sm font-semibold text-ink-900">No contact lists yet</p>
                  <p className="text-helper text-ink-800">Add the lists this campaign goes to. A draft can be saved without one; publishing needs at least one.</p>
                  {lists.data && all.length === 0 && !canMake && (
                    <p className="text-helper text-ink-800">This workspace has no active contact lists yet. <Link to="/contact-lists" className="font-semibold text-brand-800 hover:underline">See Contact Lists</Link></p>
                  )}
                  <div className="mt-2">{addButton}</div>
                </div>
              ) : (
                <ListsTable rows={sendRows} caption="Lists this campaign is sent to" zone={zone} campaignChannel={watch('channel')}
                  onRemove={(row) => {
                    if (row.state === 'review') setPending((now) => now.filter((list) => list.id !== row.id))
                    else setValue('contact_lists', included.filter((id) => id !== row.id), touch)
                  }}
                  onConfirm={(row) => {
                    setValue('contact_lists', [...included.filter((id) => id !== row.id), row.id], touch)
                    setPending((now) => now.filter((list) => list.id !== row.id))
                    setNotice(`“${row.name}” is attached.`)
                  }} />
              )}
              {sendRows.length > 0 && (
                <p className="cep-num pt-4 text-helper text-ink-800 md:border-t md:border-line-subtle md:px-6 md:py-4" aria-live="polite">
                  {counted.length === 0 ? 'Nothing is counted yet: confirm the uploaded list first.'
                    : `${plural(counted.length, 'list')} selected, ${formatNumber(counted.reduce((sum, row) => sum + row.member_count, 0))} contacts before duplicates and governance`}
                </p>
              )}
              {testPicked.length > 0 && (
                <div className="pt-4 md:px-6 md:pb-6">
                  <Notice tone="warning" layout="banner">
                    <p>Marked as Test: {testPicked.map((row) => row.name).join(', ')}. Fine for a test publish; a production publish is refused until the list is changed to Production or detached.</p>
                  </Notice>
                </div>
              )}
            </div>
          </DetailCard>

          <DetailCard title="Don’t Send To" description="People in these lists are left out, even if they’re in a list above."
            actions={<Button size="sm" iconStart={Plus} onClick={() => setAdding('leave-out')}>Add List to Leave Out</Button>} flush={leaveOutRows.length > 0}>
            {leaveOutRows.length === 0 ? <p className="text-sm text-ink-800" data-empty="leave-out">Nobody is left out by a list.</p> : (
              <ListsTable rows={leaveOutRows} caption="Lists whose people are left out" zone={zone}
                onRemove={(row) => setValue('excluded_lists', excluded.filter((id) => id !== row.id), touch)} />
            )}
          </DetailCard>
        </div>
      </div>

      {nobody && (
        <Notice tone="warning" layout="banner">
          <p>Nobody in these lists can receive this campaign today. Check the reasons in the audience summary.</p>
        </Notice>
      )}

      {adding && (
        <AddListDialog purpose={adding} lists={all} sendTo={[...included, ...pending.map((list) => list.id)]} leftOut={excluded} canMake={canMake} onClose={() => setAdding(null)}
          onAdd={(ids) => {
            if (adding === 'send') setValue('contact_lists', [...new Set([...included, ...ids])], touch)
            else setValue('excluded_lists', [...new Set([...excluded, ...ids])], touch)
            setNotice('')
          }}
          onCreated={(created) => {
            void lists.refetch()
            if (created.vetted) {
              // an audience or a clone is already vetted: it joins this campaign without asking
              setValue('contact_lists', [...new Set([...included, created.id])], touch)
              setAuto((now) => [...now, created.id])
              setNotice(`“${created.name}” is attached: it comes from ${created.source_type === 'CLONE' ? 'a list you already had' : 'a vetted audience'}.`)
            } else {
              setPending((now) => [...now.filter((list) => list.id !== created.id), created])
              setNotice('')
            }
          }} />
      )}
    </div>
  )
}

/** the biggest reason people are left out, when any are: "1 left out: No consent on record" */
function topReason(audience: CampaignAudience): string | null {
  const worst = audience.statuses.filter((line) => !line.sendable && line.count > 0).sort((a, b) => b.count - a.count)[0]
  return worst ? `${formatNumber(worst.count)} left out: ${worst.label}` : null
}
