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
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignAudience, CampaignChecklist, CampaignRun } from '@/lib/types'

import { AudiencePicture } from '../AudiencePicture'
import { Definition, Panel } from '../parts'
import { channelLabel, sendTypeLabel, typeLabel, whenText } from '../vocabulary'

function Section({ title, step, onEdit, children }: { title: string; step: number; onEdit: (step: number) => void; children: ReactNode }) {
  return (
    <Panel title={title} actions={<button type="button" aria-label={`Edit ${title}`} className="text-sm font-medium text-brand-800 hover:underline" onClick={() => onEdit(step)}>Edit</button>}>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </Panel>
  )
}

export function StepReview({ campaign, onEdit }: { campaign: Campaign; onEdit: (step: number) => void }) {
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
    ? [['Revenue', targets.target_revenue && `$${targets.target_revenue}`], ['Conversions', targets.target_conversions], ['Opens', targets.target_opens], ['Clicks', targets.target_clicks],
       ['Redemptions', targets.target_redemptions], ['Planned cost', targets.planned_cost && `$${targets.planned_cost}`], ['Planned offer cost', targets.planned_offer_cost && `$${targets.planned_offer_cost}`]]
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
          <Definition label="Message purpose">{campaign.solicitation_type.charAt(0) + campaign.solicitation_type.slice(1).toLowerCase()}</Definition>
          <Definition label="Owner">{campaign.owner_name ?? 'No owner'}</Definition>
          <Definition label="Tags">{campaign.tags.length ? <span className="flex flex-wrap gap-1">{campaign.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</span> : 'None'}</Definition>
        </Section>
        {!isReceipt && (
          <Section title="Audience" step={1} onEdit={onEdit}>
            <Definition label="Send to">{included.length ? included.map((item) => `${item.name} (${formatNumber(item.member_count)})`).join(', ') : 'No list attached'}</Definition>
            <Definition label="Exclude">{excluded.length ? excluded.map((item) => item.name).join(', ') : 'Nobody'}</Definition>
            <Definition label="Estimated recipients">{audience.data ? formatNumber(audience.data.estimated_recipients) : included.length ? 'Counting' : '—'}</Definition>
          </Section>
        )}
        <Section title="Template" step={2} onEdit={onEdit}>
          <Definition label="Template">{campaign.template_name ?? 'Not chosen yet'}</Definition>
          <Definition label="Sender">{campaign.sender_profile_name ?? 'Not chosen yet'}</Definition>
        </Section>
        <Section title="Scheduling & Delivery" step={3} onEdit={onEdit}>
          <Definition label="Send type">{isReceipt ? 'Triggered by a purchase' : sendTypeLabel(campaign.send_type)}</Definition>
          <Definition label="When">{when}</Definition>
          <Definition label="Frequency limits">{campaign.respect_governance ? 'Applied' : 'Switched off for this campaign'}</Definition>
          <Definition label="Messages per hour">{campaign.rate_limit_per_hour ? `At most ${formatNumber(campaign.rate_limit_per_hour)}` : 'No limit of its own'}</Definition>
        </Section>
        <Section title="Targets & Economics" step={4} onEdit={onEdit}>
          {targetLines.length ? targetLines.map(([label, value]) => <Definition key={label} label={label}>{typeof value === 'number' ? formatNumber(value) : value}</Definition>) : <Definition label="Targets">None set</Definition>}
        </Section>
      </div>

      <div className="space-y-5 self-start">
        <Panel title="Before you publish">
          {checklist.isPending ? (
            <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Checking</p>
          ) : checklist.isError ? (
            <ErrorState title="The checklist could not be loaded" error={checklist.error} onRetry={() => void checklist.refetch()} />
          ) : (
            <ul className="space-y-3" aria-label="Pre-publish checklist">
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

        {audience.data && <Panel title="Audience estimate"><AudiencePicture audience={audience.data} /></Panel>}

        {publish.isError && <ErrorState title="The campaign was not published" error={publish.error} />}
        {can('campaign.publish') ? (
          <div>
            <button type="button" className={`${buttonPrimary} w-full`} disabled={!ready || publish.isPending} onClick={() => setConfirming(true)}>Publish to production</button>
            {!ready && checklist.data && <p className="mt-2 text-xs text-ink-500">Finish the items marked above first.</p>}
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
              <button type="button" className={buttonSecondary} onClick={() => setConfirming(false)}>Not yet</button>
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
