/**
 * The Content tab for a drip: what every message shares (sender, topic), the messages down the left, and the chosen one
 * on the right with today's preview tools pointed at that message (?step=), its template, subject and preheader.
 */
import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { SkeletonLine } from '@/components/States'
import { api } from '@/lib/api'
import type { Campaign, SenderProfile } from '@/lib/types'

import { messageTitle, seriesOf, sendOf, shortDay } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { MessagePreview } from '../MessagePreview'
import { CardError, DetailCard } from '../parts'
import { sequenceHref } from '../sequence/dripEditor'
import { useMessageText } from '../sequence/messageContent'

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-helper text-ink-800">{label}</dt>
      <dd className="text-sm break-words text-ink-900">{children}</dd>
    </div>
  )
}

export function DripContent({ campaign, zone, editable }: { campaign: Campaign; zone: string; editable: boolean }) {
  const steps = useQuery(dripStepsQuery(campaign.id))
  const senders = useQuery({ queryKey: ['sender-profiles', 'options'], queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal) })
  const [chosen, setChosen] = useState<string | null>(null)
  const series = seriesOf(campaign, zone)
  const texts = campaign.channel === 'SMS' || campaign.channel === 'MMS'
  const list = steps.data ?? []
  const step = list.find((item) => item.id === chosen) ?? list[0]
  const text = useMessageText(step ?? list[0] ?? ({ template: null } as never), Boolean(step) && texts)
  const sender = (senders.data ?? []).find((item) => item.id === campaign.sender_profile)
  const senderText = sender ? `${sender.display_name} ${sender.from_address ?? sender.sender_id ?? ''}`.trim() : campaign.sender_profile_name ?? 'Not chosen'
  const published = !['DRAFT', 'TEST_PUBLISHED'].includes(campaign.status)

  if (steps.isPending) return <DetailCard title="Messages"><div aria-busy className="flex flex-col gap-3"><SkeletonLine width="50%" /><SkeletonLine width="100%" /></div></DetailCard>
  if (steps.isError) return <DetailCard title="Messages"><CardError what="the messages" error={steps.error} onRetry={() => void steps.refetch()} /></DetailCard>

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-800" data-drip-shared>
        <span className="font-semibold text-ink-900">Sender</span> {senderText}
        {campaign.topic && <> · <span className="font-semibold text-ink-900">Topic</span> {campaign.topic_name ?? 'Chosen'}</>}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Messages" className="rounded-lg border border-line bg-surface">
          <ol className="flex flex-col divide-y divide-line-subtle">
            {list.map((item) => {
              const { date } = sendOf(item, series)
              const active = item.id === step?.id
              return (
                <li key={item.id}>
                  <button type="button" aria-current={active || undefined} onClick={() => setChosen(item.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors duration-fast ease-standard ${active ? 'bg-brand-100' : 'hover:bg-surface-subtle'}`}>
                    <span className={`text-sm font-semibold ${active ? 'text-brand-800' : 'text-ink-900'}`}>{item.position}. {messageTitle(item)}</span>
                    <span className="cep-num text-helper text-ink-800">Day {item.day}{date ? ` · ${shortDay(date)}` : ''}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        {step && (
          <DetailCard title={`Message ${step.position} · ${messageTitle(step)}`}
            actions={editable && !published && <Link to={sequenceHref(campaign.id, step.id)} className="text-helper font-semibold text-brand-800 hover:underline">Edit in Sequence</Link>}>
            <div className="flex flex-col gap-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <Line label="Template">{step.template?.name ?? 'Not chosen yet'}</Line>
                {texts ? <Line label="Text">{text.text || 'No message text yet'}</Line> : (
                  <>
                    <Line label="Subject">{step.subject_line || 'Uses the template’s subject line'}</Line>
                    <Line label="Preheader">{step.preheader || 'None'}</Line>
                  </>
                )}
              </dl>
              {step.template ? <MessagePreview key={step.id} campaignId={campaign.id} stepId={step.id} withCustomers enlarge />
                : <p className="text-sm text-ink-800">This message has no template yet.</p>}
              {published && (
                <p className="flex items-center gap-2 text-helper text-ink-800">
                  <Lock size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-300" />
                  Messages are locked after publishing. To change one, stop the remaining messages and clone the campaign.
                </p>
              )}
            </div>
          </DetailCard>
        )}
      </div>
    </div>
  )
}
