/**
 * The campaign setup after the Create Campaign pop-up (/campaigns/:id/edit): Audience → Content → Test → Targets → Review & Publish.
 * E-receipts skip Audience. A drip goes Audience → Sequence → Targets → Test & Publish (setupFlow.ts). The campaign's details (name, type, purpose, owner, code, tags) are edited in the same
 * pop-up, opened from "Details".
 *
 * One form for every step (React Hook Form + the Zod schema). "Continue" checks the fields of the step you are on and
 * saves the draft, so the later steps (preview, test, checklist) always work on what is stored. Nothing is sent until
 * the last step publishes. The API stays the authority: its field messages land on the same fields, and the setup
 * opens the step (or the Details pop-up) that holds the first one. Progress is counted in setupFlow.ts.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CircleCheck, Pencil, Save, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FormProvider, useForm, type FieldPath } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { buttonClass } from '@/components/buttonStyles'
import { api, ApiError } from '@/lib/api'
import type { Campaign, CampaignFormOptions, ContactList } from '@/lib/types'

import { seriesOf, sequenceProblems, statusText } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { CardSubheading } from '../parts'
import { campaignSchema, emptyValues, formFieldOf, fromCampaign, STEP_FIELDS, stepOfApiField, toInput, type CampaignFormValues } from '../schema'
import { CampaignSetupDialog } from '../setup/CampaignSetupDialog'
import { isDrip, placeFromParams, progressAfter, typeCanChange, PROGRESS, PUBLISH_SECTIONS, resumeStep, setupHref, stepForType, stepsDone, stepsFor, type FlowStep, type PublishSection, type SetupPlace } from '../setupFlow'
import { hasAction, tabOfStep } from '../vocabulary'
import { FlowProgress, FlowStepMenu, FlowStepper, HoverTip } from './FlowStepper'
import { StepAudience } from './StepAudience'
import { StepDripPublish } from './StepDripPublish'
import { PublishSummary, StepReview } from './StepReview'
import { StepSchedule } from './StepSchedule'
import { StepSequence } from './StepSequence'
import { StepTargets } from './StepTargets'
import { StepTemplate } from './StepTemplate'
import { StepTest } from './StepTest'

import { PageHelp } from '@/help/HelpPanel'

const INTRO: Record<FlowStep, string> = {
  audience: 'Attach the contact lists to send to, and the ones to keep out.',
  content: 'Choose the message and who it comes from.',
  sequence: 'Every message goes to everyone on the campaign list, on its day. Days count from the start date, so moving the start date moves every message.',
  test: 'See the message as a recipient will, and send yourself a test before it goes to anyone else.',
  targets: 'Set what this campaign should achieve, and what it may cost. All of it is optional: skip it for now and come back later.',
  publish: 'Decide when it goes out, check everything once more, then publish to production.',
}
const DRIP_PUBLISH_INTRO = 'Send every message to testers now, check them in one sitting, then review the timeline and publish.'
/** the form fields each step owns: "Continue" (or saving a section) checks these and nothing else */
const FIELDS: Record<FlowStep, readonly (keyof CampaignFormValues)[]> = { audience: STEP_FIELDS[1], content: STEP_FIELDS[2], sequence: [], targets: STEP_FIELDS[4], test: [], publish: STEP_FIELDS[3] }
/** where the API's field messages belong, by the old wizard's step index */
const PLACE_OF_OLD_INDEX: (FlowStep | 'details')[] = ['details', 'audience', 'content', 'publish', 'targets']

export function CampaignWizardPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { me, can } = useAuth()
  const [params, setParams] = useSearchParams()
  const heading = useRef<HTMLHeadingElement>(null)
  const discardLocal = useRef(false)
  const [detailErrors, setDetailErrors] = useState<Record<string, string> | null>(null)
  /** uploads on the Audience step waiting for a confirmation, and what to do once the person has answered about them */
  const [pendingUploads, setPendingUploads] = useState<ContactList[]>([])
  const [askFirst, setAskFirst] = useState<(() => void) | null>(null)
  /** Continue pressed on Sequence while a message (or the start date) still needs something: the step shows why */
  const [sequenceAttempt, setSequenceAttempt] = useState(0)

  const zone = me?.tenant.timezone || 'UTC'
  const form = useForm<CampaignFormValues>({ resolver: zodResolver(campaignSchema), defaultValues: emptyValues(zone, me?.principal.id ?? ''), mode: 'onTouched' })

  const existing = useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${id}/`, undefined, signal),
  })
  const options = useQuery({
    queryKey: ['campaigns', 'form-options'],
    queryFn: ({ signal }) => api.get<CampaignFormOptions>('/campaigns/form-options/', undefined, signal),
    staleTime: 5 * 60_000,
  })

  const loaded = existing.data
  const type = loaded?.campaign_type ?? 'REGULAR_MARKETING'
  const dripSteps = useQuery({ ...dripStepsQuery(id), enabled: type === 'DRIP' })
  const steps = stepsFor(type)
  // a step opens once the ones before it were gone through; an unfinished setup resumes where it stopped
  const reachedKey: FlowStep = loaded && !loaded.setup_complete ? resumeStep(loaded.setup_step, type) : 'publish'
  const reached = steps.findIndex((item) => item.key === reachedKey)
  const place: SetupPlace = placeFromParams(params, type) ?? { step: loaded && !loaded.setup_complete ? reachedKey : steps[0].key }
  const step = Math.min(reached, Math.max(0, steps.findIndex((item) => item.key === place.step)))
  const current = steps[step]?.key ?? steps[0].key
  const section: PublishSection | undefined = current === 'publish' ? place.section : undefined
  const detailsOpen = Boolean(place.details) || detailErrors !== null
  const completed = loaded ? (loaded.setup_complete ? steps.length : steps.findIndex((item) => item.key === reachedKey)) : 0

  // the stored campaign fills the form once per stored version; edits not yet saved are kept, unless a reload was asked for (409)
  const loadedKey = loaded ? `${loaded.id}:${loaded.row_version}` : ''
  useEffect(() => {
    if (!loaded) return
    form.reset(fromCampaign(loaded, zone), { keepDirtyValues: !discardLocal.current })
    discardLocal.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey])

  // the address always names the step in view (so finishing the setup doesn't move the page), and old links (?step=1..7) are rewritten to the new places
  const oldStep = /^\d+$/.test(params.get('step') ?? '') || !params.get('step')
  useEffect(() => {
    if (!loaded || !oldStep) return
    setParams(new URLSearchParams(setupHref(loaded.id, { ...place, step: current }).split('?')[1]), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, oldStep])

  // focus moves to the heading of the step that opens (not on the first load)
  const shownStep = useRef<FlowStep | null>(null)
  useEffect(() => {
    if (!loaded) return
    if (shownStep.current && shownStep.current !== current) heading.current?.focus()
    shownStep.current = current
  }, [current, loaded])

  // a link to a part of Review & Publish brings it into view
  useEffect(() => {
    if (!section || !loaded) return
    const target = document.getElementById(`publish-${section}`)
    target?.scrollIntoView?.({ block: 'start' })
    target?.querySelector<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true })
  }, [section, loadedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = form.formState.isDirty
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function show(key: FlowStep, sectionKey?: PublishSection) {
    const step = stepForType(key, type)                                                 // a drip's content and test live on its own steps
    const section = sectionKey && !(isDrip(type) && sectionKey === 'schedule') ? sectionKey : undefined
    setParams(new URLSearchParams({ step, ...(section ? { section } : {}) }), { replace: true })
  }
  function openDetails(open: boolean) {
    if (!open) setDetailErrors(null)
    setParams((now) => { if (open) now.set('details', '1'); else now.delete('details'); return now }, { replace: true })
  }
  /** the old wizard's step index (Review's Edit buttons, the API's field messages) → its new place */
  function goToOld(index: number) {
    const target = PLACE_OF_OLD_INDEX[index] ?? 'details'
    if (target === 'details') openDetails(true)
    else if (isDrip(type) && (target === 'content' || target === 'publish')) show('sequence')       // a drip's templates, start and times
    else if (target === 'publish') show('publish', 'schedule')
    else show(target)
  }

  const save = useMutation({
    mutationFn: ({ values, progress }: { values: CampaignFormValues; progress: number }) =>
      api.patch<Campaign>(`/campaigns/${id}/`, { ...toInput(values, loaded?.row_version), setup_step: progress }),
    onSuccess: (campaign) => {
      queryClient.setQueryData(['campaigns', 'detail', campaign.id], campaign)
      form.reset(fromCampaign(campaign, zone))
      void queryClient.invalidateQueries({ queryKey: ['campaigns'], refetchType: 'none' })
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.status !== 400) return
      const fields = Object.entries(error.problem.errors ?? {})
      const details: Record<string, string> = {}
      fields.forEach(([field, messages]) => {
        const nested = messages !== null && typeof messages === 'object' && !Array.isArray(messages) // targets: { target_opens: [...] }
        if (nested) {
          Object.entries(messages as Record<string, unknown>).forEach(([inner, text]) =>
            form.setError(`${field}.${inner}` as FieldPath<CampaignFormValues>, { type: 'server', message: String(Array.isArray(text) ? text[0] : text) }))
        } else {
          const text = String(Array.isArray(messages) ? messages[0] : messages)
          if (stepOfApiField(field) === 0) details[field] = text
          else form.setError(formFieldOf(field) as FieldPath<CampaignFormValues>, { type: 'server', message: text })
        }
      })
      if (fields.length === 0) return
      const first = Math.min(...fields.map(([field]) => stepOfApiField(field)))
      if (first === 0) setDetailErrors(details)
      else goToOld(first)
    },
  })

  /**
   * Checks `fields`, stores the draft when something changed, and answers the stored campaign (null: stay here).
   * `progress`: what finishing this records (setupFlow's PROGRESS); null keeps the place without moving it on.
   */
  async function commit(fields: readonly (keyof CampaignFormValues)[], progress: number | null): Promise<Campaign | null> {
    if (!loaded) return null
    const fine = await form.trigger(fields as FieldPath<CampaignFormValues>[], { shouldFocus: true })
    if (!fine) return null
    const before = loaded.setup_step
    const target = progress === null ? before : Math.max(before, progress)
    if (!form.formState.isDirty && target === before) return loaded
    try {
      return await save.mutateAsync({ values: form.getValues(), progress: target })
    } catch {
      return null // shown by onError / the banners below
    }
  }

  /** moving on from Audience with an upload still waiting: ask whether to attach it first */
  function afterUploads(next: () => void) {
    if (current === 'audience' && pendingUploads.length > 0) setAskFirst(() => next)
    else next()
  }

  async function go(index: number) {
    if (index <= step) return show(steps[index].key)
    if (current === 'publish') return
    if (current === 'sequence' && sequenceBlocked) {
      setSequenceAttempt((count) => count + 1)
      return
    }
    const campaign = await commit(FIELDS[current], progressAfter(current, type))
    if (!campaign) return
    const furthest = campaign.setup_complete ? steps.length - 1 : steps.findIndex((item) => item.key === resumeStep(campaign.setup_step, campaign.campaign_type))
    show(steps[Math.min(index, furthest)].key)
  }

  /** Targets can wait: the step counts as passed without anything entered */
  async function skipTargets() {
    const campaign = await commit([], progressAfter('targets', type))
    if (!campaign) return
    show(steps[Math.min(step + 1, steps.length - 1)].key)
  }

  async function saveAndClose() {
    const campaign = await commit(FIELDS[current], null)
    if (campaign) navigate(campaign.setup_complete ? `/campaigns/${campaign.id}?tab=${tabOfStep(current, campaign)}` : '/campaigns') // an unfinished setup has no campaign page to go to yet
  }

  /** a test went out: the Test step counts as passed (an e-receipt's setup is then done, having no schedule to save) */
  async function markTested() {
    try {
      const fresh = await queryClient.fetchQuery({ queryKey: ['campaigns', 'detail', id], queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${id}/`, undefined, signal), staleTime: 0 })
      const tested = progressAfter('test', fresh.campaign_type)
      if (fresh.setup_step >= tested) return
      const done = await api.patch<Campaign>(`/campaigns/${id}/`, { setup_step: tested, row_version: fresh.row_version })
      queryClient.setQueryData(['campaigns', 'detail', id], done)
    } catch (error) {
      // the test itself went out; only the step's tick is missing
      toast.failure(error, 'The test mark was not saved')
    }
  }

  // ---- guards
  if (!can('campaign.edit')) return <ErrorState title="You cannot edit campaigns" detail="Ask a Marketing Admin for the campaign.edit permission." />
  if (existing.isPending) return <p className="flex items-center gap-3 text-sm text-ink-800"><Spinner /> Loading campaign</p>
  if (existing.isError) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
  if (!loaded) return null
  if (loaded.is_journey_generated || !hasAction(loaded, 'edit')) {
    return (
      <section>
        <h1 className="mb-4 font-display text-page-title font-semibold text-ink-900">{loaded.name}</h1>
        <div className="rounded-lg border border-warning bg-warning-bg px-5 py-4 text-sm text-warning-text">
          {loaded.is_journey_generated ? 'This campaign is generated by a journey. Change the journey instead.' : `This campaign is ${loaded.display_status_label.toLowerCase()}, so it can no longer be edited. Clone it to start again from its settings.`}
          <Link to={`/campaigns/${loaded.id}`} className="ml-2 font-medium underline underline-offset-2">Back to the Campaign</Link>
        </div>
      </section>
    )
  }

  const conflict = save.error instanceof ApiError && save.error.status === 409 ? save.error : null
  const otherError = save.isError && !conflict && !(save.error instanceof ApiError && save.error.status === 400) ? save.error : null
  const last = current === 'publish'
  const back = loaded.setup_complete ? `/campaigns/${loaded.id}?tab=${tabOfStep(current, loaded)}` : '/campaigns'
  const receipt = type === 'E_RECEIPT'
  const drip = isDrip(type)
  const canChangeType = typeCanChange(loaded) && !drip       // a drip's Edit Details asks its messages (CampaignSetupDialog)

  const stepper = { steps: steps.map((item) => item.label), current: step, reached, completed, onGo: (index: number) => void go(index) }
  const sequence = drip && dripSteps.data ? sequenceProblems(dripSteps.data, seriesOf(loaded, zone)) : null
  const sequenceBlocked = !sequence || sequence.any
  const saveAndCloseClick = () => afterUploads(() => void saveAndClose())
  const backLabel = loaded.setup_complete ? 'Back to the Campaign' : 'Back to Campaigns'

  return (
    <section>
      {/* the flow's own top bar, the width of the content area, under the app's top bar */}
      <div className="@container sticky top-14 z-20 -mx-4 -mt-6 border-b border-line bg-surface md:-mx-8 md:-mt-8" data-flow-bar>
        <div className="flex h-16 items-center gap-4 px-4 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 xl:flex-initial">
            <Link to={back} aria-label={backLabel} title={backLabel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control-md border border-line text-ink-800 transition-colors duration-fast ease-standard hover:bg-surface-subtle">
              <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            </Link>
            <span className="min-w-0 truncate text-card-title font-semibold text-ink-900" title={loaded.name} data-testid="flow-campaign-name">{loaded.name}</span>
            <span className="hidden shrink-0 sm:inline-flex"><StatusBadge status={loaded.display_status} label={loaded.display_status_label} /></span>
            <button type="button" aria-label="Edit Details" onClick={() => openDetails(true)}
              className="group relative inline-flex shrink-0 items-center gap-1.5 rounded-control-sm text-sm font-semibold text-brand-800 hover:underline">
              <Pencil size={16} strokeWidth={1.5} aria-hidden /><span className="sr-only sm:not-sr-only xl:@max-[1339px]:sr-only">Details</span>
              <HoverTip label="Edit Details" show="max-sm:group-hover:block max-sm:group-focus-visible:block xl:@max-[1339px]:group-hover:block xl:@max-[1339px]:group-focus-visible:block" />
            </button>
          </div>
          <div className="hidden flex-1 justify-center xl:flex"><FlowStepper {...stepper} /></div>
          <div className="flex shrink-0 items-center gap-3">
            {dirty && <span className="hidden text-helper text-ink-800 2xl:inline">Unsaved changes</span>}
            <span className="hidden xl:inline-flex"><button type="button" className={buttonSecondary} disabled={save.isPending} onClick={saveAndCloseClick}>Save and Close</button></span>
            <IconButton label="Save and Close" icon={Save} variant="outline" size="md" className="xl:hidden" disabled={save.isPending} onClick={saveAndCloseClick} />
          </div>
        </div>
        <div className="xl:hidden">
          <div className="px-4 pb-2 md:px-6"><FlowStepMenu {...stepper} /></div>
          <FlowProgress current={step} total={steps.length} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1280px] pt-8">
        {conflict && (
          <div role="alert" className="mb-4 rounded-lg border border-warning bg-warning-bg px-5 py-4 text-sm text-warning-text">
            <p className="font-medium">{conflict.message}</p>
            <button type="button" className="mt-2 font-medium underline underline-offset-2" onClick={() => { save.reset(); discardLocal.current = true; void existing.refetch() }}>
              Reload the Latest Version
            </button>
            <p className="mt-1">Your unsaved changes here are discarded.</p>
          </div>
        )}
        {otherError !== null && <div className="mb-4"><ErrorState title="The campaign was not saved" error={otherError} /></div>}

        <FormProvider {...form}>
          <form noValidate onSubmit={(event) => { event.preventDefault(); if (!last) afterUploads(() => void go(step + 1)) }} className="min-w-0">
            <div key={current} className="animate-step-in">
              <p className="text-xs font-semibold text-ink-800">Step {step + 1} of {steps.length}</p>
              <span className="flex items-center gap-1.5"><h1 ref={heading} tabIndex={-1} className="font-display text-page-title font-semibold text-ink-900 outline-none">{steps[step].label}</h1><PageHelp chapter="campaign-setup" /></span>
              <p className="mt-1 text-sm text-ink-800">{drip && current === 'publish' ? DRIP_PUBLISH_INTRO : INTRO[current]}</p>
              {/* where the setup was left; not shown on the step it resumes at, which says so itself */}
              {(loaded.setup_complete || current !== reachedKey) && (
                <p className="mt-1 text-sm text-ink-800" data-testid="setup-progress">
                  {loaded.setup_complete ? 'Changes are saved as you continue. Nothing is sent until you publish.'
                    : `Setup in progress: ${stepsDone(loaded)} of ${steps.length} steps done. The campaign opens here until setup is finished. Nothing is sent until you publish.`}
                </p>
              )}
              <div className="mt-6">
                {current === 'audience' && <StepAudience campaign={loaded} onChangeType={canChangeType ? () => openDetails(true) : undefined} pending={pendingUploads} onPendingChange={setPendingUploads} />}
                {current === 'content' && !drip && <StepTemplate campaign={loaded} />}
                {current === 'sequence' && <StepSequence campaign={loaded} options={options.data} workspaceZone={zone} attempt={sequenceAttempt} onEditDetails={() => openDetails(true)} />}
                {current === 'targets' && <StepTargets />}
                {current === 'test' && <StepTest campaign={loaded} options={options.data} onTested={() => void markTested()} />}
                {current === 'publish' && drip && (
                  <StepDripPublish campaign={loaded} options={options.data} workspaceZone={zone} onAllTested={() => void markTested()}
                    beforePublish={async () => Boolean(await commit([], PROGRESS.schedule))} />
                )}
                {current === 'publish' && !drip && (
                  <div className="flex flex-col gap-10">
                    <PublishSummary campaign={loaded} onEdit={goToOld} onGo={(key) => show(key)} />
                    {PUBLISH_SECTIONS.map((part) => (
                      <section key={part.key} id={`publish-${part.key}`} aria-labelledby={`publish-${part.key}-title`} className="scroll-mt-40">
                        <CardSubheading className="mb-4 outline-none"><span id={`publish-${part.key}-title`} tabIndex={-1}>{part.label}</span></CardSubheading>
                        {part.key === 'schedule' && (
                          <>
                            <StepSchedule options={options.data} workspaceZone={zone} campaignId={loaded.id} onChangeType={canChangeType ? () => openDetails(true) : undefined} />
                            {!receipt && (
                              <div className="mt-4">
                                <button type="button" className={buttonSecondary} disabled={save.isPending} onClick={() => void commit(FIELDS.publish, PROGRESS.schedule)}>Save Schedule</button>
                              </div>
                            )}
                          </>
                        )}
                        {part.key === 'review' && (
                          <StepReview campaign={loaded} onEdit={goToOld}
                            beforePublish={async () => Boolean(await commit(FIELDS.publish, receipt ? null : PROGRESS.schedule))} />
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4 pb-8">
              {current === 'sequence' && sequence && dripSteps.data && (
                <span role="status" data-sequence-status className={`mr-auto flex basis-full items-center gap-2 text-sm font-medium sm:basis-auto ${sequence.any ? 'text-warning-text' : 'text-success-text'}`}>
                  {sequence.any ? <TriangleAlert size={16} strokeWidth={1.5} aria-hidden className="text-warning" /> : <CircleCheck size={16} strokeWidth={1.5} aria-hidden />}
                  {statusText(dripSteps.data, sequence)}
                </span>
              )}
              {step > 0 && <button type="button" className={buttonSecondary} onClick={() => show(steps[step - 1].key)}>Back</button>}
              {current === 'targets' && (
                <button type="button" className={buttonClass({ variant: 'link' })} disabled={save.isPending} onClick={() => void skipTargets()}>Skip for Now</button>
              )}
              {!last && (
                <button type="submit" className={buttonPrimary} disabled={save.isPending}>
                  {save.isPending && <Spinner className="h-4 w-4 border-brand-800 border-t-white" />}
                  {steps[step].next}
                  <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
                </button>
              )}
            </div>
          </form>
        </FormProvider>
      </div>

      {askFirst && pendingUploads.length > 0 && (
        <Modal title="Uploaded List Not Attached" onClose={() => setAskFirst(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} onClick={() => { const next = askFirst; setAskFirst(null); setPendingUploads([]); next() }}>Continue Without It</button>
              <button type="button" className={buttonPrimary} onClick={() => {
                const next = askFirst
                form.setValue('contact_lists', [...new Set([...form.getValues('contact_lists'), ...pendingUploads.map((list) => list.id)])], { shouldDirty: true })
                setAskFirst(null)
                setPendingUploads([])
                next()
              }}>Confirm and Continue</button>
            </>
          }>
          <p className="text-sm text-ink-800">
            {pendingUploads.map((list) => `“${list.name}”`).join(' and ')} {pendingUploads.length === 1 ? 'isn’t' : 'aren’t'} attached yet. Confirm {pendingUploads.length === 1 ? 'it' : 'them'} now, or continue without {pendingUploads.length === 1 ? 'it' : 'them'}?
          </p>
        </Modal>
      )}

      {detailsOpen && (
        <CampaignSetupDialog campaign={loaded} initialErrors={detailErrors ?? undefined} onClose={() => openDetails(false)}
          onReload={() => void existing.refetch()} />
      )}
    </section>
  )
}
