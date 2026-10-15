/**
 * Test & Publish, the right column: the backend's checklist (every drip item blocks), the audience estimate, today's
 * Approval card, and Publish to Production with its confirmation. Publish runs the checklist's own checks, so the two
 * can't disagree; a refusal names the message.
 */
import { Lock } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { ErrorState, Spinner } from '@/components/States'
import { problemText } from '@/apps/cep/features/contact-lists/problem'
import { ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignChecklist, DripReview, DripStep } from '@/lib/types'

import { useCampaignAudience } from '../audienceNumbers'
import { AudiencePicture } from '../AudiencePicture'
import { ChecklistItems } from '../ChecklistItems'
import { messageTitle, whenInZone, type Series } from '../dripSequence'
import { DetailCard } from '../parts'
import type { DripPublishController as Controller } from './useDripPublish'
import { setupHref } from '../setupFlow'
import { ApprovalCard } from '../wizard/ApprovalCard'

const NO_PERMISSION = 'Publishing needs the campaign.publish permission. The draft is saved; someone who has it can publish from here.'

/** what a refusal said: a 400 names each message on its own line */
function refusalLines(error: unknown): string[] {
  if (error instanceof ApiError && error.status === 400) {
    const lines = Object.values(error.fieldErrors).flatMap((text) => text.split('\n')).filter(Boolean)
    if (lines.length) return lines
  }
  return [problemText(error)]
}

export function PublishAction({ campaign, checklist, controller }: { campaign: Campaign; checklist: CampaignChecklist | undefined; controller: Controller }) {
  const { can } = useAuth()
  const { publish, open } = controller
  if (!can('campaign.publish')) {
    return <Notice tone="info" layout="box" icon={Lock}><p>{NO_PERMISSION}</p></Notice>
  }
  const ready = checklist?.ready ?? false
  const waitingForApproval = campaign.approval_required && campaign.approval?.status !== 'APPROVED'
  return (
    <div className="flex flex-col gap-2" data-publish-action>
      <Button variant="primary" className="w-full" disabled={!ready || publish.isPending} onClick={() => void open()}>Publish to Production</Button>
      {!ready && checklist && (
        <p className="text-center text-helper text-ink-800">{waitingForApproval ? 'It can be published once it is approved and the items marked above are done.' : 'Finish the items marked above first.'}</p>
      )}
      {publish.isError && (
        <Notice tone="error" layout="box" action={<Button size="sm" variant="secondary" onClick={() => void open()}>Try Again</Button>}>
          <p className="font-semibold">The campaign was not published.</p>
          {refusalLines(publish.error).map((line) => <p key={line}>{line}</p>)}
        </Notice>
      )}
    </div>
  )
}

export function PublishConfirm({ campaign, steps, review, series, controller }: { campaign: Campaign; steps: DripStep[]; review: DripReview | undefined; series: Series; controller: Controller }) {
  const { publish, confirming, setConfirming } = controller
  if (!confirming) return null
  const first = whenInZone(review?.summary.first_send_at, series.zone)
  const last = whenInZone(review?.summary.last_send_at, series.zone)
  const people = review?.summary.estimated_recipients
  const close = () => { if (!publish.isPending) setConfirming(false) }
  return (
    <Modal title="Publish to production?" onClose={close}
      footer={
        <>
          <Button variant="secondary" disabled={publish.isPending} onClick={close}>Not Yet</Button>
          <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>
        </>
      }>
      <div className="flex flex-col gap-3 text-sm text-ink-800">
        <p><strong className="text-ink-900">{campaign.name}</strong> sends {steps.length} {steps.length === 1 ? 'message' : 'messages'} to about <strong className="text-ink-900">{people === undefined ? '—' : formatNumber(people)}</strong> people.</p>
        {first && <p className="cep-num">First: {first.long}, {first.time} {series.zoneShort}.{steps.length > 1 && last ? ` Last: ${last.long}, ${last.time} ${series.zoneShort}.` : ''}</p>}
        <ol aria-label="Messages" className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line-subtle">
          {steps.map((step) => {
            const when = whenInZone(review?.messages.find((row) => row.id === step.id)?.scheduled_for, series.zone)
            return (
              <li key={step.id} className="cep-num flex justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-ink-900">{step.position}. {messageTitle(step)}</span>
                <span className="shrink-0">Day {step.day}{when ? ` · ${when.day}` : ''}</span>
              </li>
            )
          })}
        </ol>
        <p>After publishing, the audience and messages can no longer be changed. You can pause the drip or stop the remaining messages from the campaign page.</p>
      </div>
    </Modal>
  )
}

export function ChecklistCard({ campaign, checklist, error, onRetry }: { campaign: Campaign; checklist: CampaignChecklist | undefined; error: unknown; onRetry: () => void }) {
  const done = checklist?.items.filter((item) => item.ok).length ?? 0
  return (
    <DetailCard title="Before You Publish" actions={checklist && <span className="cep-num text-helper text-ink-800" data-checklist-count>{done} of {checklist.items.length} done</span>}>
      {error ? <ErrorState title="The checklist could not be loaded" error={error} onRetry={onRetry} />
        : !checklist ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner className="h-4 w-4" /> Checking</p>
        : (
          <ChecklistItems items={checklist.items.map((item) => ({ ...item, advisory: false }))}
            after={(item) => item.key === 'start_date' && (
              <Link to={setupHref(campaign.id, { step: 'sequence' })} className="mt-1 inline-block text-helper font-semibold text-link hover:underline">Change Start Date</Link>
            )} />
        )}
    </DetailCard>
  )
}

export function AudienceCard({ campaign }: { campaign: Campaign }) {
  const audience = useCampaignAudience(campaign)
  if (!audience.data) return null
  return <DetailCard title="Audience Estimate"><AudiencePicture audience={audience.data} /></DetailCard>
}

export function ApprovalSlot({ campaign }: { campaign: Campaign }) {
  return campaign.approval_required ? <ApprovalCard campaign={campaign} /> : null
}
