/**
 * A drip's last step, Test & Publish: preview each message, send every message to testers in one go, review the whole
 * timeline, check the list, publish. Left: Preview, Send a Test, Review Timeline. Right (sticky): Before You Publish,
 * Audience Estimate, Approval, Publish to Production. Narrow: the column follows, and Publish sits in a footer fixed to
 * the bottom of the step.
 *
 * While a test is in flight (or a message says SENDING) the messages are read every 1.5 seconds, so the rows move on.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { useAuth } from '@/auth/AuthContext'
import { SkeletonLine } from '@/components/States'
import type { Campaign, CampaignFormOptions } from '@/lib/types'

import { seriesOf } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { PreviewCard } from '../dripPublish/PreviewCard'
import { ApprovalSlot, AudienceCard, ChecklistCard, PublishAction, PublishConfirm } from '../dripPublish/PublishColumn'
import { dripChecklistQuery, dripReviewQuery } from '../dripPublish/queries'
import { ReviewTimeline } from '../dripPublish/ReviewTimeline'
import { TestCard } from '../dripPublish/TestCard'
import { useDripPublish } from '../dripPublish/useDripPublish'
import { CardError } from '../parts'

const POLL_MS = 1500

interface StepDripPublishProps {
  campaign: Campaign
  options: CampaignFormOptions | undefined
  workspaceZone: string
  /** every message's test went out: the setup counts as complete */
  onAllTested: () => void
  /** stores what the setup holds before the confirmation opens (false: stay) */
  beforePublish: () => Promise<boolean>
}

export function StepDripPublish({ campaign, options, workspaceZone, onAllTested, beforePublish }: StepDripPublishProps) {
  const { me } = useAuth()
  const [testing, setTesting] = useState(false)
  const steps = useQuery({
    ...dripStepsQuery(campaign.id),
    refetchInterval: (query) => (testing || query.state.data?.some((step) => step.test?.status === 'SENDING') ? POLL_MS : false),
  })
  const review = useQuery(dripReviewQuery(campaign.id))
  const checklist = useQuery(dripChecklistQuery(campaign.id))
  const series = seriesOf(campaign, workspaceZone)
  const controller = useDripPublish(campaign, review.data, series, beforePublish)
  const subjects = Object.fromEntries((review.data?.messages ?? []).map((row) => [row.id, row.subject]))
  const list = steps.data ?? []

  const action = <PublishAction campaign={campaign} checklist={checklist.data} controller={controller} />

  return (
    <div className="max-lg:pb-28" data-drip-publish>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {steps.isPending ? (
            <div aria-busy className="flex flex-col gap-3"><SkeletonLine width="60%" /><SkeletonLine width="100%" /></div>
          ) : steps.isError ? (
            <CardError what="the messages" error={steps.error} onRetry={() => void steps.refetch()} />
          ) : (
            <>
              <PreviewCard campaign={campaign} steps={list} series={series} subjects={subjects} />
              <TestCard campaign={campaign} steps={list} series={series} subjects={subjects} people={options?.owners ?? []} defaultTo={me?.principal.email ?? ''}
                onTesting={setTesting} onAllTested={onAllTested} />
            </>
          )}
          <ReviewTimeline campaignId={campaign.id} review={review.data} steps={list} series={series} error={review.error} onRetry={() => void review.refetch()} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-44 xl:top-36" data-publish-column>
          <ChecklistCard campaign={campaign} checklist={checklist.data} error={checklist.error} onRetry={() => void checklist.refetch()} />
          <AudienceCard campaign={campaign} />
          <ApprovalSlot campaign={campaign} />
          <div className="max-lg:hidden">{action}</div>
        </div>
      </div>

      {/* narrow: Publish stays in reach at the bottom of the window (in body: the step's entrance animation would make a fixed child scroll with it) */}
      {createPortal(<div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 lg:hidden" data-publish-footer>{action}</div>, document.body)}
      <PublishConfirm campaign={campaign} steps={list} review={review.data} series={series} controller={controller} />
    </div>
  )
}

