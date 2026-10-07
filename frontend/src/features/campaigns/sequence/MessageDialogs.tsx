/** The Sequence step's two pop-ups: Add Message (copy the last, start from the gallery, or blank) and Remove Message. */
import { Copy, File, LayoutTemplate } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/Button'
import { buttonDanger } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SetupDialog } from '@/components/SetupDialog'
import { problemText } from '@/features/contact-lists/problem'
import type { DripStep } from '@/lib/types'

import { dayWithDate, messageTitle, nextDay, type Series } from '../dripSequence'
import { ChoiceCard, ChoiceGroup } from '../parts'
import { TemplatePicker, type GalleryPick } from './TemplatePicker'
import { useStepAdd, useStepCopyAsNext, useStepRemove } from './useSequence'

type Start = 'copy' | 'gallery' | 'blank'

/** a new message is made only on Add Message, or (from the gallery) once a template is picked; its drawer opens after */
export function AddMessageDialog({ campaignId, channel, steps, series, onClose, onAdded }: {
  campaignId: string
  channel: string
  steps: DripStep[]
  series: Series
  onClose: () => void
  onAdded: (step: DripStep) => void
}) {
  const last = steps[steps.length - 1] ?? null
  const [start, setStart] = useState<Start>(last ? 'copy' : 'gallery')
  const [picking, setPicking] = useState(false)
  const add = useStepAdd(campaignId)
  const copy = useStepCopyAsNext(campaignId)
  const busy = add.isPending || copy.isPending
  const error = add.error ?? copy.error

  async function confirm() {
    if (start === 'gallery') return setPicking(true)
    try {
      onAdded(start === 'copy' && last ? await copy.mutateAsync(last.id) : await add.mutateAsync({ start_from: 'blank' }))
    } catch {
      // shown in the pop-up's banner
    }
  }

  async function fromGallery(pick: GalleryPick) {
    const created = await add.mutateAsync(pick.template ? { start_from: 'template', template: pick.template, ...(pick.fromPreset ? { consume_source: true } : {}) }
      : { start_from: 'template', starter: pick.starter })
    setPicking(false)
    onAdded(created)
  }

  return (
    <>
      <SetupDialog title={`Add Message ${steps.length + 1}`} onClose={onClose} locked={busy}
        primary={{ label: 'Add Message', onClick: () => void confirm(), busy, busyLabel: 'Adding' }}
        error={error ? { title: 'The message was not added', message: problemText(error) } : null}>
        <p className="cep-num text-sm text-ink-900">It goes on {dayWithDate(nextDay(steps), series)}. You can change the day after.</p>
        <ChoiceGroup label="Start From" columns="md:grid-cols-3" strong>
          {last && (
            <ChoiceCard tile selected={start === 'copy'} onSelect={() => setStart('copy')} icon={<Copy strokeWidth={1.5} />} badge="Recommended"
              title={`Copy of Message ${last.position}`} text="Same header, footer and branding. Change only the middle content." />
          )}
          <ChoiceCard tile selected={start === 'gallery'} onSelect={() => setStart('gallery')} icon={<LayoutTemplate strokeWidth={1.5} />}
            title="Choose from Template Gallery" text="Start from a saved or preset template. A copy is attached to this message." />
          <ChoiceCard tile selected={start === 'blank'} onSelect={() => setStart('blank')} icon={<File strokeWidth={1.5} />}
            title="Blank" text="Start from an empty template." />
        </ChoiceGroup>
      </SetupDialog>
      {picking && <TemplatePicker channel={channel} campaignId={campaignId} takesStarter onClose={() => setPicking(false)} onPick={fromGallery} />}
    </>
  )
}

export function RemoveMessageDialog({ campaignId, step, onClose, onRemoved }: { campaignId: string; step: DripStep; onClose: () => void; onRemoved: () => void }) {
  const remove = useStepRemove(campaignId)
  return (
    <Modal title={`Remove “${messageTitle(step)}”?`} onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <button type="button" className={buttonDanger} disabled={remove.isPending}
            onClick={() => remove.mutate(step.id, { onSuccess: onRemoved })}>Remove Message</button>
        </>
      }>
      <p className="text-sm text-pretty text-ink-900">The message and its template copy are removed from this drip. The other messages keep their days.</p>
      {remove.error && <p role="alert" className="mt-3 text-helper font-medium text-danger-text">{problemText(remove.error)}</p>}
    </Modal>
  )
}
