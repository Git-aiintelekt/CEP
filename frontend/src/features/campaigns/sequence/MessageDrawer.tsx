/**
 * One message of a drip, in the drawer from the right: its name, day and time, its template copy, and for email its
 * subject line, preheader and A/B subject test; for SMS and MMS its text and picture, composed here. Each field saves
 * when it is left (useStepPatch, with row_version); Done only closes. A text message's words save to its template copy.
 */
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { Drawer } from '@/components/Drawer'
import { Field, TextInput } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { SaveTick } from '@/components/SaveTick'
import { SelectMenu } from '@/components/SelectMenu'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { HALF_HOURS } from '@/lib/dateValue'
import type { AbConfig, Campaign, DripStep, SenderProfile } from '@/lib/types'

import { MAX_DAY, messageTitle, sameSubjectAs, sendOf, sendSentence, shortDay, type Series } from '../dripSequence'
import { channelLabel } from '../vocabulary'
import { TemplatePicker, type GalleryPick } from './TemplatePicker'
import { TextComposer, TextView } from './TextMessage'
import { useTemplateMessage } from './textContent'
import { Thumbnail } from './Timeline'
import { CHANGED_ELSEWHERE, isConflict, useStepCopyAsNext, useStepPatch, useTextSave, type StepPatch } from './useSequence'

const SAMPLE = [10, 20, 30].map((value) => ({ value: String(value), label: `${value}% of the List` }))
const WINNER = [{ value: 'OPEN_RATE', label: 'Open Rate' }, { value: 'CLICK_RATE', label: 'Click Rate' }]
const DECIDE_AFTER_MINUTES = 240

interface Draft { name: string; day: string; subject: string; preheader: string; subjectB: string; sample: string; metric: string }

const draftOf = (step: DripStep): Draft => ({
  name: step.name, day: String(step.day), subject: step.subject_line ?? '', preheader: step.preheader ?? '',
  subjectB: step.ab_config?.subject_b ?? '', sample: String(step.ab_config?.sample_pct ?? 20), metric: step.ab_config?.metric ?? 'OPEN_RATE',
})

/** the API's message for one field of the last save, when that save carried the field */
function fieldError(patch: ReturnType<typeof useStepPatch>, field: keyof StepPatch): string | null {
  if (!(patch.error instanceof ApiError) || patch.error.status !== 400 || !patch.variables || !(field in patch.variables)) return null
  return patch.error.fieldErrors[field] ?? null
}

interface MessageDrawerProps {
  campaign: Campaign
  step: DripStep
  steps: DripStep[]
  series: Series
  onClose: () => void
  /** a copy was made: its drawer opens instead */
  onOpenStep: (stepId: string) => void
  onRemove: (step: DripStep) => void
  onEditTemplate: (step: DripStep) => void
}

export function MessageDrawer({ campaign, step, steps, series, onClose, onOpenStep, onRemove, onEditTemplate }: MessageDrawerProps) {
  const toast = useToast()
  const email = campaign.channel === 'EMAIL'
  const mms = campaign.channel === 'MMS'
  const patch = useStepPatch(campaign.id)
  const copyAsNext = useStepCopyAsNext(campaign.id)
  const [draft, setDraft] = useState<Draft>(() => draftOf(step))
  const [dayProblem, setDayProblem] = useState<string | null>(null)
  const [abOn, setAbOn] = useState(Boolean(step.ab_config?.enabled))
  const [picking, setPicking] = useState(false)
  /** Edit Text open: the text being written; null while closed */
  const [composing, setComposing] = useState<string | null>(null)
  const message = useTemplateMessage(!email ? step.template?.id ?? null : null)
  const saveText = useTextSave(campaign.id, step.template?.id ?? '')
  const senders = useQuery({ queryKey: ['sender-profiles', 'options'], queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal), enabled: !email })

  // after a 409 the list is read again; the drawer then shows what is stored
  const reloading = useRef(false)
  useEffect(() => {
    if (!reloading.current) return
    reloading.current = false
    setDraft(draftOf(step))
    setAbOn(Boolean(step.ab_config?.enabled))
  }, [step])

  const conflict = isConflict(patch.error)
  // saves go one after another, each with the version the last one returned: leaving two fields quickly is not a conflict
  const version = useRef(step.row_version)
  useEffect(() => { version.current = Math.max(version.current, step.row_version) }, [step.row_version])
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  /** the text fields' values already on their way, so Done doesn't send them a second time */
  const sent = useRef<Partial<Record<'name' | 'subject_line' | 'preheader', string | null>>>({})
  const inFlight = useRef(0)
  const saveNow = (values: Omit<StepPatch, 'id' | 'row_version'>) => {
    const run = () => patch.mutateAsync({ id: step.id, row_version: version.current, ...values }).then((saved) => { version.current = saved.row_version; return saved })
    // nothing pending: start now, so a save made while the drawer closes (Escape, Done) goes before it unmounts
    const done = inFlight.current === 0 ? run() : queue.current.then(run)
    inFlight.current += 1
    queue.current = done.catch(() => undefined).finally(() => { inFlight.current -= 1 })
    return done
  }
  const send = (values: Omit<StepPatch, 'id' | 'row_version'>) => {
    for (const field of ['name', 'subject_line', 'preheader'] as const) if (field in values) sent.current[field] = values[field] ?? null
    saveNow(values).catch((error) => { if (isConflict(error)) { reloading.current = true; sent.current = {} } })
  }
  const set = (field: keyof Draft) => (value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const abConfig = (next: Partial<Draft> = {}): AbConfig => {
    const values = { ...draft, ...next }
    return { enabled: true, subject_b: values.subjectB.trim(), sample_pct: Number(values.sample), metric: values.metric as AbConfig['metric'], decide_after_minutes: DECIDE_AFTER_MINUTES }
  }

  /** what the text fields hold that the message doesn't yet */
  function changes(): Omit<StepPatch, 'id' | 'row_version'> {
    const out: Omit<StepPatch, 'id' | 'row_version'> = {}
    const now = (field: 'name' | 'subject_line' | 'preheader', stored: string | null) => (field in sent.current ? sent.current[field] ?? '' : stored ?? '')
    if (draft.name.trim() !== now('name', step.name)) out.name = draft.name.trim()
    if (email && draft.subject.trim() !== now('subject_line', step.subject_line)) out.subject_line = draft.subject.trim() || null
    if (email && draft.preheader.trim() !== now('preheader', step.preheader)) out.preheader = draft.preheader.trim() || null
    return out
  }
  const saveField = (field: 'name' | 'subject_line' | 'preheader') => {
    const all = changes()
    if (field in all) send({ [field]: all[field] })
  }
  function saveDay() {
    const day = Number(draft.day)
    if (draft.day.trim() === '' || !Number.isInteger(day) || day < 0 || day > MAX_DAY) {
      setDayProblem('Enter a whole number from 0 to 365.')
      return
    }
    setDayProblem(null)
    if (day !== step.day) send({ day })
  }
  /** Escape, × and Done: whatever was typed and not yet left is saved too */
  function close() {
    const pending = changes()
    if (composing === null && Object.keys(pending).length > 0 && !conflict) send(pending)
    onClose()
  }

  async function applyTemplate(pick: GalleryPick) {
    if (!pick.template) return
    await saveNow({ template: pick.template, ...(pick.fromPreset ? { consume_source: true } : {}) })
    setPicking(false)
  }

  async function copyNext() {
    try {
      const copy = await copyAsNext.mutateAsync(step.id)
      onOpenStep(copy.id)
    } catch (error) {
      toast.failure(error, 'The message was not copied')
    }
  }

  async function saveComposed() {
    if (composing === null || !message.data) return
    try {
      await saveText.mutateAsync({ sms_body: composing, subject_line: message.data.subject_line, media_asset: message.data.media_asset?.id ?? null, base_version: message.data.latest_version })
      setComposing(null)
      toast.success(`Message ${step.position} saved.`)
    } catch (error) {
      toast.failure(error, 'The text was not saved')
    }
  }

  const position = steps.findIndex((item) => item.id === step.id)
  const previous = position > 0 ? steps[position - 1] : null
  const twin = email ? sameSubjectAs(steps, { ...step, subject_line: draft.subject }) : null
  const abOwner = steps.find((item) => item.id !== step.id && item.ab_config?.enabled) ?? null
  const abLocked = email && Boolean(abOwner) && !step.ab_config?.enabled
  const dayError = dayProblem ?? fieldError(patch, 'day') ?? (step.problems.includes('SAME_DAY') ? 'Another message is already on this day.' : null)
  const when = sendOf(step, series)
  const sender = (senders.data ?? []).find((item) => item.id === campaign.sender_profile)
  const timeOptions = [{ value: '', label: `Series time (${series.time})` }, ...HALF_HOURS.map((slot) => ({ value: slot.value, label: slot.value }))]

  const footer = composing !== null ? (
    <>
      <span className="flex-1" />
      <Button variant="secondary" onClick={() => setComposing(null)}>Cancel</Button>
      <Button variant="primary" loading={saveText.isPending} onClick={() => void saveComposed()}>Save Text</Button>
    </>
  ) : (
    <>
      {steps.length > 1 && (
        <button type="button" onClick={() => onRemove(step)} className="-ml-2 h-10 rounded-control-lg px-2 text-sm font-semibold whitespace-nowrap text-danger-text hover:bg-danger-bg">Remove Message</button>
      )}
      <span className="ml-auto flex gap-2">
        <Button variant="secondary" loading={copyAsNext.isPending} disabled={steps.length >= 30} onClick={() => void copyNext()}>Copy as Next Message</Button>
        <Button variant="primary" onClick={close}>Done</Button>
      </span>
    </>
  )

  return (
    <>
      <Drawer title={messageTitle(step)} eyebrow={`Message ${step.position} of ${steps.length}`} onClose={close} footer={footer}
        banner={conflict ? <Notice tone="warning" layout="box">{CHANGED_ELSEWHERE}</Notice> : undefined}>
        {composing !== null ? (
          <TextComposer draft={composing} onDraft={setComposing} mms={mms} imageUrl={message.data?.media_asset?.url ?? null}
            sender={sender ? `${sender.display_name}${sender.sender_id ? ` · ${sender.sender_id}` : ''}` : 'Your Brand'}
            when={when.date ? `${shortDay(when.date)}, ${when.time} ${series.zoneShort}` : `Day ${step.day}, ${when.time} ${series.zoneShort}`} />
        ) : (
          <div className="flex flex-col gap-6">
            <Field label="Internal Name" strong labelEnd={<SaveTick mutation={patch} field="name" />} hint="Only your team sees this. It names the template too." error={fieldError(patch, 'name') ?? undefined}>
              {(ids) => <TextInput {...ids} data-autofocus value={draft.name} placeholder="e.g. Welcome" onChange={(event) => set('name')(event.target.value)} onBlur={() => saveField('name')} />}
            </Field>

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-4">
                <Field label="Day" strong>
                  {(ids) => (
                    <TextInput {...ids} invalid={Boolean(dayError)} inputMode="numeric" className="cep-num" value={draft.day}
                      onChange={(event) => { set('day')(event.target.value); setDayProblem(null) }} onBlur={saveDay}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveDay() } }} />
                  )}
                </Field>
                <Field label="Send Time" strong>
                  {(ids) => <SelectMenu {...ids} label="Send Time" value={step.send_time?.slice(0, 5) ?? ''} options={timeOptions} onChange={(time) => send({ send_time: time || null })} />}
                </Field>
              </div>
              {dayError ? (
                <p role="alert" className="flex items-center gap-1.5 text-helper text-danger-plain" data-day-error><CircleAlert size={16} strokeWidth={1.5} aria-hidden />{dayError}</p>
              ) : (
                <p className="-mt-1 flex items-center justify-between gap-3 text-helper text-ink-800">
                  0 is the start date.
                  <SaveTick mutation={patch} of={Boolean(patch.variables && ('day' in patch.variables || 'send_time' in patch.variables))} />
                </p>
              )}
              <p className="cep-num rounded-lg border border-line-subtle bg-surface-subtle px-3.5 py-3 text-helper text-pretty text-ink-900" data-send-sentence>{sendSentence(step, series)}</p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink-800">Template</span>
              {step.template ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3" data-template-row>
                  <Thumbnail step={step} email={email} size="row" />
                  <span className="flex min-w-[220px] flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold break-words text-ink-900">{step.template.name}</span>
                    <span className="text-helper text-ink-800">{channelLabel(campaign.channel)} template · copied for this message</span>
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {email && <Button size="sm" variant="secondary" onClick={() => { close(); onEditTemplate(step) }}>Edit Template</Button>}
                    <Button size="sm" variant="link" onClick={() => setPicking(true)}>Change</Button>
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink-300 p-4" data-template-row="empty">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink-900">No template yet</span>
                    <span className="text-helper text-ink-800">{previous?.template ? `Copy message ${previous.position} to keep the same header, footer and branding.` : 'Start from a saved or preset template.'}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {previous?.template && <Button size="sm" variant="secondary" loading={patch.isPending && Boolean(patch.variables?.template)} onClick={() => send({ template: previous.template?.id })}>Copy Message {previous.position}</Button>}
                    <Button size="sm" variant={previous?.template ? 'link' : 'secondary'} onClick={() => setPicking(true)}>Choose from Gallery</Button>
                  </span>
                </div>
              )}
              {fieldError(patch, 'template') && <p role="alert" className="text-helper font-medium text-danger-text">{fieldError(patch, 'template')}</p>}
            </div>

            {email ? (
              <>
                <Field label="Subject Line" strong labelEnd={<SaveTick mutation={patch} field="subject_line" />} error={fieldError(patch, 'subject_line') ?? undefined}>
                  {(ids) => <TextInput {...ids} warning={Boolean(twin)} value={draft.subject} placeholder="e.g. Your first reward is unlocked" onChange={(event) => set('subject')(event.target.value)} onBlur={() => saveField('subject_line')} />}
                </Field>
                {twin && (
                  <p className="-mt-4 flex items-start gap-1.5 text-helper text-warning-text" data-same-subject>
                    <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="mt-px shrink-0 text-warning" />Message {twin.position} has the same subject. Give each message its own job.
                  </p>
                )}
                <Field label="Preheader" strong labelEnd={<SaveTick mutation={patch} field="preheader" />} error={fieldError(patch, 'preheader') ?? undefined}>
                  {(ids) => <TextInput {...ids} value={draft.preheader} placeholder="e.g. Use it any time before 30 Nov." onChange={(event) => set('preheader')(event.target.value)} onBlur={() => saveField('preheader')} />}
                </Field>

                <div className="flex flex-col gap-4 rounded-lg border border-line p-4" data-ab-box>
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <span id="ab-title" className={`text-sm font-semibold ${abLocked ? 'text-ink-300' : 'text-ink-900'}`}>A/B Subject Test</span>
                        <SaveTick mutation={patch} field="ab_config" />
                      </span>
                      <span id="ab-help" className="text-helper text-pretty text-ink-800">
                        {abLocked ? `Message ${abOwner?.position} is already being tested. One message per drip can have an A/B test.` : 'Try two subject lines on this message. Only one message in a drip can be tested.'}
                      </span>
                    </span>
                    <Switch checked={abOn} disabled={abLocked} labelledBy="ab-title" describedBy="ab-help"
                      onChange={(on) => {
                        setAbOn(on)
                        if (on && draft.subjectB.trim()) send({ ab_config: abConfig() })
                        if (!on && step.ab_config?.enabled) send({ ab_config: null })
                      }} />
                  </div>
                  {abOn && !abLocked && (
                    <>
                      <Field label="Subject B" strong error={fieldError(patch, 'ab_config') ?? undefined} hint={step.ab_config?.enabled ? undefined : 'The test is saved once Subject B is filled in.'}>
                        {(ids) => (
                          <TextInput {...ids} value={draft.subjectB} placeholder="e.g. A reward is waiting for you" onChange={(event) => set('subjectB')(event.target.value)}
                            onBlur={() => { if (draft.subjectB.trim() && draft.subjectB.trim() !== (step.ab_config?.subject_b ?? '')) send({ ab_config: abConfig() }) }} />
                        )}
                      </Field>
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Test Group" strong>
                          {(ids) => <SelectMenu {...ids} label="Test Group" value={draft.sample} options={SAMPLE} onChange={(value) => { set('sample')(value); if (draft.subjectB.trim()) send({ ab_config: abConfig({ sample: value }) }) }} />}
                        </Field>
                        <Field label="Winner By" strong>
                          {(ids) => <SelectMenu {...ids} label="Winner By" value={draft.metric} options={WINNER} onChange={(value) => { set('metric')(value); if (draft.subjectB.trim()) send({ ab_config: abConfig({ metric: value }) }) }} />}
                        </Field>
                      </div>
                      <p className="text-helper text-pretty text-ink-800">The winner goes to the rest of the list 4 hours later. Later messages are not tested.</p>
                    </>
                  )}
                </div>
              </>
            ) : (
              <TextView campaignId={campaign.id} templateId={step.template?.id ?? null} mms={mms} onEdit={() => setComposing(message.data?.sms_body ?? '')} />
            )}
          </div>
        )}
      </Drawer>
      {picking && (
        <TemplatePicker channel={campaign.channel} campaignId={campaign.id} onClose={() => setPicking(false)} onPick={applyTemplate} />
      )}
    </>
  )
}
