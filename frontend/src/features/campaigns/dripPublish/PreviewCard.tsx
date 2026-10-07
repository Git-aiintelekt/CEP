/** Test & Publish, Preview: a tab per message, when it goes and its subject, then today's message preview pointed at that message. */
import { useState } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import { Tabs } from '@/components/Tabs'
import { tabPanelId } from '@/components/tabIds'
import type { Campaign, DripStep } from '@/lib/types'

import { messageTitle, sendOf, shortDay, type Series } from '../dripSequence'
import { MessagePreview } from '../MessagePreview'
import { DetailCard } from '../parts'

const PREFIX = 'drip-preview'

export function PreviewCard({ campaign, steps, series, subjects }: { campaign: Campaign; steps: DripStep[]; series: Series; /** the review's subjects, by message id */ subjects: Record<string, string | null> }) {
  const [chosen, setChosen] = useState(steps[0]?.id ?? '')
  const [variant, setVariant] = useState<'A' | 'B'>('A')
  const step = steps.find((item) => item.id === chosen) ?? steps[0]
  if (!step) return null
  const email = campaign.channel === 'EMAIL'
  const ab = email && step.ab_config?.enabled ? step.ab_config : null
  const { date, time } = sendOf(step, series)
  const subject = variant === 'B' && ab ? ab.subject_b ?? '' : subjects[step.id] ?? step.subject_line ?? ''
  const pick = (id: string) => { setChosen(id); setVariant('A') }

  return (
    <DetailCard title="Preview">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="-mx-6 -mt-6 overflow-x-auto border-b border-line-subtle px-6" data-message-tabs>
          <Tabs label="Messages" idPrefix={PREFIX} value={step.id} onChange={pick}
            tabs={steps.map((item) => ({ id: item.id, label: `${item.position} · ${messageTitle(item)}` }))} />
        </div>
        <div id={tabPanelId(PREFIX, step.id)} role="tabpanel" aria-labelledby={`${PREFIX}-tab-${step.id}`} className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="cep-num text-helper text-ink-800" data-preview-meta>
              Day {step.day} · {date ? `${shortDay(date)}, ` : ''}{time} {series.zoneShort}
              {email && <> · Subject: <span className="font-medium text-ink-900">{subject || 'No subject yet'}</span></>}
            </p>
            {ab && (
              <span className="flex items-center gap-2">
                <span className="inline-flex h-[22px] items-center rounded-sm bg-plum-100 px-1.5 text-xs font-semibold text-plum-800">A/B Subject Test</span>
                <SegmentedControl label="Subject to Preview" value={variant} onChange={setVariant}
                  options={[{ value: 'A', label: 'Subject A' }, { value: 'B', label: 'Subject B' }]} />
              </span>
            )}
          </div>
          <MessagePreview key={step.id} campaignId={campaign.id} stepId={step.id} subject={ab && variant === 'B' ? ab.subject_b : undefined} hideSubject withCustomers enlarge />
        </div>
      </div>
    </DetailCard>
  )
}
