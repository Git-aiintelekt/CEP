/**
 * A published drip's confirmations: Resume (what the API's resume plan will do: missed messages at the next send time,
 * later ones moved only to keep a day between them), Stop Remaining Messages, and Retry Message.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/Button'
import { buttonDanger } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import type { Campaign, CampaignRun, DripStep, ResumePlan } from '@/lib/types'

import { whenInZone, zoneShort } from '../dripSequence'
import { dripStepsKey } from '../dripSteps'
import { numbers, remainingOf } from './dripDetail'

const DAY = 86_400_000

export function ResumeDialog({ campaign, zone, onClose, onDone }: { campaign: Campaign; zone: string; onClose: () => void; onDone: (message: string) => void }) {
  const queryClient = useQueryClient()
  const plan = useQuery({
    queryKey: ['campaigns', 'resume-plan', campaign.id],
    queryFn: ({ signal }) => api.get<ResumePlan>(`/campaigns/${campaign.id}/resume-plan/`, undefined, signal),
    staleTime: 0,
  })
  const resume = useMutation({
    mutationFn: () => api.post<Campaign>(`/campaigns/${campaign.id}/resume/`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      onDone(`“${campaign.name}” is running again.`)
    },
  })
  const short = zoneShort(zone)
  const at = (iso: string | null) => {
    const when = whenInZone(iso, zone)
    return when ? { day: when.day, time: `${when.time} ${short}` } : null
  }
  const data = plan.data
  const nothingMissed = data && data.missed.length === 0 && data.moved.length === 0
  // a late message that lands within two days of the next one: said once, as the design does
  const timeline = data ? [...data.missed.map((item) => ({ position: item.position, at: item.will_send })), ...data.moved.map((item) => ({ position: item.position, at: item.will_send })),
    ...data.unchanged.flatMap((item) => (item.sends ? [{ position: item.position, at: item.sends }] : []))].sort((a, b) => a.at.localeCompare(b.at)) : []
  const late = new Set(data ? [...data.missed, ...data.moved].map((item) => item.position) : [])
  const close = timeline.flatMap((item, index) => {
    const next = timeline[index + 1]
    if (!next || !late.has(item.position)) return []
    const days = Math.round((new Date(next.at).getTime() - new Date(item.at).getTime()) / DAY)
    return days < 2 ? [`Messages ${item.position} and ${next.position} will be ${days === 1 ? '1 day' : `${days} days`} apart.`] : []
  })

  return (
    <Modal title="Resume the drip?" onClose={() => { if (!resume.isPending) onClose() }}
      footer={
        <>
          <Button variant="secondary" disabled={resume.isPending} onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={resume.isPending} disabled={!data} onClick={() => resume.mutate()}>Resume</Button>
        </>
      }>
      {plan.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Working out the new times</p>
        : plan.isError ? <p role="alert" className="text-sm text-danger-text">{problemText(plan.error)}</p>
        : !data || nothingMissed ? <p className="text-sm text-ink-800" data-resume-plan="none">The remaining messages send on their days.</p>
        : (
          <div className="flex flex-col gap-4 text-sm text-ink-800" data-resume-plan>
            {data.missed.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="font-semibold text-ink-900">Missed While Paused</h3>
                <ul className="flex flex-col gap-1" aria-label="Missed">
                  {data.missed.map((item) => {
                    const was = at(item.was_due)
                    const sends = at(item.will_send)
                    return <li key={item.position} className="cep-num">Message {item.position} · {item.name || 'Untitled Message'} · was due {was?.day} · sends {sends?.day}, {sends?.time}</li>
                  })}
                </ul>
              </section>
            )}
            {data.moved.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="font-semibold text-ink-900">Moved</h3>
                <ul className="flex flex-col gap-1" aria-label="Moved">
                  {data.moved.map((item) => {
                    const sends = at(item.will_send)
                    return <li key={item.position} className="cep-num">Message {item.position} · {item.name || 'Untitled Message'} moves to {sends?.day}, {sends?.time} to keep a day between messages</li>
                  })}
                </ul>
              </section>
            )}
            {data.unchanged.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="font-semibold text-ink-900">Unchanged</h3>
                <ul className="flex flex-col gap-1" aria-label="Unchanged">
                  {data.unchanged.map((item) => {
                    const sends = at(item.sends)
                    return <li key={item.position} className="cep-num">Message {item.position} · {sends ? `${sends.day}, ${sends.time}` : 'on its day'}</li>
                  })}
                </ul>
              </section>
            )}
            {close.map((line) => <p key={line} className="text-warning-text">{line}</p>)}
          </div>
        )}
      {resume.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-text">{problemText(resume.error)}</p>}
    </Modal>
  )
}

export function StopDialog({ campaign, steps, onClose, onDone }: { campaign: Campaign; steps: DripStep[]; onClose: () => void; onDone: (message: string) => void }) {
  const queryClient = useQueryClient()
  const remaining = remainingOf(steps).map((step) => step.position)
  const stop = useMutation({
    mutationFn: () => api.post<Campaign>(`/campaigns/${campaign.id}/stop/`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      onDone(`The remaining messages of “${campaign.name}” are cancelled. Messages already sent stay in reports.`)
    },
  })
  const count = remaining.length
  const paused = campaign.status === 'PAUSED'
  return (
    <Modal title={count === 1 ? 'Stop the remaining message?' : `Stop the remaining ${count} messages?`} onClose={() => { if (!stop.isPending) onClose() }}
      footer={
        <>
          <Button variant="secondary" disabled={stop.isPending} onClick={onClose}>{paused ? 'Keep Paused' : 'Keep Running'}</Button>
          <button type="button" className={buttonDanger} disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending && <Spinner size="sm" />}Stop Remaining Messages
          </button>
        </>
      }>
      <p className="text-sm text-ink-800">
        {count === 0 ? 'Nothing is waiting to send.' : `${count === 1 ? 'Message' : 'Messages'} ${numbers(remaining)} will be cancelled and won't send.`} Messages already sent stay in reports. This can't be undone. To send again, clone the campaign.
      </p>
      {stop.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-text">{problemText(stop.error)}</p>}
    </Modal>
  )
}

export function RetryDialog({ campaign, step, onClose, onDone }: { campaign: Campaign; step: DripStep; onClose: () => void; onDone: (message: string) => void }) {
  const queryClient = useQueryClient()
  const retry = useMutation({
    mutationFn: () => api.post<CampaignRun>(`/campaigns/${campaign.id}/steps/${step.id}/retry/`),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['campaigns'] }), queryClient.invalidateQueries({ queryKey: dripStepsKey(campaign.id) })])
      onDone(`Message ${step.position} is being sent again.`)
    },
  })
  return (
    <Modal title={`Retry message ${step.position}?`} onClose={() => { if (!retry.isPending) onClose() }}
      footer={
        <>
          <Button variant="secondary" disabled={retry.isPending} onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>Retry Message</Button>
        </>
      }>
      <p className="text-sm text-ink-800">Send message {step.position} again now? It goes to the people on message 1's list who are still eligible.</p>
      {retry.isError && <p role="alert" className="mt-3 text-sm font-medium text-danger-text">{problemText(retry.error)}</p>}
    </Modal>
  )
}
