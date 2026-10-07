/**
 * A drip's Sequence step: the messages and their timetable, built here. Left, the timeline (start marker, gap pills,
 * message cards, Add Message); right, sticky under the bars, Series at a Glance and Sender & Topic. A card opens its
 * message in the drawer; the open message is in the address (?message=), so the template editor can come back to it.
 *
 * Continue stays enabled. While a message still needs something (or there is no start date) the page's Continue
 * shows the problem banner instead of moving on: `attempt` counts those presses.
 */
import { useQuery } from '@tanstack/react-query'
import { Lightbulb } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { buttonClass } from '@/components/buttonStyles'
import { Notice } from '@/components/Notice'
import { SkeletonLine } from '@/components/States'
import { useToast } from '@/components/Toast'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignFormOptions, DripStep } from '@/lib/types'

import { useAudienceEstimate } from '../audienceNumbers'
import { bannerText, gapBefore, longDay, MAX_MESSAGES, sequenceProblems, seriesOf } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { CardError } from '../parts'
import { AddMessageDialog, RemoveMessageDialog } from '../sequence/MessageDialogs'
import { MessageDrawer } from '../sequence/MessageDrawer'
import { SenderTopicCard, SeriesCard } from '../sequence/SeriesPanel'
import { AddMessageButton, GapPill, MessageCard, StartMarker } from '../sequence/Timeline'
import { dripEditorHref } from '../sequence/dripEditor'

const TIPS_KEY = 'cep.drip.planningTips'
const TIPS = [
  'Build message 1 first, then add the next one as a copy so the header, footer and branding stay the same.',
  'Give each message one job: welcome, explain, offer or remind. If two say the same thing, merge them.',
  'Leave 2–3 days between marketing messages. Frequency limits skip people who have had too many.',
]

function readTipsShown(): boolean {
  try {
    return window.localStorage.getItem(TIPS_KEY) !== 'hidden'
  } catch {
    return true
  }
}

function PlanningTips() {
  const [shown, setShown] = useState(readTipsShown)
  const toggle = () => {
    const next = !shown
    setShown(next)
    try {
      window.localStorage.setItem(TIPS_KEY, next ? 'shown' : 'hidden')
    } catch {
      // the choice just isn't remembered
    }
  }
  return (
    <div className="flex items-start gap-3 rounded-lg bg-callout-bg px-3.5 py-3" data-planning-tips>
      <Lightbulb size={20} strokeWidth={1.5} aria-hidden className="shrink-0 text-callout-icon" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-callout-text">Planning Tips</span>
          <button type="button" onClick={toggle} aria-expanded={shown} aria-controls="planning-tips" className="text-helper font-semibold text-callout-text hover:underline">{shown ? 'Hide' : 'Show'}</button>
        </div>
        {shown && (
          <ul id="planning-tips" className="flex list-disc flex-col gap-1 pl-[18px] text-helper text-pretty text-callout-text">
            {TIPS.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

interface StepSequenceProps {
  campaign: Campaign
  options: CampaignFormOptions | undefined
  workspaceZone: string
  /** Continue was pressed while something still blocks it; each press counts */
  attempt: number
  /** "A Regular Marketing campaign may suit it better": opens Edit Details */
  onEditDetails: () => void
}

export function StepSequence({ campaign, options, workspaceZone, attempt, onEditDetails }: StepSequenceProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const query = useQuery(dripStepsQuery(campaign.id))
  const series = seriesOf(campaign, workspaceZone)
  const estimate = useAudienceEstimate(campaign.contact_lists, campaign.excluded_lists, campaign.channel, campaign.solicitation_type)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<DripStep | null>(null)
  const cards = useRef(new Map<string, HTMLButtonElement | null>())
  const banner = useRef<HTMLDivElement>(null)

  const steps = query.data ?? []
  const email = campaign.channel === 'EMAIL'
  const openId = params.get('message')
  const open = steps.find((step) => step.id === openId) ?? null
  const problems = sequenceProblems(steps, series)
  const flagging = attempt > 0 && problems.any

  const setOpen = (id: string | null) => setParams((now) => {
    if (id) now.set('message', id)
    else now.delete('message')
    now.delete('saved')
    return now
  }, { replace: true })

  // back from the template editor with a save: say so once
  const savedFlag = params.get('saved')
  useEffect(() => {
    if (!savedFlag || !open) return
    toast.success(`Message ${open.position} saved.`)
    setParams((now) => { now.delete('saved'); return now }, { replace: true })
  }, [savedFlag, open?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Continue with problems: the banner comes into view (and with it the first flagged card)
  useEffect(() => {
    if (attempt === 0 || !problems.any) return
    banner.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  function showFirstProblem() {
    const first = problems.messages[0]
    if (first) {
      const card = cards.current.get(first.id)
      card?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      card?.focus({ preventScroll: true })
      return
    }
    document.querySelector<HTMLElement>('[data-series-start] button')?.focus()
  }

  const people = estimate.data?.estimated_recipients
  const startText = series.start
    ? `${longDay(new Date(`${series.start}T12:00:00Z`))}${people !== undefined ? ` · ${formatNumber(people)} contacts start together` : ''}`
    : 'Choose a start date'

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="order-first flex min-w-0 flex-col gap-4 lg:sticky lg:top-44 lg:order-last xl:top-36" data-series-column>
        <div data-series-start>
          <SeriesCard campaign={campaign} steps={steps} series={series} options={options?.timezones ?? []} />
        </div>
        <SenderTopicCard campaign={campaign} />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        {flagging && (
          <div ref={banner} className="scroll-mt-48">
            <Notice tone="error" layout="banner" action={<button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={showFirstProblem}>Show First Problem</button>}>
              <p className="font-semibold">{bannerText(problems)}</p>
            </Notice>
          </div>
        )}
        <PlanningTips />

        {query.isPending ? (
          <div aria-busy className="flex flex-col gap-3"><SkeletonLine width="60%" /><SkeletonLine width="100%" /><SkeletonLine width="80%" /></div>
        ) : query.isError ? (
          <CardError what="the messages" error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <ol aria-label="Messages" className="relative flex flex-col gap-3">
              <span aria-hidden className="absolute top-3 bottom-3 left-3 w-px bg-ink-300" />
              <li><StartMarker text={startText} /></li>
              {steps.map((step, index) => (
                <li key={step.id} className="relative flex flex-col gap-3">
                  <GapPill gap={gapBefore(steps, index)} />
                  <div className="pl-8">
                    <MessageCard ref={(node) => { cards.current.set(step.id, node) }} step={step} steps={steps} series={series} email={email}
                      open={open?.id === step.id} flagged={flagging && step.problems.length > 0} onOpen={() => setOpen(step.id)} />
                  </div>
                </li>
              ))}
            </ol>
            <AddMessageButton full={steps.length >= MAX_MESSAGES} onAdd={() => setAdding(true)} />
            {steps.length === 1 && (
              <p className="pl-8 text-helper text-ink-800" data-one-message>
                A drip with one message is a scheduled send. A Regular Marketing campaign may suit it better.{' '}
                <button type="button" onClick={onEditDetails} className="font-semibold text-brand-800 hover:underline">Edit Details</button>
              </p>
            )}
          </>
        )}
      </div>

      {open && (
        <MessageDrawer key={open.id} campaign={campaign} step={open} steps={steps} series={series}
          onClose={() => setOpen(null)} onOpenStep={setOpen} onRemove={setRemoving}
          onEditTemplate={(step) => navigate(dripEditorHref(campaign.id, step))} />
      )}
      {adding && (
        <AddMessageDialog campaignId={campaign.id} channel={campaign.channel} steps={steps} series={series} onClose={() => setAdding(false)}
          onAdded={(step) => { setAdding(false); setOpen(step.id) }} />
      )}
      {removing && (
        <RemoveMessageDialog campaignId={campaign.id} step={removing} onClose={() => setRemoving(null)}
          onRemoved={() => { setRemoving(null); setOpen(null) }} />
      )}
    </div>
  )
}
