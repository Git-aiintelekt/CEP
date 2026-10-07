/**
 * Test & Publish, Send a Test: every message to the testers now, one after another (POST test-publish/), or one message
 * again (POST steps/{step}/test/). A row per message shows its test from the step (`test.status`). The send runs inside
 * the request, so the rows show Sending while it is in flight; the page polls the messages meanwhile, and reads the
 * messages, the checklist and the campaign again when it ends (a test changes the steps' row_version).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/Button'
import { Notice } from '@/components/Notice'
import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import type { Campaign, CampaignFormOptions, DripStep } from '@/lib/types'

import { messageTitle, whenInZone, type Series } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { DetailCard } from '../parts'
import { TestRecipientFields } from '../TestPublishBox'
import { useTestRecipients, type DripTestAnswer } from '../testRecipients'

interface TestCardProps {
  campaign: Campaign
  steps: DripStep[]
  series: Series
  /** the review's subjects (or the start of each text), by message id */
  subjects: Record<string, string | null>
  people: CampaignFormOptions['owners']
  defaultTo: string
  /** a test request is in flight: the page polls the messages meanwhile */
  onTesting: (testing: boolean) => void
  /** every message's latest test went out: the setup counts as complete */
  onAllTested: () => void
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'SENDING') return <Spinner size="sm" />
  if (status === 'SENT') return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white"><Check size={12} strokeWidth={2} /></span>
  if (status === 'CHANGED') return <span className="flex h-5 w-5 items-center justify-center rounded-full border border-warning bg-warning-bg text-warning-text"><Pencil size={11} strokeWidth={2} /></span>
  if (status === 'FAILED') return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white"><X size={12} strokeWidth={2} /></span>
  return <span className="h-[18px] w-[18px] rounded-full border-[1.5px] border-ink-300" />
}

export function TestCard({ campaign, steps, series, subjects, people, defaultTo, onTesting, onAllTested }: TestCardProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const recipients = useTestRecipients(campaign, defaultTo)
  const [inFlight, setInFlight] = useState<string[]>([])
  const total = steps.length
  const email = campaign.channel === 'EMAIL'
  const hasAb = email && steps.some((step) => step.ab_config?.enabled)

  async function afterTest() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['campaigns', 'checklist', campaign.id] }),
      queryClient.invalidateQueries({ queryKey: ['campaigns', 'detail', campaign.id] }),
      queryClient.invalidateQueries({ queryKey: ['campaigns', 'steps-review', campaign.id] }),
    ])
    const fresh = await queryClient.fetchQuery({ ...dripStepsQuery(campaign.id), staleTime: 0 })
    if (fresh.length > 0 && fresh.every((step) => step.test?.status === 'SENT')) onAllTested()
  }
  const test = useMutation({
    mutationFn: (stepId: string | null) => api.post<DripTestAnswer>(stepId ? `/campaigns/${campaign.id}/steps/${stepId}/test/` : `/campaigns/${campaign.id}/test-publish/`, recipients.body()),
    onMutate: (stepId) => { setInFlight(stepId ? [stepId] : steps.map((step) => step.id)); onTesting(true) },
    onSuccess: (answer, stepId) => {
      const failed = answer.messages.filter((message) => message.status !== 'SENT' || message.results.some((result) => !result.ok))
      const sent = answer.messages.length - failed.length
      if (failed.length === 0) toast.success(stepId ? `Test of message ${answer.messages[0]?.position} sent.` : `Tests of all ${total} messages sent.`)
      else toast.error(stepId ? `The test of message ${answer.messages[0]?.position} failed.` : `${sent} of ${answer.messages.length} tests sent.`, 'Resend the ones that failed from the list.')
    },
    onSettled: async () => {
      await afterTest()
      setInFlight([])
      onTesting(false)
    },
  })

  const blocked = !campaign.sender_profile ? 'Choose a sender on the Sequence step first.' : ''
  const ready = !test.isPending && !blocked && recipients.chosen && total > 0

  return (
    <DetailCard title="Send a Test"
      description={`All ${total} messages go out now, one after another, without waiting for their days. Each subject starts with its place in the series.${hasAb ? ' The A/B message sends both subjects.' : ''}`}>
      <div role="group" aria-label="Send a Test">
        <TestRecipientFields recipients={recipients} people={people} onEnter={() => { if (ready) test.mutate(null) }}
          action={<Button variant="secondary" disabled={!ready} loading={test.isPending && inFlight.length > 1} onClick={() => test.mutate(null)}>Send All {total} as a Test</Button>} />
        {blocked && <p className="text-helper text-ink-800">{blocked}</p>}
        {test.isError && <div className="mt-3"><Notice tone="error" layout="box"><p className="font-semibold">The test was not sent</p><p>{problemText(test.error)}</p></Notice></div>}
      </div>
      <ul aria-label="Message Tests" className="-mx-6 -mb-6 mt-5 border-t border-line-subtle">
        {steps.map((step) => {
          const status = inFlight.includes(step.id) ? 'SENDING' : step.test?.status ?? 'NOT_SENT'
          const subject = subjects[step.id] ?? step.subject_line ?? ''
          const label = email ? `[Test ${step.position} of ${total} · would send Day ${step.day}] ${subject}` : `[Test ${step.position}/${total} · Day ${step.day}] ${subject}`
          const sentAt = whenInZone(step.test?.sent_at, series.zone)
          const resend = (
            <button type="button" disabled={!ready} onClick={() => test.mutate(step.id)} className="font-semibold text-brand-600 hover:underline disabled:text-ink-300 disabled:no-underline">Resend</button>
          )
          return (
            <li key={step.id} data-test-row={step.position} data-status={status}
              className={`grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-b border-line-subtle px-6 py-3 last:border-b-0 sm:grid-cols-[24px_minmax(0,1fr)_auto] ${status === 'FAILED' ? 'bg-danger-bg/40' : ''}`}>
              <span className="mt-px flex h-5 w-5 items-center justify-center"><StatusIcon status={status} /></span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink-900">Message {step.position} of {total} · {messageTitle(step)}</span>
                <span className="truncate text-helper text-ink-800">{label}</span>
                {status === 'FAILED' && <span role="alert" className="text-helper font-medium text-danger-text">Test failed. {step.test?.error ?? ''}</span>}
              </span>
              <span className={`cep-num col-start-2 flex items-center gap-1.5 text-helper font-medium whitespace-nowrap sm:col-start-auto ${status === 'CHANGED' ? 'text-warning-text' : status === 'FAILED' ? 'text-danger-text' : 'text-ink-800'}`}>
                {status === 'NOT_SENT' && 'Not sent'}
                {status === 'SENDING' && 'Sending'}
                {status === 'SENT' && <>Sent {sentAt ? `${sentAt.time} ${series.zoneShort}` : ''} <span aria-hidden>·</span> {resend}</>}
                {status === 'CHANGED' && <>Changed since the test <span aria-hidden>·</span> {resend}</>}
                {status === 'FAILED' && <Button size="sm" variant="secondary" disabled={!ready} onClick={() => test.mutate(step.id)}>Resend</Button>}
              </span>
            </li>
          )
        })}
      </ul>
    </DetailCard>
  )
}
