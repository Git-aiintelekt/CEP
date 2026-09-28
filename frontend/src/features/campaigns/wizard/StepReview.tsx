/**
 * Step 7: everything that was chosen, the pre-publish checklist from the API, and the production publish.
 * The checklist is the API's own publish validation run without publishing, so what it says is what publishing will say.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { api } from '@/lib/api'
import { formatMoney, formatNumber } from '@/lib/format'
import type { Campaign, CampaignAudience, CampaignChecklist, CampaignRun } from '@/lib/types'

import { AudiencePicture } from '../AudiencePicture'
import { APPROVAL_CARD_ID, ApprovalCard } from './ApprovalCard'
import { Definition, Panel } from '../parts'
import type { FlowStep } from '../setupFlow'
import { testSummary } from '../subjectTest'
import { channelLabel, sendTypeLabel, typeLabel, whenText } from '../vocabulary'

function Section({ title, step, onEdit, children }: { title: string; step: number; onEdit: (step: number) => void; children: ReactNode }) {
  return (
    <Panel title={title} actions={<button type="button" aria-label={`Edit ${title}`} className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => onEdit(step)}>Edit</button>}>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </Panel>
  )
}

/**
 * The card at the top of Review & Publish: anything still unfinished, each with the way to it, or one line saying all is in place.
 * The checklist is the API's (the same the publish uses); no test and no targets are advice, not blockers.
 */
export function PublishSummary({ campaign, onEdit, onGo }: { campaign: Campaign; onEdit: (step: number) => void; onGo: (step: FlowStep) => void }) {
  const checklist = useQuery({
    queryKey: ['campaigns', 'checklist', campaign.id, campaign.row_version],
    queryFn: ({ signal }) => api.get<CampaignChecklist>(`/campaigns/${campaign.id}/checklist/`, undefined, signal),
  })
  if (!checklist.data) return null
  const isReceipt = campaign.campaign_type === 'E_RECEIPT'
  const items: { key: string; text: string; blocking: boolean; go: () => void }[] = []
  const place: Record<string, number | FlowStep> = { template: 2, sender_profile: 2, contact_lists: 1, scheduled_at: 3, recurring_config: 3, drip_config: 3 }
  for (const item of checklist.data.items) {
    if (item.ok) continue
    if (item.key === 'test') { items.push({ key: item.key, text: 'No test has been sent. Send yourself one to see the message as a recipient will.', blocking: false, go: () => onGo('test') }); continue }
    // the approval is asked for and given on this page, in the Approval card below
    if (item.key === 'approval') { items.push({ key: item.key, text: item.problem ?? item.label, blocking: true, go: () => document.getElementById(APPROVAL_CARD_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }); continue }
    const target = place[item.key] ?? 3
    items.push({ key: item.key, text: item.problem ?? item.label, blocking: true, go: () => (typeof target === 'number' ? onEdit(target) : onGo(target)) })
  }
  const hasTargets = Boolean(campaign.targets && Object.entries(campaign.targets).some(([key, value]) => key !== 'notes' && value !== null && value !== undefined && value !== ''))
  if (!isReceipt && !hasTargets) items.push({ key: 'targets', text: 'No targets set. Results are shown against them once the campaign runs.', blocking: false, go: () => onEdit(4) })
  const blocking = items.filter((item) => item.blocking).length
  if (items.length === 0) {
    return (
      <div role="status" data-publish-summary="ready" className="flex items-start gap-2.5 rounded-lg border border-success bg-success-bg px-4 py-3 text-sm text-success-text">
        <CircleCheck size={18} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
        <span>Everything is in place. Choose when it goes out, then publish.</span>
      </div>
    )
  }
  return (
    <section aria-labelledby="publish-summary-title" data-publish-summary={blocking ? 'blocked' : 'advice'}
      className={`rounded-lg border px-4 py-3 text-sm ${blocking ? 'border-warning bg-warning-bg text-warning-text' : 'border-line bg-surface-subtle text-ink-700'}`}>
      <p id="publish-summary-title" className="font-semibold">
        {blocking ? `${blocking} thing${blocking === 1 ? '' : 's'} to finish before publishing` : `${items.length === 1 ? 'One thing' : `${items.length} things`} you may still want to do`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-baseline gap-x-2">
            {item.blocking ? <CircleAlert size={14} strokeWidth={1.5} className="relative top-0.5 shrink-0" aria-hidden /> : <CircleDashed size={14} strokeWidth={1.5} className="relative top-0.5 shrink-0" aria-hidden />}
            <span>{item.text}</span>
            <button type="button" className="font-semibold underline underline-offset-2" onClick={item.go}>{item.key === 'test' ? 'Send a Test' : item.key === 'targets' ? 'Set Targets' : item.key === 'approval' ? 'Go to Approval' : 'Fix It'}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** `onEdit` gets the old step index of the section (0 Basic Info … 4 Targets); `beforePublish` stores unsaved changes first (false: stay) */
export function StepReview({ campaign, onEdit, beforePublish }: { campaign: Campaign; onEdit: (step: number) => void; beforePublish?: () => Promise<boolean> }) {
  const { can, me } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const zone = campaign.send_timezone || me?.tenant.timezone || 'UTC'
  const isReceipt = campaign.campaign_type === 'E_RECEIPT'

  const checklist = useQuery({
    queryKey: ['campaigns', 'checklist', campaign.id, campaign.row_version],
    queryFn: ({ signal }) => api.get<CampaignChecklist>(`/campaigns/${campaign.id}/checklist/`, undefined, signal),
  })
  const audience = useQuery({
    queryKey: ['campaigns', 'audience', campaign.id, campaign.row_version],
    queryFn: ({ signal }) => api.get<CampaignAudience>(`/campaigns/${campaign.id}/audience/`, undefined, signal),
    enabled: !isReceipt && campaign.contact_lists.length > 0,
  })
  const publish = useMutation({
    mutationFn: () => api.post<CampaignRun>(`/campaigns/${campaign.id}/publish/`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      navigate(`/campaigns/${campaign.id}`)
    },
    onSettled: () => setConfirming(false),
  })

  const included = campaign.contact_list_details.filter((item) => item.role !== 'EXCLUDE')
  const excluded = campaign.contact_list_details.filter((item) => item.role === 'EXCLUDE')
  const targets = campaign.targets
  const targetLines = targets
    ? [['Revenue', targets.target_revenue && formatMoney(targets.target_revenue)], ['Conversions', targets.target_conversions], ['Opens', targets.target_opens], ['Clicks', targets.target_clicks],
       ['Redemptions', targets.target_redemptions], ['Planned Cost', targets.planned_cost && formatMoney(targets.planned_cost)], ['Planned Offer Cost', targets.planned_offer_cost && formatMoney(targets.planned_offer_cost)]]
        .filter(([, value]) => value !== null && value !== undefined && value !== '') as [string, string | number][]
    : []
  const ready = checklist.data?.ready ?? false
  const when = whenText(campaign, zone)

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Section title="Basic Info" step={0} onEdit={onEdit}>
          <Definition label="Name">{campaign.name}</Definition>
          <Definition label="Type">{typeLabel(campaign.campaign_type)}</Definition>
          <Definition label="Channel"><Tag>{channelLabel(campaign.channel)}</Tag></Definition>
          <Definition label="Message Purpose">{campaign.solicitation_type.charAt(0) + campaign.solicitation_type.slice(1).toLowerCase()}</Definition>
          <Definition label="Owner">{campaign.owner_name ?? 'No owner'}</Definition>
          <Definition label="Tags">{campaign.tags.length ? <span className="flex flex-wrap gap-1">{campaign.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</span> : 'None'}</Definition>
        </Section>
        {!isReceipt && (
          <Section title="Audience" step={1} onEdit={onEdit}>
            <Definition label="Send To">{included.length ? included.map((item) => `${item.name} (${formatNumber(item.member_count)})`).join(', ') : 'No list attached'}</Definition>
            <Definition label="Exclude">{excluded.length ? excluded.map((item) => item.name).join(', ') : 'Nobody'}</Definition>
            <Definition label="Estimated Recipients">{audience.data ? formatNumber(audience.data.estimated_recipients) : included.length ? 'Counting' : '—'}</Definition>
          </Section>
        )}
        <Section title="Template" step={2} onEdit={onEdit}>
          <Definition label="Template">{campaign.template_name ?? 'Not chosen yet'}</Definition>
          <Definition label="Sender">{campaign.sender_profile_name ?? 'Not chosen yet'}</Definition>
          {campaign.channel === 'EMAIL' && !isReceipt && <Definition label="Subject Line">{testSummary(campaign.ab_config)}</Definition>}
        </Section>
        <Section title="Scheduling & Delivery" step={3} onEdit={onEdit}>
          <Definition label="Send Type">{isReceipt ? 'Triggered by a purchase' : sendTypeLabel(campaign.send_type)}</Definition>
          <Definition label="When">{when}</Definition>
          {!isReceipt && <Definition label="Local Time">{campaign.timezone_optimization ? "Each recipient's own time zone" : 'One time for everyone'}</Definition>}
          <Definition label="Frequency Limits">{campaign.respect_governance ? 'Applied' : 'Switched off for this campaign'}</Definition>
          <Definition label="Messages per Hour">{campaign.rate_limit_per_hour ? `At most ${formatNumber(campaign.rate_limit_per_hour)}` : 'No limit of its own'}</Definition>
        </Section>
        <Section title="Targets & Economics" step={4} onEdit={onEdit}>
          {targetLines.length ? targetLines.map(([label, value]) => <Definition key={label} label={label}>{typeof value === 'number' ? formatNumber(value) : value}</Definition>) : <Definition label="Targets">None set</Definition>}
        </Section>
      </div>

      <div className="space-y-5 self-start">
        <Panel title="Before You Publish">
          {checklist.isPending ? (
            <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Checking</p>
          ) : checklist.isError ? (
            <ErrorState title="The checklist could not be loaded" error={checklist.error} onRetry={() => void checklist.refetch()} />
          ) : (
            <ul className="space-y-3" aria-label="Pre-Publish Checklist">
              {checklist.data.items.map((item) => (
                <li key={item.key} className="flex items-start gap-2.5 text-sm">
                  {item.ok ? <CircleCheck size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-success-text" aria-hidden />
                    : item.advisory ? <CircleDashed size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
                    : <CircleAlert size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-danger-text" aria-hidden />}
                  <span>
                    <span className="font-medium text-ink-900">{item.label}</span>
                    <span className="sr-only">{item.ok ? ': done' : item.advisory ? ': recommended' : ': to do'}</span>
                    {!item.ok && item.problem && <span className={`block ${item.advisory ? 'text-ink-500' : 'text-danger-text'}`}>{item.problem}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {audience.data && <Panel title="Audience Estimate"><AudiencePicture audience={audience.data} /></Panel>}

        {campaign.approval_required && <ApprovalCard campaign={campaign} />}

        {publish.isError && <ErrorState title="The campaign was not published" error={publish.error} />}
        {can('campaign.publish') ? (
          <div>
            <button type="button" className={`${buttonPrimary} w-full`} disabled={!ready || publish.isPending} onClick={() => void (async () => { if (!beforePublish || await beforePublish()) setConfirming(true) })()}>Publish to Production</button>
            {!ready && checklist.data && <p className="mt-2 text-xs text-ink-500">{campaign.approval_required && campaign.approval?.status !== 'APPROVED' ? 'It can be published once it is approved and the items marked above are done.' : 'Finish the items marked above first.'}</p>}
          </div>
        ) : (
          <p className="text-sm text-ink-500">Publishing needs the campaign.publish permission. The draft is saved; someone who has it can publish from here.</p>
        )}
      </div>

      {confirming && (
        <Modal
          title="Publish to production?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => setConfirming(false)}>Not Yet</button>
              <button type="button" className={buttonPrimary} disabled={publish.isPending} onClick={() => publish.mutate()}>
                {publish.isPending && <Spinner className="h-4 w-4 border-brand-800 border-t-white" />}Publish
              </button>
            </>
          }
        >
          <div className="space-y-2 text-sm text-ink-700">
            <p><strong className="text-ink-900">{campaign.name}</strong> {isReceipt ? 'starts answering receipt requests.' : <>goes to about <strong className="text-ink-900">{audience.data ? formatNumber(audience.data.estimated_recipients) : 'the attached'}</strong> people.</>}</p>
            <p>When: {when}.</p>
            <p>After publishing the campaign can no longer be edited. It can be paused, and a scheduled send can be cancelled.</p>
            {!checklist.data?.test_sent && <p className="rounded-sm border border-warning bg-warning-bg px-3 py-2 text-warning-text">No test has been sent for this campaign.</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
