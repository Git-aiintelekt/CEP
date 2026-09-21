/**
 * Create (/campaigns/new) and edit (/campaigns/:id/edit) a campaign in seven steps.
 *
 * One form for all steps (React Hook Form + the Zod schema). "Continue" checks the fields of the step you are on
 * and saves the draft, so the later steps (preview, test, checklist) always work on what is stored. Nothing is
 * sent until the last step publishes. The API stays the authority: its field messages land on the same fields,
 * and the wizard opens the step that holds the first one.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FormProvider, useForm, type FieldPath } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import type { Campaign, CampaignFormOptions } from '@/lib/types'

import { StepRail } from '../parts'
import { campaignSchema, emptyValues, formFieldOf, fromCampaign, STEP_FIELDS, stepOfApiField, toInput, type CampaignFormValues } from '../schema'
import { hasAction } from '../vocabulary'
import { StepAudience } from './StepAudience'
import { StepBasics } from './StepBasics'
import { StepReview } from './StepReview'
import { StepSchedule } from './StepSchedule'
import { StepTargets } from './StepTargets'
import { StepTemplate } from './StepTemplate'
import { StepTest } from './StepTest'

const STEPS = ['Basic Info', 'Audience', 'Template', 'Scheduling & Delivery', 'Targets & Economics', 'Test & Preview', 'Review & Publish'] as const
const INTRO = [
  'Name the campaign and choose what kind of send it is.',
  'Attach the contact lists to send to, and the ones to keep out.',
  'Choose the message and who it comes from.',
  'Decide when it goes out and how it is delivered.',
  'Set what this campaign should achieve, and what it may cost.',
  'See the message as a recipient would, and send yourself a test.',
  'Check everything once more, then publish to production.',
]

export function CampaignWizardPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { me, can } = useAuth()
  const [params, setParams] = useSearchParams()
  const step = Math.min(STEPS.length - 1, Math.max(0, Number(params.get('step') ?? '1') - 1 || 0))
  const [visited, setVisited] = useState(step)
  const heading = useRef<HTMLHeadingElement>(null)

  const zone = me?.tenant.timezone || 'UTC'
  const form = useForm<CampaignFormValues>({ resolver: zodResolver(campaignSchema), defaultValues: emptyValues(zone, me?.principal.id ?? ''), mode: 'onTouched' })

  const existing = useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: ({ signal }) => api.get<Campaign>(`/campaigns/${id}/`, undefined, signal),
    enabled: isEdit,
  })
  const options = useQuery({
    queryKey: ['campaigns', 'form-options'],
    queryFn: ({ signal }) => api.get<CampaignFormOptions>('/campaigns/form-options/', undefined, signal),
    staleTime: 5 * 60_000,
  })

  // the stored campaign fills the form once per stored version (a reload after a 409 replaces local edits on purpose)
  const loaded = existing.data
  const loadedKey = loaded ? `${loaded.id}:${loaded.row_version}` : ''
  useEffect(() => {
    if (loaded) form.reset(fromCampaign(loaded, zone))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey])

  const dirty = form.formState.isDirty
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function show(index: number, campaignId = id) {
    setVisited((current) => Math.max(current, index))
    if (campaignId && campaignId !== id) navigate(`/campaigns/${campaignId}/edit?step=${index + 1}`, { replace: true })
    else setParams({ step: String(index + 1) }, { replace: true })
    requestAnimationFrame(() => heading.current?.focus())
  }

  const save = useMutation({
    mutationFn: (values: CampaignFormValues) => {
      const input = toInput(values, loaded?.row_version)
      return loaded ? api.patch<Campaign>(`/campaigns/${loaded.id}/`, input) : api.post<Campaign>('/campaigns/', input)
    },
    onSuccess: (campaign) => {
      queryClient.setQueryData(['campaigns', 'detail', campaign.id], campaign)
      form.reset(fromCampaign(campaign, zone))
      void queryClient.invalidateQueries({ queryKey: ['campaigns'], refetchType: 'none' })
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.status !== 400) return
      const fields = Object.entries(error.problem.errors ?? {})
      fields.forEach(([field, messages]) => {
        const nested = messages !== null && typeof messages === 'object' && !Array.isArray(messages) // targets: { target_opens: [...] }
        if (nested) {
          Object.entries(messages as Record<string, unknown>).forEach(([inner, text]) =>
            form.setError(`${field}.${inner}` as FieldPath<CampaignFormValues>, { type: 'server', message: String(Array.isArray(text) ? text[0] : text) }))
        } else {
          form.setError(formFieldOf(field) as FieldPath<CampaignFormValues>, { type: 'server', message: String(Array.isArray(messages) ? messages[0] : messages) })
        }
      })
      if (fields.length > 0) show(Math.min(...fields.map(([field]) => stepOfApiField(field))))
    },
  })

  /** checks the current step, stores the draft when something changed, and answers the stored campaign (null: stay here) */
  async function commit(): Promise<Campaign | null> {
    const fine = await form.trigger(STEP_FIELDS[step] as unknown as FieldPath<CampaignFormValues>[], { shouldFocus: true })
    if (!fine) return null
    if (loaded && !form.formState.isDirty) return loaded
    try {
      return await save.mutateAsync(form.getValues())
    } catch {
      return null // shown by onError / the banners below
    }
  }

  async function go(index: number) {
    if (index <= step) return show(index)
    const campaign = await commit()
    if (campaign) show(index, campaign.id)
  }

  async function saveAndClose() {
    const campaign = await commit()
    if (campaign) navigate(`/campaigns/${campaign.id}`)
  }

  // ---- guards
  if (!can('campaign.edit')) return <ErrorState title="You cannot edit campaigns" error={new Error('Ask a Marketing Admin for the campaign.edit permission.')} />
  if (isEdit && existing.isPending) return <p className="flex items-center gap-3 text-sm text-ink-500"><Spinner /> Loading campaign</p>
  if (isEdit && existing.isError) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
  if (loaded && (loaded.is_journey_generated || !hasAction(loaded, 'edit'))) {
    return (
      <section>
        <h1 className="mb-4 text-xl font-semibold text-ink-900">{loaded.name}</h1>
        <div className="rounded-lg border border-warning bg-warning-bg px-5 py-4 text-sm text-warning-text">
          {loaded.is_journey_generated ? 'This campaign is generated by a journey. Change the journey instead.' : `This campaign is ${loaded.display_status_label.toLowerCase()}, so it can no longer be edited. Clone it to start again from its settings.`}
          <Link to={`/campaigns/${loaded.id}`} className="ml-2 font-medium underline underline-offset-2">Back to the campaign</Link>
        </div>
      </section>
    )
  }

  const conflict = save.error instanceof ApiError && save.error.status === 409 ? save.error : null
  const otherError = save.isError && !conflict && !(save.error instanceof ApiError && save.error.status === 400) ? save.error : null
  const last = step === STEPS.length - 1
  const name = form.watch('name')

  return (
    <section>
      <Link to={loaded ? `/campaigns/${loaded.id}` : '/campaigns'} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> {loaded ? 'Back to the campaign' : 'Campaigns'}
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold text-ink-900">
            <span className="truncate">{loaded ? name || loaded.name : 'New campaign'}</span>
            {loaded && <StatusBadge status={loaded.display_status} label={loaded.display_status_label} />}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{loaded ? 'Changes are saved as you continue. Nothing is sent until you publish.' : 'Saved as a draft when you continue. Nothing is sent until you publish.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-sm text-ink-500">Unsaved changes</span>}
          <button type="button" className={buttonSecondary} disabled={save.isPending} onClick={() => void saveAndClose()}>Save and close</button>
        </div>
      </div>

      {conflict && (
        <div role="alert" className="mb-4 rounded-lg border border-warning bg-warning-bg px-5 py-4 text-sm text-warning-text">
          <p className="font-medium">{conflict.message}</p>
          <button type="button" className="mt-2 font-medium underline underline-offset-2" onClick={() => { save.reset(); void existing.refetch() }}>
            Reload the latest version (your unsaved changes here are discarded)
          </button>
        </div>
      )}
      {otherError !== null && <div className="mb-4"><ErrorState title="The campaign was not saved" error={otherError} /></div>}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <StepRail steps={STEPS} current={step} reached={loaded ? STEPS.length - 1 : visited} onGo={(index) => void go(index)} />
        <FormProvider {...form}>
          <form noValidate onSubmit={(event) => { event.preventDefault(); if (!last) void go(step + 1) }} className="min-w-0">
            <div key={step} className="animate-step-in">
              <p className="text-xs font-semibold text-ink-500">Step {step + 1} of {STEPS.length}</p>
              <h2 ref={heading} tabIndex={-1} className="font-display text-lg font-semibold text-ink-900 outline-none">{STEPS[step]}</h2>
              <p className="mb-5 mt-0.5 text-sm text-ink-500">{INTRO[step]}</p>
              {step === 0 && <StepBasics options={options.data} isNew={!loaded} />}
              {step === 1 && <StepAudience />}
              {step === 2 && <StepTemplate campaign={loaded ?? null} />}
              {step === 3 && <StepSchedule options={options.data} workspaceZone={zone} />}
              {step === 4 && <StepTargets />}
              {step === 5 && loaded && <StepTest campaign={loaded} options={options.data} />}
              {step === 6 && loaded && <StepReview campaign={loaded} onEdit={show} />}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pb-8 pt-4">
              {step > 0 && <button type="button" className={buttonSecondary} onClick={() => show(step - 1)}>Back</button>}
              {!last && (
                <button type="submit" className={buttonPrimary} disabled={save.isPending}>
                  {save.isPending && <Spinner className="h-4 w-4 border-brand-800 border-t-white" />}
                  {loaded ? 'Save and continue' : step === 0 ? 'Create draft and continue' : 'Continue'}
                </button>
              )}
            </div>
          </form>
        </FormProvider>
      </div>
    </section>
  )
}
